import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  describeEnterPlanModeTool,
  ENTER_PLAN_MODE_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { ToolInputError, jsonResult, readStringParam } from "./common.js";

const EnterPlanModeToolSchema = Type.Object({
  goal: Type.Optional(Type.String({ description: "Optional short goal for the planned work." })),
  notes: Type.Optional(Type.String({ description: "Optional short planning note." })),
});

type GatewayCaller = typeof callGateway;

export function createEnterPlanModeTool(opts: {
  agentSessionKey: string;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Enter Plan Mode",
    name: "EnterPlanMode",
    displaySummary: ENTER_PLAN_MODE_TOOL_DISPLAY_SUMMARY,
    description: describeEnterPlanModeTool(),
    searchHint: "Start durable plan mode for the current multi-step task.",
    searchTags: ["plan", "planning", "workflow", "session"],
    parameters: EnterPlanModeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const goal = readStringParam(params, "goal");
      const notes = readStringParam(params, "notes");
      const sessionKey = opts.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("agent session key required");
      }

      const now = Date.now();
      const gatewayCall = opts.callGateway ?? callGateway;
      await gatewayCall({
        method: "sessions.patch",
        params: {
          key: sessionKey,
          planMode: "active",
          planArtifact: {
            status: "active",
            enteredAt: now,
            updatedAt: now,
            ...(goal ? { goal } : {}),
            ...(notes ? { notes } : {}),
          },
        },
        config: opts.config,
      });

      return jsonResult({
        status: "active",
        sessionKey,
        persisted: true,
        ...(goal ? { goal } : {}),
        ...(notes ? { notes } : {}),
      });
    },
  };
}
