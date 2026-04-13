import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommandWithTimeout } from "../process/exec.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { createSessionWorktree, removeSessionWorktree } from "./worktree-runtime.js";

async function runGit(cwd: string, argv: string[]) {
  const result = await runCommandWithTimeout(["git", "-C", cwd, ...argv], {
    cwd,
    timeoutMs: 30_000,
  });
  expect(result.code).toBe(0);
}

describe("worktree-runtime", () => {
  it("creates and removes a clean session worktree", async () => {
    await withTempDir({ prefix: "openclaw-worktree-runtime-" }, async (root) => {
      await runGit(root, ["init"]);
      await runGit(root, ["config", "user.email", "tests@example.com"]);
      await runGit(root, ["config", "user.name", "OpenClaw Tests"]);
      await fsp.writeFile(path.join(root, "README.md"), "hello\n", "utf8");
      await runGit(root, ["add", "README.md"]);
      await runGit(root, ["commit", "-m", "init"]);

      const artifact = await createSessionWorktree({
        sessionKey: "agent:main:main",
        workspaceDir: root,
        requestedName: "demo",
        cleanupPolicy: "remove",
      });

      expect(artifact.repoRoot).toBe(root);
      expect(artifact.worktreeDir).toContain(path.join(".openclaw-worktrees", "demo"));
      expect(fs.existsSync(artifact.worktreeDir)).toBe(true);

      const removal = await removeSessionWorktree({
        repoRoot: artifact.repoRoot,
        worktreeDir: artifact.worktreeDir,
      });

      expect(removal).toEqual({
        removed: true,
        dirty: false,
      });
      expect(fs.existsSync(artifact.worktreeDir)).toBe(false);
    });
  });
});
