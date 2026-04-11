import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderExecApprovalPrompt } from "./exec-approval.ts";

function createState() {
  return {
    execApprovalQueue: [],
    execApprovalBusy: false,
    execApprovalError: null,
  } as unknown as Parameters<typeof renderExecApprovalPrompt>[0];
}

describe("renderExecApprovalPrompt", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders plugin route semantics when present", () => {
    const state = createState();
    state.execApprovalQueue = [
      {
        id: "plugin:1",
        kind: "plugin",
        request: { command: "Dangerous command" },
        pluginTitle: "Dangerous command",
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
        routeStatus: "delivery-failed",
        recoverability: "reconnect-recoverable",
      },
    ];

    const root = document.createElement("div");
    render(renderExecApprovalPrompt(state), root);

    expect(root.textContent).toContain("Delivery failed");
    expect(root.textContent).toContain("Recoverable after reconnect");
  });

  it("does not render plugin route semantics for exec approvals", () => {
    const state = createState();
    state.execApprovalQueue = [
      {
        id: "exec-1",
        kind: "exec",
        request: { command: "echo hi" },
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
        routeStatus: "delivery-failed",
        recoverability: "reconnect-recoverable",
      },
    ];

    const root = document.createElement("div");
    render(renderExecApprovalPrompt(state), root);

    expect(root.textContent).not.toContain("Delivery failed");
    expect(root.textContent).not.toContain("Recoverable after reconnect");
  });
});
