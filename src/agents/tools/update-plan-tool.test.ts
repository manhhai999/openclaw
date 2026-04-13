import { describe, expect, it, vi } from "vitest";
import { createUpdatePlanTool } from "./update-plan-tool.js";

describe("update_plan tool", () => {
  it("returns a compact success payload", async () => {
    const tool = createUpdatePlanTool();
    const result = await tool.execute("call-1", {
      explanation: "Started work",
      plan: [
        { step: "Inspect harness", status: "completed" },
        { step: "Add tool", status: "in_progress" },
        { step: "Run tests", status: "pending" },
      ],
    });

    expect(result.content).toEqual([]);
    expect(result.details).toEqual({
      status: "updated",
      explanation: "Started work",
      plan: [
        { step: "Inspect harness", status: "completed" },
        { step: "Add tool", status: "in_progress" },
        { step: "Run tests", status: "pending" },
      ],
    });
  });

  it("rejects multiple in-progress steps", async () => {
    const tool = createUpdatePlanTool();

    await expect(
      tool.execute("call-1", {
        plan: [
          { step: "One", status: "in_progress" },
          { step: "Two", status: "in_progress" },
        ],
      }),
    ).rejects.toThrow("plan can contain at most one in_progress step");
  });

  it("ignores extra per-step fields instead of rejecting the plan", async () => {
    const tool = createUpdatePlanTool();
    const result = await tool.execute("call-1", {
      plan: [
        { step: "Inspect harness", status: "completed", owner: "agent-1" },
        { step: "Run tests", status: "pending", notes: ["later"] },
      ],
    });

    expect(result.content).toEqual([]);
    expect(result.details).toEqual({
      status: "updated",
      plan: [
        { step: "Inspect harness", status: "completed" },
        { step: "Run tests", status: "pending" },
      ],
    });
  });

  it("persists the plan artifact when a session key is available", async () => {
    const callGatewayMock = vi.fn(async () => ({ ok: true }));
    const tool = createUpdatePlanTool({
      agentSessionKey: "agent:main:main",
      callGateway: callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
    });

    const result = await tool.execute("call-1", {
      explanation: "Captured plan",
      plan: [
        { step: "Inspect harness", status: "completed" },
        { step: "Add tool", status: "in_progress" },
      ],
    });

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "sessions.patch",
        params: expect.objectContaining({
          key: "agent:main:main",
          planMode: "active",
          planArtifact: expect.objectContaining({
            status: "active",
            lastExplanation: "Captured plan",
            steps: [
              { step: "Inspect harness", status: "completed" },
              { step: "Add tool", status: "in_progress" },
            ],
          }),
        }),
      }),
    );
    expect(result.details).toEqual({
      status: "updated",
      persisted: true,
      explanation: "Captured plan",
      plan: [
        { step: "Inspect harness", status: "completed" },
        { step: "Add tool", status: "in_progress" },
      ],
    });
  });
});
