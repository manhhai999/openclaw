/**
 * Session memory hook handler
 *
 * Saves session context to memory when /new or /reset command is triggered
 * Creates a new dated memory file with LLM-generated slug
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveAgentIdByWorkspacePath,
  resolveAgentWorkspaceDir,
} from "../../../agents/agent-scope.js";
import { resolveTeamFlow, syncTeamFlow } from "../../../agents/team-runtime.js";
import type { OpenClawConfig } from "../../../config/config.js";
import { resolveStateDir } from "../../../config/paths.js";
import { writeFileWithinRoot } from "../../../infra/fs-safe.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../../routing/session-key.js";
import { resolveHookConfig } from "../../config.js";
import type { HookHandler } from "../../hooks.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { findPreviousSessionFile, getRecentSessionContentWithResetFallback } from "./transcript.js";

const log = createSubsystemLogger("hooks/session-memory");

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatTimestampUtc(value: unknown): string | undefined {
  const epochMs = readOptionalNumber(value);
  if (epochMs === undefined) {
    return undefined;
  }
  return new Date(epochMs).toISOString();
}

function buildPlanStateSection(sessionEntry: Record<string, unknown>): string[] {
  const planMode = readOptionalString(sessionEntry.planMode);
  const planArtifact = readOptionalRecord(sessionEntry.planArtifact);
  if (!planMode && !planArtifact) {
    return [];
  }

  const lines = ["## Plan State", ""];
  if (planMode) {
    lines.push(`- **Mode**: ${planMode}`);
  }
  const status = readOptionalString(planArtifact?.status);
  if (status) {
    lines.push(`- **Status**: ${status}`);
  }
  const goal = readOptionalString(planArtifact?.goal);
  if (goal) {
    lines.push(`- **Goal**: ${goal}`);
  }
  const notes = readOptionalString(planArtifact?.notes);
  if (notes) {
    lines.push(`- **Notes**: ${notes}`);
  }
  const summary = readOptionalString(planArtifact?.summary);
  if (summary) {
    lines.push(`- **Summary**: ${summary}`);
  }
  const lastExplanation = readOptionalString(planArtifact?.lastExplanation);
  if (lastExplanation) {
    lines.push(`- **Last Explanation**: ${lastExplanation}`);
  }
  const enteredAt = formatTimestampUtc(planArtifact?.enteredAt);
  if (enteredAt) {
    lines.push(`- **Entered At**: ${enteredAt}`);
  }
  const updatedAt = formatTimestampUtc(planArtifact?.updatedAt);
  if (updatedAt) {
    lines.push(`- **Updated At**: ${updatedAt}`);
  }
  const steps = Array.isArray(planArtifact?.steps) ? planArtifact.steps : [];
  if (steps.length > 0) {
    lines.push("- **Steps**:");
    for (const entry of steps) {
      const step = readOptionalRecord(entry);
      const label = readOptionalString(step?.step);
      if (!label) {
        continue;
      }
      const statusLabel = readOptionalString(step?.status) ?? "pending";
      lines.push(`  - [${statusLabel}] ${label}`);
    }
  }
  lines.push("");
  return lines;
}

function buildWorktreeStateSection(sessionEntry: Record<string, unknown>): string[] {
  const worktreeMode = readOptionalString(sessionEntry.worktreeMode);
  const artifact = readOptionalRecord(sessionEntry.worktreeArtifact);
  if (!worktreeMode && !artifact) {
    return [];
  }

  const lines = ["## Worktree State", ""];
  if (worktreeMode) {
    lines.push(`- **Mode**: ${worktreeMode}`);
  }
  const status = readOptionalString(artifact?.status);
  if (status) {
    lines.push(`- **Status**: ${status}`);
  }
  const repoRoot = readOptionalString(artifact?.repoRoot);
  if (repoRoot) {
    lines.push(`- **Repo Root**: ${repoRoot}`);
  }
  const worktreeDir = readOptionalString(artifact?.worktreeDir);
  if (worktreeDir) {
    lines.push(`- **Worktree Dir**: ${worktreeDir}`);
  }
  const branch = readOptionalString(artifact?.branch);
  if (branch) {
    lines.push(`- **Branch**: ${branch}`);
  }
  const baseRef = readOptionalString(artifact?.baseRef);
  if (baseRef) {
    lines.push(`- **Base Ref**: ${baseRef}`);
  }
  const cleanupPolicy = readOptionalString(artifact?.cleanupPolicy);
  if (cleanupPolicy) {
    lines.push(`- **Cleanup Policy**: ${cleanupPolicy}`);
  }
  const lastError = readOptionalString(artifact?.lastError);
  if (lastError) {
    lines.push(`- **Last Error**: ${lastError}`);
  }
  const createdAt = formatTimestampUtc(artifact?.createdAt);
  if (createdAt) {
    lines.push(`- **Created At**: ${createdAt}`);
  }
  const updatedAt = formatTimestampUtc(artifact?.updatedAt);
  if (updatedAt) {
    lines.push(`- **Updated At**: ${updatedAt}`);
  }
  lines.push("");
  return lines;
}

function buildTeamStateSection(sessionKey: string): string[] {
  try {
    const flow = resolveTeamFlow({ ownerSessionKey: sessionKey });
    if (!flow) {
      return [];
    }
    const view = syncTeamFlow(flow);
    const counts = Object.entries(view.counts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");

    const lines = ["## Team State", "", `- **Team ID**: ${view.state.teamId}`];
    lines.push(`- **Flow Status**: ${view.flow.status}`);
    if (readOptionalString(view.flow.currentStep)) {
      lines.push(`- **Current Step**: ${view.flow.currentStep}`);
    }
    lines.push(`- **Goal**: ${view.state.goal}`);
    lines.push(`- **Active Workers**: ${view.activeCount}`);
    if (counts) {
      lines.push(`- **Worker Counts**: ${counts}`);
    }
    if (readOptionalString(view.state.worktreeDir)) {
      lines.push(`- **Worktree Dir**: ${view.state.worktreeDir}`);
    }
    if (readOptionalString(view.state.summary)) {
      lines.push(`- **Summary**: ${view.state.summary}`);
    }
    if (view.state.members.length > 0) {
      lines.push("- **Members**:");
      for (const member of view.state.members) {
        const label = member.label ?? member.memberId;
        const agentId = readOptionalString(member.agentId);
        const childSessionKey = readOptionalString(member.childSessionKey);
        const details = [
          agentId ? `agent=${agentId}` : undefined,
          childSessionKey ? `session=${childSessionKey}` : undefined,
          member.mode ? `mode=${member.mode}` : undefined,
        ]
          .filter((value): value is string => Boolean(value))
          .join(", ");
        lines.push(`  - [${member.status}] ${label}${details ? ` (${details})` : ""}`);
      }
    }
    lines.push("");
    return lines;
  } catch (error) {
    log.debug("Failed to summarize team state for memory hook", {
      sessionKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function resolveDisplaySessionKey(params: {
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  sessionKey: string;
}): string {
  if (!params.cfg || !params.workspaceDir) {
    return params.sessionKey;
  }
  const workspaceAgentId = resolveAgentIdByWorkspacePath(params.cfg, params.workspaceDir);
  const parsed = parseAgentSessionKey(params.sessionKey);
  if (!workspaceAgentId || !parsed || workspaceAgentId === parsed.agentId) {
    return params.sessionKey;
  }
  return toAgentStoreSessionKey({
    agentId: workspaceAgentId,
    requestKey: parsed.rest,
  });
}

/**
 * Save session context to memory when /new or /reset command is triggered
 */
const saveSessionToMemory: HookHandler = async (event) => {
  // Only trigger on reset/new commands
  const isResetCommand = event.action === "new" || event.action === "reset";
  if (event.type !== "command" || !isResetCommand) {
    return;
  }

  try {
    log.debug("Hook triggered for reset/new command", { action: event.action });

    const context = event.context || {};
    const cfg = context.cfg as OpenClawConfig | undefined;
    const contextWorkspaceDir =
      typeof context.workspaceDir === "string" && context.workspaceDir.trim().length > 0
        ? context.workspaceDir
        : undefined;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir =
      contextWorkspaceDir ||
      (cfg
        ? resolveAgentWorkspaceDir(cfg, agentId)
        : path.join(resolveStateDir(process.env, os.homedir), "workspace"));
    const displaySessionKey = resolveDisplaySessionKey({
      cfg,
      workspaceDir: contextWorkspaceDir,
      sessionKey: event.sessionKey,
    });
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // Get today's date for filename
    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // Generate descriptive slug from session using LLM
    // Prefer previousSessionEntry (old session before /new) over current (which may be empty)
    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {}) as Record<
      string,
      unknown
    >;
    const currentSessionId = sessionEntry.sessionId as string;
    let currentSessionFile = (sessionEntry.sessionFile as string) || undefined;

    // If sessionFile is empty or looks like a new/reset file, try to find the previous session file.
    if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
      const sessionsDirs = new Set<string>();
      if (currentSessionFile) {
        sessionsDirs.add(path.dirname(currentSessionFile));
      }
      sessionsDirs.add(path.join(workspaceDir, "sessions"));

      for (const sessionsDir of sessionsDirs) {
        const recoveredSessionFile = await findPreviousSessionFile({
          sessionsDir,
          currentSessionFile,
          sessionId: currentSessionId,
        });
        if (!recoveredSessionFile) {
          continue;
        }
        currentSessionFile = recoveredSessionFile;
        log.debug("Found previous session file", { file: currentSessionFile });
        break;
      }
    }

    log.debug("Session context resolved", {
      sessionId: currentSessionId,
      sessionFile: currentSessionFile,
      hasCfg: Boolean(cfg),
    });

    const sessionFile = currentSessionFile || undefined;

    // Read message count from hook config (default: 15)
    const hookConfig = resolveHookConfig(cfg, "session-memory");
    const messageCount =
      typeof hookConfig?.messages === "number" && hookConfig.messages > 0
        ? hookConfig.messages
        : 15;

    let slug: string | null = null;
    let sessionContent: string | null = null;

    if (sessionFile) {
      // Get recent conversation content, with fallback to rotated reset transcript.
      sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
      log.debug("Session content loaded", {
        length: sessionContent?.length ?? 0,
        messageCount,
      });

      // Avoid calling the model provider in unit tests; keep hooks fast and deterministic.
      const isTestEnv =
        process.env.OPENCLAW_TEST_FAST === "1" ||
        process.env.VITEST === "true" ||
        process.env.VITEST === "1" ||
        process.env.NODE_ENV === "test";
      const allowLlmSlug = !isTestEnv && hookConfig?.llmSlug !== false;

      if (sessionContent && cfg && allowLlmSlug) {
        log.debug("Calling generateSlugViaLLM...");
        // Use LLM to generate a descriptive slug
        slug = await generateSlugViaLLM({ sessionContent, cfg });
        log.debug("Generated slug", { slug });
      }
    }

    // If no slug, use timestamp
    if (!slug) {
      const timeSlug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "");
      slug = timeSlug.slice(0, 4); // HHMM
      log.debug("Using fallback timestamp slug", { slug });
    }

    // Create filename with date and slug
    const filename = `${dateStr}-${slug}.md`;
    const memoryFilePath = path.join(memoryDir, filename);
    log.debug("Memory file path resolved", {
      filename,
      path: memoryFilePath.replace(os.homedir(), "~"),
    });

    // Format time as HH:MM:SS UTC
    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    // Extract context details
    const sessionId = (sessionEntry.sessionId as string) || "unknown";
    const source = (context.commandSource as string) || "unknown";

    // Build Markdown entry
    const entryParts = [
      `# Session: ${dateStr} ${timeStr} UTC`,
      "",
      `- **Session Key**: ${displaySessionKey}`,
      `- **Session ID**: ${sessionId}`,
      `- **Source**: ${source}`,
      "",
    ];

    // Include conversation content if available
    if (sessionContent) {
      entryParts.push("## Conversation Summary", "", sessionContent, "");
    }

    entryParts.push(...buildPlanStateSection(sessionEntry));
    entryParts.push(...buildWorktreeStateSection(sessionEntry));
    entryParts.push(...buildTeamStateSection(event.sessionKey));

    const entry = entryParts.join("\n");

    // Write under memory root with alias-safe file validation.
    await writeFileWithinRoot({
      rootDir: memoryDir,
      relativePath: filename,
      data: entry,
      encoding: "utf-8",
    });
    log.debug("Memory file written successfully");

    // Log completion (but don't send user-visible confirmation - it's internal housekeeping)
    const relPath = memoryFilePath.replace(os.homedir(), "~");
    log.info(`Session context saved to ${relPath}`);
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to save session memory", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to save session memory", { error: String(err) });
    }
  }
};

export default saveSessionToMemory;
