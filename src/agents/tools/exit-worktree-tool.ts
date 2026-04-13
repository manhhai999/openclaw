import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  describeExitWorktreeTool,
  EXIT_WORKTREE_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, ToolInputError } from "./common.js";

const ExitWorktreeToolSchema = Type.Object({
  cleanup: Type.Optional(
    Type.Union([Type.Literal("keep"), Type.Literal("remove")], {
      description: "Whether to keep the worktree on disk or remove it after deactivation.",
    }),
  ),
  force: Type.Optional(
    Type.Boolean({
      description: "When true, force removal even if the worktree still has uncommitted changes.",
    }),
  ),
});

type GatewayCaller = typeof callGateway;

export function createExitWorktreeTool(opts: {
  agentSessionKey: string;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
}): AnyAgentTool {
  return {
    label: "Exit Worktree",
    name: "ExitWorktree",
    displaySummary: EXIT_WORKTREE_TOOL_DISPLAY_SUMMARY,
    description: describeExitWorktreeTool(),
    searchHint: "Deactivate or remove the current session worktree.",
    searchTags: ["git", "worktree", "cleanup", "branch", "workspace"],
    parameters: ExitWorktreeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = opts.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("agent session key required");
      }

      const gatewayCall = opts.callGateway ?? callGateway;
      const result = await gatewayCall({
        requiredMethods: ["sessions.control"],
        method: "sessions.control",
        params: {
          key: sessionKey,
          worktree: {
            exit: true,
            ...(params.cleanup === "remove" || params.cleanup === "keep"
              ? { cleanup: params.cleanup }
              : {}),
            ...(params.force === true ? { force: true } : {}),
          },
        },
        config: opts.config,
      });
      const actions =
        result.actions && typeof result.actions === "object"
          ? (result.actions as Record<string, unknown>)
          : undefined;
      const worktree =
        actions?.worktree && typeof actions.worktree === "object"
          ? (actions.worktree as Record<string, unknown>)
          : undefined;

      return jsonResult({
        status: typeof worktree?.status === "string" ? worktree.status : "inactive",
        sessionKey: typeof result.key === "string" ? result.key : sessionKey,
        cleanup: typeof worktree?.cleanup === "string" ? worktree.cleanup : params.cleanup,
        removed: worktree?.removed === true,
        dirty: worktree?.dirty === true,
        ...(typeof worktree?.error === "string" ? { error: worktree.error } : {}),
        previousWorktreeDir:
          typeof worktree?.previousWorktreeDir === "string" ? worktree.previousWorktreeDir : null,
        resumedWorkspaceDir:
          typeof worktree?.resumedWorkspaceDir === "string" ? worktree.resumedWorkspaceDir : null,
        effectiveOnNextTurn: worktree?.effectiveOnNextTurn !== false,
      });
    },
  };
}
