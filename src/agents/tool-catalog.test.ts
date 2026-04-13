import { describe, expect, it } from "vitest";
import { resolveCoreToolProfilePolicy } from "./tool-catalog.js";

describe("tool-catalog", () => {
  it("includes planning and discovery tools in the coding profile policy", () => {
    const policy = resolveCoreToolProfilePolicy("coding");
    expect(policy).toBeDefined();
    expect(policy!.allow).toContain("code_execution");
    expect(policy!.allow).toContain("web_search");
    expect(policy!.allow).toContain("x_search");
    expect(policy!.allow).toContain("web_fetch");
    expect(policy!.allow).toContain("image_generate");
    expect(policy!.allow).toContain("music_generate");
    expect(policy!.allow).toContain("video_generate");
    expect(policy!.allow).toContain("update_plan");
    expect(policy!.allow).toContain("tool_search");
    expect(policy!.allow).toContain("EnterPlanMode");
    expect(policy!.allow).toContain("ExitPlanMode");
    expect(policy!.allow).toContain("EnterWorktree");
    expect(policy!.allow).toContain("ExitWorktree");
    expect(policy!.allow).toContain("team_create");
    expect(policy!.allow).toContain("team_status");
    expect(policy!.allow).toContain("team_close");
  });
});
