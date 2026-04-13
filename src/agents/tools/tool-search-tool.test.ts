import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./common.js";
import { createToolSearchTool } from "./tool-search-tool.js";

function stubTool(params: {
  name: string;
  label: string;
  description: string;
  searchHint?: string;
  searchTags?: string[];
}): AnyAgentTool {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    searchHint: params.searchHint,
    searchTags: params.searchTags,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  } as unknown as AnyAgentTool;
}

describe("tool_search tool", () => {
  it("searches fallback inventory entries by intent words", async () => {
    const tool = createToolSearchTool({
      resolveAvailableTools: () => [
        stubTool({
          name: "sessions_spawn",
          label: "Sessions Spawn",
          description: "Spawn sub-agent or ACP sessions.",
          searchHint: "Create worker sessions",
          searchTags: ["subagent", "delegate"],
        }),
        stubTool({
          name: "update_plan",
          label: "Update Plan",
          description: "Track a short structured work plan.",
          searchTags: ["plan"],
        }),
      ],
    });

    const result = await tool.execute("call-1", {
      query: "delegate subagent",
    });

    expect(result.details).toMatchObject({
      status: "results",
      query: "delegate subagent",
      matches: [
        expect.objectContaining({
          id: "sessions_spawn",
        }),
      ],
    });
  });

  it("supports select:<tool> confirmation", async () => {
    const tool = createToolSearchTool({
      resolveAvailableTools: () => [
        stubTool({
          name: "update_plan",
          label: "Update Plan",
          description: "Track a short structured work plan.",
        }),
      ],
    });

    const result = await tool.execute("call-1", {
      query: "select:update_plan,missing_tool",
    });

    expect(result.details).toEqual({
      status: "selected",
      selected: ["update_plan"],
      missing: ["missing_tool"],
      note: "Selection is advisory in the current runtime; matching tools are already available when listed.",
    });
  });

  it("prefers gateway effective inventory when a session key is available", async () => {
    const callGatewayMock = vi.fn(async () => ({
      agentId: "main",
      profile: "coding",
      groups: [
        {
          id: "core",
          label: "Built-in tools",
          source: "core",
          tools: [
            {
              id: "tool_search",
              label: "Tool Search",
              description: "Search the current tool inventory by intent.",
              rawDescription: "Search the current tool inventory by intent.",
              source: "core",
            },
          ],
        },
      ],
    }));
    const tool = createToolSearchTool({
      agentSessionKey: "agent:main:main",
      callGateway: callGatewayMock as unknown as typeof import("../../gateway/call.js").callGateway,
      resolveAvailableTools: () => [],
    });

    const result = await tool.execute("call-1", {
      query: "tool",
    });

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "tools.effective",
        params: { sessionKey: "agent:main:main" },
      }),
    );
    expect(result.details).toMatchObject({
      status: "results",
      matches: [expect.objectContaining({ id: "tool_search" })],
    });
  });
});
