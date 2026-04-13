import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTaskFlowRegistryForTests } from "../tasks/task-flow-runtime-internal.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { closeTeamFlow, createTeamFlow, syncTeamFlow } from "./team-runtime.js";

const hoisted = vi.hoisted(() => ({
  runMap: new Map<string, Record<string, unknown>>(),
  spawnMock: vi.fn(),
  killMock: vi.fn(),
}));

vi.mock("./subagent-spawn.js", () => ({
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnMock(...args),
}));

vi.mock("./subagent-list.js", () => ({
  createPendingDescendantCounter: () => () => 0,
  isActiveSubagentRun: (entry: { endedAt?: number }) => entry.endedAt === undefined,
}));

vi.mock("./subagent-control.js", () => ({
  resolveSubagentController: () => ({
    controllerSessionKey: "agent:main:main",
    callerSessionKey: "agent:main:main",
    callerIsSubagent: false,
    controlScope: "children",
  }),
  killControlledSubagentRun: (...args: unknown[]) => hoisted.killMock(...args),
}));

vi.mock("./subagent-registry-read.js", () => ({
  getLatestSubagentRunByChildSessionKey: (childSessionKey: string) =>
    hoisted.runMap.get(childSessionKey) ?? null,
  resolveSubagentSessionStatus: (entry: { endedAt?: number; outcome?: { status?: string } }) => {
    if (!entry.endedAt) {
      return "running";
    }
    if (entry.outcome?.status === "ok") {
      return "done";
    }
    if (entry.outcome?.status === "error") {
      return "failed";
    }
    if (entry.outcome?.status === "killed") {
      return "killed";
    }
    if (entry.outcome?.status === "timeout") {
      return "timeout";
    }
    return "done";
  },
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({}),
  };
});

function createRun(params: {
  runId: string;
  childSessionKey: string;
  task: string;
  createdAt: number;
  endedAt?: number;
  outcome?: { status?: string };
}) {
  return {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: params.task,
    cleanup: "keep",
    createdAt: params.createdAt,
    endedAt: params.endedAt,
    outcome: params.outcome,
  };
}

describe("team-runtime", () => {
  beforeEach(() => {
    hoisted.runMap.clear();
    hoisted.spawnMock.mockReset();
    hoisted.killMock.mockReset();
    resetTaskFlowRegistryForTests();
  });

  afterEach(() => {
    delete process.env.OPENCLAW_STATE_DIR;
    resetTaskFlowRegistryForTests();
  });

  it("creates a managed team flow and syncs worker completion", async () => {
    await withTempDir({ prefix: "openclaw-team-runtime-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      resetTaskFlowRegistryForTests();
      hoisted.spawnMock.mockResolvedValue({
        status: "accepted",
        childSessionKey: "agent:main:subagent:worker-1",
        runId: "run-1",
      });

      const created = await createTeamFlow({
        ownerSessionKey: "agent:main:main",
        goal: "Ship phase 2",
        members: [{ task: "Implement runtime plumbing" }],
        workspaceDir: "/repo/.openclaw-worktrees/main",
        spawnContext: {
          agentSessionKey: "agent:main:main",
        },
      });

      expect(created.flow.controllerId).toBe("openclaw/team-orchestration/v1");
      expect(created.state.teamId).toBe(created.flow.flowId);
      expect(created.flow.status).toBe("running");
      expect(created.state.members[0]).toMatchObject({
        status: "accepted",
        childSessionKey: "agent:main:subagent:worker-1",
      });

      hoisted.runMap.set(
        "agent:main:subagent:worker-1",
        createRun({
          runId: "run-1",
          childSessionKey: "agent:main:subagent:worker-1",
          task: "Implement runtime plumbing",
          createdAt: 10,
          endedAt: 20,
          outcome: { status: "ok" },
        }),
      );

      const synced = syncTeamFlow(created.flow);
      expect(synced.flow.status).toBe("succeeded");
      expect(synced.state.members[0]?.status).toBe("done");
    });
  });

  it("closes active teams by cancelling running workers", async () => {
    await withTempDir({ prefix: "openclaw-team-runtime-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      resetTaskFlowRegistryForTests();
      hoisted.spawnMock.mockResolvedValue({
        status: "accepted",
        childSessionKey: "agent:main:subagent:worker-2",
        runId: "run-2",
      });
      hoisted.killMock.mockImplementation(
        async ({ entry }: { entry: { childSessionKey: string; runId: string } }) => {
          hoisted.runMap.set(
            entry.childSessionKey,
            createRun({
              runId: entry.runId,
              childSessionKey: entry.childSessionKey,
              task: "Investigate flaky tests",
              createdAt: 10,
              endedAt: 30,
              outcome: { status: "killed" },
            }),
          );
          return {
            status: "ok",
            sessionKey: entry.childSessionKey,
            runId: entry.runId,
          };
        },
      );

      const created = await createTeamFlow({
        ownerSessionKey: "agent:main:main",
        goal: "Ship phase 2",
        members: [{ task: "Investigate flaky tests" }],
        spawnContext: {
          agentSessionKey: "agent:main:main",
        },
      });

      hoisted.runMap.set(
        "agent:main:subagent:worker-2",
        createRun({
          runId: "run-2",
          childSessionKey: "agent:main:subagent:worker-2",
          task: "Investigate flaky tests",
          createdAt: 10,
        }),
      );

      const closed = await closeTeamFlow({
        flow: created.flow,
        ownerSessionKey: "agent:main:main",
        summary: "Stop remaining workers",
        cancelActive: true,
      });

      expect(hoisted.killMock).toHaveBeenCalled();
      expect(closed.flow.status).toBe("cancelled");
      expect(closed.state.summary).toBe("Stop remaining workers");
      expect(closed.state.members[0]?.status).toBe("killed");
    });
  });

  it("preserves close-team currentStep after later sync for terminal teams", async () => {
    await withTempDir({ prefix: "openclaw-team-runtime-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      resetTaskFlowRegistryForTests();

      hoisted.spawnMock
        .mockResolvedValueOnce({
          status: "accepted",
          childSessionKey: "agent:main:subagent:worker-success",
          runId: "run-success",
        })
        .mockResolvedValueOnce({
          status: "accepted",
          childSessionKey: "agent:main:subagent:worker-cancel",
          runId: "run-cancel",
        });
      hoisted.killMock.mockImplementation(
        async ({ entry }: { entry: { childSessionKey: string; runId: string } }) => {
          hoisted.runMap.set(
            entry.childSessionKey,
            createRun({
              runId: entry.runId,
              childSessionKey: entry.childSessionKey,
              task: "Cancel running worker",
              createdAt: 100,
              endedAt: 140,
              outcome: { status: "killed" },
            }),
          );
          return {
            status: "ok",
            sessionKey: entry.childSessionKey,
            runId: entry.runId,
          };
        },
      );

      const successTeam = await createTeamFlow({
        ownerSessionKey: "agent:main:main",
        goal: "Ship phase 3",
        members: [{ task: "Verify operator lane" }],
        spawnContext: {
          agentSessionKey: "agent:main:main",
        },
      });
      hoisted.runMap.set(
        "agent:main:subagent:worker-success",
        createRun({
          runId: "run-success",
          childSessionKey: "agent:main:subagent:worker-success",
          task: "Verify operator lane",
          createdAt: 10,
          endedAt: 20,
          outcome: { status: "ok" },
        }),
      );
      const closedSuccess = await closeTeamFlow({
        flow: successTeam.flow,
        ownerSessionKey: "agent:main:main",
        summary: "Closed after success",
        cancelActive: false,
      });

      const cancelTeam = await createTeamFlow({
        ownerSessionKey: "agent:main:main",
        goal: "Stop workers",
        members: [{ task: "Cancel running worker" }],
        spawnContext: {
          agentSessionKey: "agent:main:main",
        },
      });
      hoisted.runMap.set(
        "agent:main:subagent:worker-cancel",
        createRun({
          runId: "run-cancel",
          childSessionKey: "agent:main:subagent:worker-cancel",
          task: "Cancel running worker",
          createdAt: 30,
        }),
      );
      const closedCancel = await closeTeamFlow({
        flow: cancelTeam.flow,
        ownerSessionKey: "agent:main:main",
        summary: "Closed after cancellation",
        cancelActive: true,
      });

      const resyncedSuccess = syncTeamFlow(closedSuccess.flow);
      const resyncedCancel = syncTeamFlow(closedCancel.flow);

      expect(closedSuccess.flow.currentStep).toBe("team closed successfully");
      expect(resyncedSuccess.flow.currentStep).toBe("team closed successfully");
      expect(resyncedSuccess.flow.status).toBe("succeeded");

      expect(closedCancel.flow.currentStep).toBe("team closed after worker cancellation");
      expect(resyncedCancel.flow.currentStep).toBe("team closed after worker cancellation");
      expect(resyncedCancel.flow.status).toBe("cancelled");
    });
  });
});
