import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { loadSessionEntry } from "../../gateway/session-utils.js";
import {
  describeExitWorktreeTool,
  EXIT_WORKTREE_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import { removeSessionWorktree } from "../worktree-runtime.js";
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

      const loaded = loadSessionEntry(sessionKey);
      const artifact = loaded.entry?.worktreeArtifact;
      if (!artifact?.worktreeDir) {
        return jsonResult({
          status: "inactive",
          sessionKey,
          removed: false,
        });
      }

      const cleanup =
        params.cleanup === "remove"
          ? "remove"
          : params.cleanup === "keep"
            ? "keep"
            : (artifact.cleanupPolicy ?? "keep");
      const now = Date.now();
      let nextStatus = cleanup === "remove" ? "removed" : "closed";
      let removed = false;
      let dirty = false;
      let error: string | undefined;

      if (cleanup === "remove") {
        const removal = await removeSessionWorktree({
          repoRoot: artifact.repoRoot,
          worktreeDir: artifact.worktreeDir,
          force: params.force === true,
        });
        removed = removal.removed;
        dirty = removal.dirty;
        error = removal.error;
        if (!removed) {
          nextStatus = "remove_failed";
        }
      }

      const gatewayCall = opts.callGateway ?? callGateway;
      await gatewayCall({
        method: "sessions.patch",
        params: {
          key: sessionKey,
          worktreeMode: "inactive",
          worktreeArtifact: {
            ...artifact,
            cleanupPolicy: cleanup,
            status: nextStatus,
            updatedAt: now,
            exitedAt: now,
            ...(error ? { lastError: error } : {}),
          },
        },
        config: opts.config,
      });

      return jsonResult({
        status: "inactive",
        sessionKey,
        cleanup,
        removed,
        dirty,
        error,
        previousWorktreeDir: artifact.worktreeDir,
        resumedWorkspaceDir: artifact.cwdBefore ?? artifact.repoRoot,
        effectiveOnNextTurn: true,
      });
    },
  };
}
