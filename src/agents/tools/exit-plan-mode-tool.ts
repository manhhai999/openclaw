import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  describeExitPlanModeTool,
  EXIT_PLAN_MODE_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { ToolInputError, jsonResult, readStringParam } from "./common.js";

const ExitPlanModeToolSchema = Type.Object({
  summary: Type.Optional(Type.String({ description: "Optional short summary of the outcome." })),
  approved: Type.Optional(
    Type.Boolean({
      description: "Whether the plan completed successfully and should be marked approved.",
    }),
  ),
});

type GatewayCaller = typeof callGateway;

export function createExitPlanModeTool(opts: {
  agentSessionKey: string;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Exit Plan Mode",
    name: "ExitPlanMode",
    displaySummary: EXIT_PLAN_MODE_TOOL_DISPLAY_SUMMARY,
    description: describeExitPlanModeTool(),
    searchHint: "Close durable plan mode after finishing or cancelling the planned work.",
    searchTags: ["plan", "planning", "complete", "done", "close"],
    parameters: ExitPlanModeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const summary = readStringParam(params, "summary");
      const approved = params.approved === true;
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
          planMode: "inactive",
          planArtifact: {
            status: approved ? "completed" : "cancelled",
            updatedAt: now,
            exitedAt: now,
            ...(approved ? { approvedAt: now } : {}),
            ...(summary ? { summary } : {}),
          },
        },
        config: opts.config,
      });

      return jsonResult({
        status: "inactive",
        sessionKey,
        persisted: true,
        approved,
        ...(summary ? { summary } : {}),
      });
    },
  };
}
