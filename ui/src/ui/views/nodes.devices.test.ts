/* @vitest-environment jsdom */
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/lib/translate.ts";
import { renderNodes, type NodesProps } from "./nodes.ts";

function baseProps(overrides: Partial<NodesProps> = {}): NodesProps {
  return {
    loading: false,
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: {
      pending: [],
      paired: [],
    },
    configForm: null,
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configFormMode: "form",
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    execApprovalsTarget: "gateway",
    execApprovalsTargetNodeId: null,
    onRefresh: () => undefined,
    onDevicesRefresh: () => undefined,
    onDeviceApprove: () => undefined,
    onDeviceReject: () => undefined,
    onDeviceRotate: () => undefined,
    onDeviceRevoke: () => undefined,
    onLoadConfig: () => undefined,
    onLoadExecApprovals: () => undefined,
    onBindDefault: () => undefined,
    onBindAgent: () => undefined,
    onSaveBindings: () => undefined,
    onExecApprovalsTargetChange: () => undefined,
    onExecApprovalsSelectAgent: () => undefined,
    onExecApprovalsPatch: () => undefined,
    onExecApprovalsRemove: () => undefined,
    onSaveExecApprovals: () => undefined,
    ...overrides,
  };
}

function renderNodesText(overrides: Partial<NodesProps>): string {
  const container = document.createElement("div");
  render(renderNodes(baseProps(overrides)), container);
  return container.textContent ?? "";
}

describe("nodes devices pending rendering", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(async () => {
    await i18n.setLocale("vi");
  });

  it("shows requested role and scopes for pending approvals", () => {
    const text = renderNodesText({
      devicesList: {
        pending: [
          {
            requestId: "req-1",
            deviceId: "device-1",
            displayName: "Device One",
            role: "operator",
            scopes: ["operator.admin", "operator.read"],
            ts: Date.now(),
          },
        ],
        paired: [],
      },
    });

    expect(text).toContain("role: operator");
    expect(text).toContain("scopes: operator.admin, operator.read");
  });

  it("falls back to roles when role is absent", () => {
    const text = renderNodesText({
      devicesList: {
        pending: [
          {
            requestId: "req-2",
            deviceId: "device-2",
            roles: ["node", "operator"],
            scopes: ["operator.read"],
            ts: Date.now(),
          },
        ],
        paired: [],
      },
    });

    expect(text).toContain("role: node, operator");
    expect(text).toContain("scopes: operator.read");
  });
});
