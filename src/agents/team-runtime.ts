import { loadConfig } from "../config/config.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import type {
  JsonValue,
  TaskFlowRecord,
  TaskFlowStatus,
} from "../tasks/task-flow-registry.types.js";
import {
  createManagedTaskFlow,
  getTaskFlowById,
  listTaskFlowsForOwnerKey,
  updateFlowRecordByIdExpectedRevision,
} from "../tasks/task-flow-runtime-internal.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { killControlledSubagentRun, resolveSubagentController } from "./subagent-control.js";
import { isActiveSubagentRun, createPendingDescendantCounter } from "./subagent-list.js";
import {
  getLatestSubagentRunByChildSessionKey,
  resolveSubagentSessionStatus,
} from "./subagent-registry-read.js";
import { spawnSubagentDirect, type SpawnSubagentContext } from "./subagent-spawn.js";

export const TEAM_FLOW_CONTROLLER_ID = "openclaw/team-orchestration/v1";
export const TEAM_FLOW_STATE_KIND = "team_orchestration_v1";

export type TeamMemberStatus =
  | "pending"
  | "accepted"
  | "running"
  | "done"
  | "failed"
  | "killed"
  | "timeout"
  | "error";

export type TeamMemberSpec = {
  label?: string;
  task: string;
  agentId?: string;
  model?: string;
  thinking?: string;
  mode?: "run" | "session";
  lightContext?: boolean;
};

export type TeamMemberState = TeamMemberSpec & {
  memberId: string;
  status: TeamMemberStatus;
  childSessionKey?: string;
  runId?: string;
  workspaceDir?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
};

export type TeamFlowState = {
  kind: typeof TEAM_FLOW_STATE_KIND;
  version: 1;
  teamId: string;
  ownerSessionKey: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  summary?: string;
  worktreeDir?: string;
  members: TeamMemberState[];
};

export type TeamFlowView = {
  flow: TaskFlowRecord;
  state: TeamFlowState;
  counts: Record<TeamMemberStatus, number>;
  activeCount: number;
};

function isTerminalFlowStatus(
  status: TaskFlowStatus,
): status is Extract<TaskFlowStatus, "succeeded" | "failed" | "cancelled" | "lost"> {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "lost"
  );
}

function createEmptyCounts(): Record<TeamMemberStatus, number> {
  return {
    pending: 0,
    accepted: 0,
    running: 0,
    done: 0,
    failed: 0,
    killed: 0,
    timeout: 0,
    error: 0,
  };
}

function createMemberId(index: number): string {
  return `member-${index + 1}`;
}

function createDefaultMember(goal: string): TeamMemberSpec {
  return {
    label: "worker-1",
    task: goal,
    mode: "session",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTeamFlowState(
  flow: TaskFlowRecord | null | undefined,
): TeamFlowState | undefined {
  if (!flow || flow.controllerId !== TEAM_FLOW_CONTROLLER_ID || !isPlainObject(flow.stateJson)) {
    return undefined;
  }
  const raw = flow.stateJson;
  if (
    raw.kind !== TEAM_FLOW_STATE_KIND ||
    raw.version !== 1 ||
    typeof raw.teamId !== "string" ||
    typeof raw.ownerSessionKey !== "string" ||
    typeof raw.goal !== "string" ||
    !Array.isArray(raw.members)
  ) {
    return undefined;
  }
  return raw as unknown as TeamFlowState;
}

function listTeamFlowsForOwner(ownerSessionKey: string): TaskFlowRecord[] {
  return listTaskFlowsForOwnerKey(ownerSessionKey).filter(
    (flow) => flow.controllerId === TEAM_FLOW_CONTROLLER_ID && readTeamFlowState(flow),
  );
}

export function resolveTeamFlow(params: {
  ownerSessionKey: string;
  teamId?: string;
}): TaskFlowRecord | undefined {
  const requested = normalizeOptionalString(params.teamId);
  if (requested) {
    const direct = getTaskFlowById(requested);
    if (
      direct?.ownerKey === params.ownerSessionKey &&
      direct.controllerId === TEAM_FLOW_CONTROLLER_ID
    ) {
      return direct;
    }
  }
  return listTeamFlowsForOwner(params.ownerSessionKey)[0];
}

function deriveMemberStatus(member: TeamMemberState): TeamMemberState {
  const childSessionKey = normalizeOptionalString(member.childSessionKey);
  if (!childSessionKey) {
    return member;
  }
  const latestRun = getLatestSubagentRunByChildSessionKey(childSessionKey);
  if (!latestRun) {
    return member;
  }
  const pendingDescendantCount = createPendingDescendantCounter();
  const active = isActiveSubagentRun(latestRun, pendingDescendantCount);
  const now = Date.now();
  if (active) {
    return {
      ...member,
      status: "running",
      runId: latestRun.runId,
      updatedAt: latestRun.startedAt ?? latestRun.createdAt ?? now,
      workspaceDir: latestRun.workspaceDir ?? member.workspaceDir,
    };
  }
  const sessionStatus = resolveSubagentSessionStatus(latestRun);
  const outcomeStatus = latestRun.outcome?.status;
  const finishedAt = latestRun.endedAt ?? latestRun.startedAt ?? latestRun.createdAt ?? now;
  let status: TeamMemberStatus = member.status;
  if (sessionStatus === "done" || outcomeStatus === "ok") {
    status = "done";
  } else if (sessionStatus === "failed" || outcomeStatus === "error") {
    status = "failed";
  } else if (sessionStatus === "killed") {
    status = "killed";
  } else if (sessionStatus === "timeout" || outcomeStatus === "timeout") {
    status = "timeout";
  }
  return {
    ...member,
    status,
    runId: latestRun.runId,
    updatedAt: finishedAt,
    finishedAt,
    workspaceDir: latestRun.workspaceDir ?? member.workspaceDir,
  };
}

function computeFlowStatus(params: {
  current: TaskFlowRecord;
  state: TeamFlowState;
  counts: Record<TeamMemberStatus, number>;
  activeCount: number;
}): { status: TaskFlowStatus; currentStep: string; endedAt?: number } {
  const closedStep = normalizeOptionalString(params.current.currentStep);
  if (
    params.state.closedAt &&
    params.activeCount === 0 &&
    isTerminalFlowStatus(params.current.status) &&
    closedStep
  ) {
    return {
      status: params.current.status,
      currentStep: closedStep,
      endedAt: params.current.endedAt ?? params.state.closedAt,
    };
  }
  const total = params.state.members.length;
  if (params.activeCount > 0) {
    return {
      status: "running",
      currentStep: `workers active ${params.activeCount}/${total}`,
    };
  }
  if (params.current.cancelRequestedAt || params.counts.killed > 0) {
    return {
      status: "cancelled",
      currentStep: `team cancelled (${params.counts.killed}/${total} stopped)`,
      endedAt: params.current.endedAt ?? Date.now(),
    };
  }
  if (params.counts.failed > 0 || params.counts.timeout > 0 || params.counts.error > 0) {
    return {
      status: "failed",
      currentStep: `workers failed ${params.counts.failed + params.counts.timeout + params.counts.error}/${total}`,
      endedAt: params.current.endedAt ?? Date.now(),
    };
  }
  if (params.counts.done === total && total > 0) {
    return {
      status: "succeeded",
      currentStep: `all workers settled ${total}/${total}`,
      endedAt: params.current.endedAt ?? Date.now(),
    };
  }
  return {
    status: "queued",
    currentStep: total > 0 ? `workers queued ${total}` : "team queued",
  };
}

function buildTeamFlowView(flow: TaskFlowRecord, state: TeamFlowState): TeamFlowView {
  const counts = createEmptyCounts();
  let activeCount = 0;
  for (const member of state.members) {
    counts[member.status] += 1;
    if (
      member.status === "running" ||
      member.status === "accepted" ||
      member.status === "pending"
    ) {
      activeCount += 1;
    }
  }
  return {
    flow,
    state,
    counts,
    activeCount,
  };
}

function updateTeamFlowState(params: {
  flow: TaskFlowRecord;
  nextState: TeamFlowState;
  nextStatus: TaskFlowStatus;
  currentStep: string;
  endedAt?: number;
}): TaskFlowRecord {
  const stateJson = params.nextState as JsonValue;
  const currentStateJson = params.flow.stateJson;
  const currentStateSerialized =
    currentStateJson === undefined ? undefined : JSON.stringify(currentStateJson);
  const nextStateSerialized = JSON.stringify(stateJson);
  const wantsCancelRequestedAt =
    params.nextStatus === "cancelled" && params.flow.cancelRequestedAt === undefined;
  const endedAt =
    params.endedAt === undefined ? params.flow.endedAt : (params.endedAt ?? undefined);
  if (
    params.flow.status === params.nextStatus &&
    normalizeOptionalString(params.flow.currentStep) ===
      normalizeOptionalString(params.currentStep) &&
    currentStateSerialized === nextStateSerialized &&
    params.flow.endedAt === endedAt &&
    !wantsCancelRequestedAt
  ) {
    return params.flow;
  }
  const result = updateFlowRecordByIdExpectedRevision({
    flowId: params.flow.flowId,
    expectedRevision: params.flow.revision,
    patch: {
      status: params.nextStatus,
      currentStep: params.currentStep,
      stateJson,
      waitJson: null,
      blockedTaskId: null,
      blockedSummary: null,
      updatedAt: params.nextState.updatedAt,
      endedAt: endedAt ?? null,
      ...(wantsCancelRequestedAt ? { cancelRequestedAt: Date.now() } : {}),
    },
  });
  if (!result.applied) {
    return result.current ?? params.flow;
  }
  return result.flow;
}

export function syncTeamFlow(flow: TaskFlowRecord): TeamFlowView {
  const state = readTeamFlowState(flow);
  if (!state) {
    throw new Error("Invalid team flow state.");
  }
  const members = state.members.map((member) => deriveMemberStatus(member));
  const derivedUpdatedAt = Math.max(state.updatedAt, ...members.map((member) => member.updatedAt));
  const nextState: TeamFlowState = {
    ...state,
    updatedAt: derivedUpdatedAt,
    members,
  };
  const nextView = buildTeamFlowView(flow, nextState);
  const flowSummary = computeFlowStatus({
    current: flow,
    state: nextState,
    counts: nextView.counts,
    activeCount: nextView.activeCount,
  });
  const nextFlow = updateTeamFlowState({
    flow,
    nextState,
    nextStatus: flowSummary.status,
    currentStep: flowSummary.currentStep,
    endedAt: flowSummary.endedAt,
  });
  return buildTeamFlowView(nextFlow, readTeamFlowState(nextFlow) ?? nextState);
}

export async function createTeamFlow(params: {
  ownerSessionKey: string;
  goal: string;
  members: TeamMemberSpec[];
  workspaceDir?: string;
  spawnContext: SpawnSubagentContext;
}): Promise<TeamFlowView> {
  const now = Date.now();
  const created = createManagedTaskFlow({
    ownerKey: params.ownerSessionKey,
    controllerId: TEAM_FLOW_CONTROLLER_ID,
    requesterOrigin: normalizeDeliveryContext({
      channel: params.spawnContext.agentChannel,
      accountId: params.spawnContext.agentAccountId,
      to: params.spawnContext.agentTo,
      threadId: params.spawnContext.agentThreadId,
    }),
    status: "queued",
    goal: params.goal,
    currentStep: "spawn_workers",
  });

  const requestedMembers =
    params.members.length > 0 ? params.members : [createDefaultMember(params.goal)];
  const members: TeamMemberState[] = [];

  for (const [index, spec] of requestedMembers.entries()) {
    const label = normalizeOptionalString(spec.label) ?? `worker-${index + 1}`;
    const task = normalizeOptionalString(spec.task) ?? params.goal;
    const acceptedMode = spec.mode === "run" ? "run" : "session";
    const result = await spawnSubagentDirect(
      {
        task,
        label,
        agentId: normalizeOptionalString(spec.agentId) ?? undefined,
        model: normalizeOptionalString(spec.model) ?? undefined,
        thinking: normalizeOptionalString(spec.thinking) ?? undefined,
        mode: acceptedMode,
        cleanup: "keep",
        lightContext: spec.lightContext === true,
        expectsCompletionMessage: true,
      },
      {
        ...params.spawnContext,
        workspaceDir: params.workspaceDir,
      },
    );

    members.push({
      memberId: createMemberId(index),
      label,
      task,
      agentId: normalizeOptionalString(spec.agentId) ?? undefined,
      model: normalizeOptionalString(spec.model) ?? undefined,
      thinking: normalizeOptionalString(spec.thinking) ?? undefined,
      mode: acceptedMode,
      lightContext: spec.lightContext === true,
      status:
        result.status === "accepted"
          ? "accepted"
          : result.status === "forbidden"
            ? "error"
            : "error",
      childSessionKey: result.childSessionKey,
      runId: result.runId,
      workspaceDir: params.workspaceDir,
      error: result.error,
      createdAt: now,
      updatedAt: now,
      ...(result.status !== "accepted" ? { finishedAt: now } : {}),
    });
  }

  const initialState: TeamFlowState = {
    kind: TEAM_FLOW_STATE_KIND,
    version: 1,
    teamId: created.flowId,
    ownerSessionKey: params.ownerSessionKey,
    goal: params.goal,
    createdAt: now,
    updatedAt: now,
    worktreeDir: params.workspaceDir,
    members,
  };
  const initialView = buildTeamFlowView(created, initialState);
  const flowSummary = computeFlowStatus({
    current: created,
    state: initialState,
    counts: initialView.counts,
    activeCount: initialView.activeCount,
  });
  const nextFlow = updateTeamFlowState({
    flow: created,
    nextState: initialState,
    nextStatus: flowSummary.status,
    currentStep: flowSummary.currentStep,
    endedAt: flowSummary.endedAt,
  });
  return buildTeamFlowView(nextFlow, readTeamFlowState(nextFlow) ?? initialState);
}

export async function closeTeamFlow(params: {
  flow: TaskFlowRecord;
  ownerSessionKey: string;
  summary?: string;
  cancelActive: boolean;
}): Promise<TeamFlowView> {
  const synced = syncTeamFlow(params.flow);
  const cfg = loadConfig();
  const controller = resolveSubagentController({
    cfg,
    agentSessionKey: params.ownerSessionKey,
  });
  const latestState = synced.state;

  if (synced.activeCount > 0 && !params.cancelActive) {
    throw new Error("Active team workers remain. Re-run with cancelActive=true to stop them.");
  }

  if (synced.activeCount > 0) {
    if (controller.controlScope !== "children") {
      throw new Error("Leaf subagents cannot close active teams.");
    }
    for (const member of latestState.members) {
      const childSessionKey = normalizeOptionalString(member.childSessionKey);
      if (
        !childSessionKey ||
        (member.status !== "running" && member.status !== "accepted" && member.status !== "pending")
      ) {
        continue;
      }
      const latestRun = getLatestSubagentRunByChildSessionKey(childSessionKey);
      if (!latestRun) {
        continue;
      }
      const result = await killControlledSubagentRun({
        cfg,
        controller,
        entry: latestRun,
      });
      if (result.status !== "ok" && result.status !== "done") {
        throw new Error("error" in result ? result.error : `failed to close ${childSessionKey}`);
      }
    }
  }

  const refreshed = syncTeamFlow(getTaskFlowById(synced.flow.flowId) ?? synced.flow);
  const now = Date.now();
  const nextState: TeamFlowState = {
    ...refreshed.state,
    updatedAt: now,
    closedAt: now,
    ...(normalizeOptionalString(params.summary) ? { summary: params.summary } : {}),
  };
  const terminalStatus: TaskFlowStatus =
    refreshed.activeCount > 0 || refreshed.counts.killed > 0
      ? "cancelled"
      : refreshed.flow.status === "failed" ||
          refreshed.counts.failed > 0 ||
          refreshed.counts.timeout > 0
        ? "failed"
        : "succeeded";
  const nextFlow = updateTeamFlowState({
    flow: refreshed.flow,
    nextState,
    nextStatus: terminalStatus,
    currentStep:
      terminalStatus === "cancelled"
        ? "team closed after worker cancellation"
        : terminalStatus === "failed"
          ? "team closed with failures"
          : "team closed successfully",
    endedAt: now,
  });
  return buildTeamFlowView(nextFlow, readTeamFlowState(nextFlow) ?? nextState);
}
