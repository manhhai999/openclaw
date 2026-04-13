import { describe, expect, it, vi } from "vitest";
import { createEnterPlanModeTool } from "./enter-plan-mode-tool.js";
import { createExitPlanModeTool } from "./exit-plan-mode-tool.js";

describe("plan mode tools", () => {
  it("persists active plan mode when entering", async () => {
    const callGatewayMock = vi.fn(async () => ({ ok: true }));
    const tool = createEnterPlanModeTool({
      agentSessionKey: "agent:main:main",
      callGateway: callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
    });

    const result = await tool.execute("call-1", {
      goal: "Ship phase 1",
      notes: "Focus on tool registry first",
    });

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.patch",
        params: expect.objectContaining({
          key: "agent:main:main",
          planMode: "active",
          planArtifact: expect.objectContaining({
            status: "active",
            goal: "Ship phase 1",
            notes: "Focus on tool registry first",
          }),
        }),
      }),
    );
    expect(result.details).toMatchObject({
      status: "active",
      sessionKey: "agent:main:main",
      persisted: true,
      goal: "Ship phase 1",
    });
  });

  it("persists inactive plan mode when exiting", async () => {
    const callGatewayMock = vi.fn(async () => ({ ok: true }));
    const tool = createExitPlanModeTool({
      agentSessionKey: "agent:main:main",
      callGateway: callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
    });

    const result = await tool.execute("call-1", {
      summary: "Phase 1 done",
      approved: true,
    });

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.patch",
        params: expect.objectContaining({
          key: "agent:main:main",
          planMode: "inactive",
          planArtifact: expect.objectContaining({
            status: "completed",
            summary: "Phase 1 done",
          }),
        }),
      }),
    );
    expect(result.details).toMatchObject({
      status: "inactive",
      sessionKey: "agent:main:main",
      persisted: true,
      approved: true,
      summary: "Phase 1 done",
    });
  });
});
