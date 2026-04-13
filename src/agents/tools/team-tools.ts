import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import {
  closeTeamFlow,
  createTeamFlow,
  resolveTeamFlow,
  syncTeamFlow,
  type TeamFlowView,
  type TeamMemberSpec,
} from "../team-runtime.js";
import {
  describeTeamCloseTool,
  describeTeamCreateTool,
  describeTeamStatusTool,
  TEAM_CLOSE_TOOL_DISPLAY_SUMMARY,
  TEAM_CREATE_TOOL_DISPLAY_SUMMARY,
  TEAM_STATUS_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import { resolveRuntimeWorkspaceDirForSession } from "../worktree-runtime.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";

const TeamMemberSchema = Type.Object(
  {
    label: Type.Optional(Type.String()),
    task: Type.String(),
    agentId: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    thinking: Type.Optional(Type.String()),
    mode: Type.Optional(Type.Union([Type.Literal("run"), Type.Literal("session")])),
    lightContext: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const TeamCreateToolSchema = Type.Object({
  goal: Type.String(),
  members: Type.Optional(Type.Array(TeamMemberSchema, { minItems: 1, maxItems: 8 })),
});

const TeamStatusToolSchema = Type.Object({
  teamId: Type.Optional(
    Type.String({
      description: "Existing team/flow id. Defaults to the latest team for this session.",
    }),
  ),
});

const TeamCloseToolSchema = Type.Object({
  teamId: Type.Optional(
    Type.String({
      description: "Existing team/flow id. Defaults to the latest team for this session.",
    }),
  ),
  summary: Type.Optional(Type.String({ description: "Optional short team close summary." })),
  cancelActive: Type.Optional(
    Type.Boolean({
      description: "When true, active worker runs are cancelled before the team is closed.",
    }),
  ),
});

function parseMembers(params: Record<string, unknown>): TeamMemberSpec[] {
  const raw = params.members;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolInputError(`members[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const task = readStringParam(record, "task", {
      required: true,
      label: `members[${index}].task`,
    });
    return {
      task,
      label: readStringParam(record, "label"),
      agentId: readStringParam(record, "agentId"),
      model: readStringParam(record, "model"),
      thinking: readStringParam(record, "thinking"),
      mode: record.mode === "run" ? "run" : record.mode === "session" ? "session" : undefined,
      lightContext: record.lightContext === true,
    };
  });
}

function formatTeamFlow(view: TeamFlowView) {
  return {
    status: "ok",
    teamId: view.state.teamId,
    flowId: view.flow.flowId,
    flowStatus: view.flow.status,
    currentStep: view.flow.currentStep,
    summary: view.state.summary,
    worktreeDir: view.state.worktreeDir,
    activeWorkers: view.activeCount,
    counts: view.counts,
    members: view.state.members.map((member) => ({
      memberId: member.memberId,
      label: member.label,
      task: member.task,
      status: member.status,
      childSessionKey: member.childSessionKey,
      runId: member.runId,
      agentId: member.agentId,
      mode: member.mode,
      workspaceDir: member.workspaceDir,
      error: member.error,
      updatedAt: member.updatedAt,
      finishedAt: member.finishedAt,
    })),
  };
}

export function createTeamCreateTool(opts: {
  agentSessionKey: string;
  workspaceDir?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Team Create",
    name: "team_create",
    displaySummary: TEAM_CREATE_TOOL_DISPLAY_SUMMARY,
    description: describeTeamCreateTool(),
    searchHint: "Create a tracked worker team or swarm for the current session.",
    searchTags: ["team", "swarm", "subagent", "parallel", "workers"],
    parameters: TeamCreateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = opts.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("agent session key required");
      }
      const goal = readStringParam(params, "goal", { required: true });
      const workspaceDir = resolveRuntimeWorkspaceDirForSession({
        sessionKey,
        fallbackWorkspaceDir: opts.workspaceDir,
      });
      const view = await createTeamFlow({
        ownerSessionKey: sessionKey,
        goal,
        members: parseMembers(params),
        workspaceDir,
        spawnContext: {
          agentSessionKey: sessionKey,
          agentChannel: opts.agentChannel,
          agentAccountId: opts.agentAccountId,
          agentTo: opts.agentTo,
          agentThreadId: opts.agentThreadId,
          agentGroupId: opts.agentGroupId,
          agentGroupChannel: opts.agentGroupChannel,
          agentGroupSpace: opts.agentGroupSpace,
          requesterAgentIdOverride: opts.requesterAgentIdOverride,
          workspaceDir,
        },
      });
      return jsonResult(formatTeamFlow(view));
    },
  };
}

export function createTeamStatusTool(opts: { agentSessionKey: string }): AnyAgentTool {
  return {
    label: "Team Status",
    name: "team_status",
    displaySummary: TEAM_STATUS_TOOL_DISPLAY_SUMMARY,
    description: describeTeamStatusTool(),
    searchHint: "Inspect and refresh the latest managed team/swarm status.",
    searchTags: ["team", "swarm", "status", "workers", "subagent"],
    parameters: TeamStatusToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = opts.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("agent session key required");
      }
      const flow = resolveTeamFlow({
        ownerSessionKey: sessionKey,
        teamId: readStringParam(params, "teamId"),
      });
      if (!flow) {
        return jsonResult({
          status: "error",
          error: "No managed team found for this session.",
        });
      }
      return jsonResult(formatTeamFlow(syncTeamFlow(flow)));
    },
  };
}

export function createTeamCloseTool(opts: { agentSessionKey: string }): AnyAgentTool {
  return {
    label: "Team Close",
    name: "team_close",
    displaySummary: TEAM_CLOSE_TOOL_DISPLAY_SUMMARY,
    description: describeTeamCloseTool(),
    searchHint: "Close a managed team/swarm and optionally stop active workers.",
    searchTags: ["team", "swarm", "close", "cancel", "workers"],
    parameters: TeamCloseToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = opts.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("agent session key required");
      }
      const flow = resolveTeamFlow({
        ownerSessionKey: sessionKey,
        teamId: readStringParam(params, "teamId"),
      });
      if (!flow) {
        return jsonResult({
          status: "error",
          error: "No managed team found for this session.",
        });
      }
      const view = await closeTeamFlow({
        flow,
        ownerSessionKey: sessionKey,
        summary: readStringParam(params, "summary"),
        cancelActive: params.cancelActive !== false,
      });
      return jsonResult(formatTeamFlow(view));
    },
  };
}
