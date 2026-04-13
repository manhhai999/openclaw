import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEnterWorktreeTool } from "./enter-worktree-tool.js";
import { createExitWorktreeTool } from "./exit-worktree-tool.js";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  createSessionWorktreeMock: vi.fn(),
  removeSessionWorktreeMock: vi.fn(),
  resolveRuntimeWorkspaceDirForSessionMock: vi.fn(),
  entry: undefined as Record<string, unknown> | undefined,
}));

vi.mock("../../gateway/session-utils.js", () => ({
  loadSessionEntry: () => ({
    entry: hoisted.entry,
  }),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => hoisted.callGatewayMock(opts),
}));

vi.mock("../worktree-runtime.js", () => ({
  createSessionWorktree: (params: unknown) => hoisted.createSessionWorktreeMock(params),
  removeSessionWorktree: (params: unknown) => hoisted.removeSessionWorktreeMock(params),
  resolveRuntimeWorkspaceDirForSession: (params: unknown) =>
    hoisted.resolveRuntimeWorkspaceDirForSessionMock(params),
}));

describe("worktree tools", () => {
  beforeEach(() => {
    hoisted.entry = undefined;
    hoisted.callGatewayMock.mockReset();
    hoisted.createSessionWorktreeMock.mockReset();
    hoisted.removeSessionWorktreeMock.mockReset();
    hoisted.resolveRuntimeWorkspaceDirForSessionMock.mockReset();
    hoisted.resolveRuntimeWorkspaceDirForSessionMock.mockReturnValue("/repo");
  });

  it("creates and persists an active session worktree", async () => {
    hoisted.createSessionWorktreeMock.mockResolvedValue({
      repoRoot: "/repo",
      worktreeDir: "/repo/.openclaw-worktrees/main",
      branch: "feature/demo",
      cleanupPolicy: "keep",
      createdAt: 10,
      updatedAt: 10,
      status: "active",
    });

    const tool = createEnterWorktreeTool({
      agentSessionKey: "agent:main:main",
      workspaceDir: "/repo",
      callGateway:
        hoisted.callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
    });
    const result = await tool.execute("call-1", {
      branch: "feature/demo",
      cleanup: "keep",
    });

    expect(hoisted.createSessionWorktreeMock).toHaveBeenCalledWith({
      sessionKey: "agent:main:main",
      workspaceDir: "/repo",
      requestedName: undefined,
      branch: "feature/demo",
      baseRef: undefined,
      cleanupPolicy: "keep",
    });
    expect(hoisted.callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.patch",
        params: expect.objectContaining({
          key: "agent:main:main",
          worktreeMode: "active",
          worktreeArtifact: expect.objectContaining({
            worktreeDir: "/repo/.openclaw-worktrees/main",
          }),
        }),
      }),
    );
    expect(result.details).toMatchObject({
      status: "active",
      sessionKey: "agent:main:main",
      worktreeDir: "/repo/.openclaw-worktrees/main",
      effectiveOnNextTurn: true,
    });
  });

  it("deactivates the worktree even when removal is skipped for dirty changes", async () => {
    hoisted.entry = {
      worktreeMode: "active",
      worktreeArtifact: {
        repoRoot: "/repo",
        worktreeDir: "/repo/.openclaw-worktrees/main",
        cleanupPolicy: "remove",
        createdAt: 10,
      },
    };
    hoisted.removeSessionWorktreeMock.mockResolvedValue({
      removed: false,
      dirty: true,
      error: "dirty checkout",
    });

    const tool = createExitWorktreeTool({
      agentSessionKey: "agent:main:main",
      callGateway:
        hoisted.callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
    });
    const result = await tool.execute("call-1", {
      cleanup: "remove",
    });

    expect(hoisted.removeSessionWorktreeMock).toHaveBeenCalledWith({
      repoRoot: "/repo",
      worktreeDir: "/repo/.openclaw-worktrees/main",
      force: false,
    });
    expect(hoisted.callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.patch",
        params: expect.objectContaining({
          key: "agent:main:main",
          worktreeMode: "inactive",
          worktreeArtifact: expect.objectContaining({
            status: "remove_failed",
            lastError: "dirty checkout",
          }),
        }),
      }),
    );
    expect(result.details).toMatchObject({
      status: "inactive",
      removed: false,
      dirty: true,
      error: "dirty checkout",
      effectiveOnNextTurn: true,
    });
  });
});
