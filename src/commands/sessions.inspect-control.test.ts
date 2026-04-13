import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRuntime, mockSessionsConfig } from "./sessions.test-helpers.js";

const callGatewayMock = vi.hoisted(() => vi.fn());

mockSessionsConfig();

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

import { sessionsControlCommand, sessionsInspectCommand } from "./sessions.js";

describe("sessions inspect/control commands", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("renders session inspect sections from gateway payload", async () => {
    callGatewayMock.mockResolvedValue({
      ok: true,
      key: "agent:main:main",
      exists: true,
      session: {
        sessionId: "sess-123",
        status: "running",
        modelProvider: "openai",
        model: "gpt-5.4",
      },
      plan: {
        mode: "active",
        artifact: {
          status: "active",
          goal: "Ship phase 3",
          steps: [{ step: "inspect", status: "in_progress" }],
        },
      },
      worktree: {
        mode: "active",
        artifact: {
          status: "active",
          worktreeDir: "/repo/.openclaw-worktrees/phase-3",
          cleanupPolicy: "remove",
        },
        preferredWorkspaceDir: "/repo/.openclaw-worktrees/phase-3",
      },
      team: {
        teamId: "team-1",
        flowStatus: "running",
        activeWorkers: 2,
        counts: { running: 2 },
      },
      policy: {
        sendPolicy: "deny",
        execHost: "gateway",
      },
    });

    const { runtime, logs } = makeRuntime();
    await sessionsInspectCommand({ key: "agent:main:main" }, runtime);

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.inspect",
        params: { key: "agent:main:main" },
      }),
    );
    const output = logs.join("\n");
    expect(output).toContain("Session: agent:main:main");
    expect(output).toContain("sessionId: sess-123");
    expect(output).toContain("goal: Ship phase 3");
    expect(output).toContain("worktreeDir: /repo/.openclaw-worktrees/phase-3");
    expect(output).toContain("teamId: team-1");
    expect(output).toContain("sendPolicy: deny");
  });

  it("forwards structured control actions to the gateway", async () => {
    callGatewayMock.mockResolvedValue({
      ok: true,
      key: "agent:main:main",
      actions: {
        plan: { mode: "inactive", artifact: { status: "completed", summary: "done" } },
        worktree: { status: "inactive", cleanup: "remove", removed: true, dirty: false },
        team: { teamId: "team-1", flowStatus: "cancelled", activeWorkers: 0, counts: {} },
      },
    });

    const { runtime, logs } = makeRuntime();
    await sessionsControlCommand(
      {
        key: "agent:main:main",
        exitPlan: true,
        planStatus: "completed",
        planSummary: "done",
        exitWorktree: true,
        cleanup: "remove",
        force: true,
        closeTeam: true,
        teamId: "team-1",
        teamSummary: "closed",
        cancelActive: false,
      },
      runtime,
    );

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.control",
        params: {
          key: "agent:main:main",
          plan: {
            exit: true,
            status: "completed",
            summary: "done",
          },
          worktree: {
            exit: true,
            cleanup: "remove",
            force: true,
          },
          team: {
            close: true,
            teamId: "team-1",
            summary: "closed",
            cancelActive: false,
          },
        },
      }),
    );
    expect(logs.join("\n")).toContain("plan: mode=inactive");
    expect(logs.join("\n")).toContain("worktree: status=inactive cleanup=remove");
    expect(logs.join("\n")).toContain("team: id=team-1 flowStatus=cancelled");
  });
});
