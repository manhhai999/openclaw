import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { SessionEntry, SessionWorktreeArtifact } from "../config/sessions.js";
import { resolveSessionPreferredWorkspaceDir } from "../config/sessions.js";
import { loadSessionEntry } from "../gateway/session-utils.js";
import { findGitRoot } from "../infra/git-root.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";

const WORKTREE_RUNTIME_TIMEOUT_MS = 30_000;
const WORKTREE_BASE_DIRNAME = ".openclaw-worktrees";

function summarizeCommandFailure(result: {
  stdout?: string;
  stderr?: string;
  code?: number | null;
}): string {
  const stderr = normalizeOptionalString(result.stderr);
  if (stderr) {
    return stderr;
  }
  const stdout = normalizeOptionalString(result.stdout);
  if (stdout) {
    return stdout;
  }
  if (typeof result.code === "number") {
    return `command failed with exit code ${result.code}`;
  }
  return "command failed";
}

async function runGit(argv: string[], cwd: string) {
  const result = await runCommandWithTimeout(["git", "-C", cwd, ...argv], {
    cwd,
    timeoutMs: WORKTREE_RUNTIME_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(summarizeCommandFailure(result));
  }
  return result;
}

function sanitizeWorktreeName(value?: string): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

function createSessionWorktreeName(sessionKey: string): string {
  return sanitizeWorktreeName(sessionKey.replaceAll(":", "-")) ?? "session-worktree";
}

function resolveAvailableWorktreeName(params: {
  worktreeBaseDir: string;
  requestedName: string;
  allowSuffix: boolean;
}): { requestedName: string; worktreeDir: string } {
  const directPath = path.join(params.worktreeBaseDir, params.requestedName);
  if (!fs.existsSync(directPath)) {
    return {
      requestedName: params.requestedName,
      worktreeDir: directPath,
    };
  }
  if (!params.allowSuffix) {
    throw new Error(`Worktree path already exists: ${directPath}`);
  }
  for (let index = 2; index <= 10_000; index += 1) {
    const candidateName = `${params.requestedName}-${index}`;
    const candidatePath = path.join(params.worktreeBaseDir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return {
        requestedName: candidateName,
        worktreeDir: candidatePath,
      };
    }
  }
  throw new Error(
    `Unable to allocate a unique worktree name for ${params.requestedName} in ${params.worktreeBaseDir}`,
  );
}

export async function resolveGitRepoRoot(workspaceDir: string): Promise<string> {
  const fallback = findGitRoot(workspaceDir);
  const result = await runCommandWithTimeout(
    ["git", "-C", workspaceDir, "rev-parse", "--show-toplevel"],
    {
      cwd: workspaceDir,
      timeoutMs: WORKTREE_RUNTIME_TIMEOUT_MS,
    },
  ).catch(() => null);
  const resolved = normalizeOptionalString(result?.stdout);
  if (resolved) {
    return resolved;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error(`No git repository found from ${workspaceDir}`);
}

export async function createSessionWorktree(params: {
  sessionKey: string;
  workspaceDir: string;
  requestedName?: string;
  branch?: string;
  baseRef?: string;
  cleanupPolicy?: "keep" | "remove";
}): Promise<SessionWorktreeArtifact> {
  const repoRoot = await resolveGitRepoRoot(params.workspaceDir);
  const explicitRequestedName = sanitizeWorktreeName(params.requestedName);
  const baseRequestedName = explicitRequestedName ?? createSessionWorktreeName(params.sessionKey);
  const worktreeBaseDir = path.join(repoRoot, WORKTREE_BASE_DIRNAME);
  const resolvedWorktree = resolveAvailableWorktreeName({
    worktreeBaseDir,
    requestedName: baseRequestedName,
    allowSuffix: explicitRequestedName === undefined,
  });
  const { requestedName, worktreeDir } = resolvedWorktree;
  if (path.resolve(worktreeDir) === path.resolve(repoRoot)) {
    throw new Error("Refusing to create a worktree at the repository root.");
  }

  await fsp.mkdir(worktreeBaseDir, { recursive: true });

  const branch = normalizeOptionalString(params.branch);
  const baseRef = normalizeOptionalString(params.baseRef);
  const argv = ["worktree", "add"];
  if (branch) {
    argv.push("-b", branch);
  } else {
    argv.push("--detach");
  }
  argv.push(worktreeDir);
  if (baseRef) {
    argv.push(baseRef);
  }
  await runGit(argv, repoRoot);

  const now = Date.now();
  return {
    repoRoot,
    worktreeDir,
    ...(branch ? { branch } : {}),
    ...(baseRef ? { baseRef } : {}),
    requestedName,
    cwdBefore: params.workspaceDir,
    cleanupPolicy: params.cleanupPolicy ?? "keep",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export async function readWorktreeDirtyState(worktreeDir: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], worktreeDir);
  return Boolean(normalizeOptionalString(result.stdout));
}

export async function removeSessionWorktree(params: {
  repoRoot: string;
  worktreeDir: string;
  force?: boolean;
}): Promise<{ removed: boolean; dirty: boolean; error?: string }> {
  if (!fs.existsSync(params.worktreeDir)) {
    await runCommandWithTimeout(["git", "-C", params.repoRoot, "worktree", "prune"], {
      cwd: params.repoRoot,
      timeoutMs: WORKTREE_RUNTIME_TIMEOUT_MS,
    }).catch(() => null);
    return { removed: true, dirty: false };
  }

  const dirty = await readWorktreeDirtyState(params.worktreeDir).catch(() => false);
  if (dirty && params.force !== true) {
    return {
      removed: false,
      dirty: true,
      error: "Worktree has uncommitted changes. Re-run with force=true to remove it.",
    };
  }

  const argv = ["worktree", "remove"];
  if (params.force === true) {
    argv.push("--force");
  }
  argv.push(params.worktreeDir);
  try {
    await runGit(argv, params.repoRoot);
    await runCommandWithTimeout(["git", "-C", params.repoRoot, "worktree", "prune"], {
      cwd: params.repoRoot,
      timeoutMs: WORKTREE_RUNTIME_TIMEOUT_MS,
    }).catch(() => null);
    return { removed: true, dirty };
  } catch (error) {
    return {
      removed: false,
      dirty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveRuntimeWorkspaceDirForSession(params: {
  sessionKey?: string;
  fallbackWorkspaceDir?: string;
  sessionEntry?: SessionEntry;
}): string | undefined {
  if (params.sessionEntry) {
    return (
      resolveSessionPreferredWorkspaceDir(params.sessionEntry) ??
      normalizeOptionalString(params.fallbackWorkspaceDir)
    );
  }
  const sessionKey = normalizeOptionalString(params.sessionKey);
  if (!sessionKey) {
    return normalizeOptionalString(params.fallbackWorkspaceDir);
  }
  const loaded = loadSessionEntry(sessionKey);
  return (
    resolveSessionPreferredWorkspaceDir(loaded.entry) ??
    normalizeOptionalString(params.fallbackWorkspaceDir)
  );
}
