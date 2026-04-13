import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRecord, PlanRegistrySummary } from "../plans/plan-registry.types.js";
import type { RuntimeEnv } from "../runtime.js";

const { callGatewayMock } = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: [unknown]) => Reflect.apply(callGatewayMock, undefined, args),
}));

import { plansListCommand, plansSetStatusCommand, plansShowCommand } from "./plans.js";

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  } as unknown as RuntimeEnv;
}

function createPlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    planId: "plan_123",
    ownerKey: "agent:main:main",
    scopeKind: "session",
    sessionKey: "session-1",
    title: "Week 1 orchestration metadata",
    summary: "Add inspect-only plan primitives.",
    content: "- extend tool descriptors",
    format: "markdown",
    status: "draft",
    linkedFlowIds: ["flow-1"],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function summarizePlans(plans: PlanRecord[]): PlanRegistrySummary {
  return plans.reduce(
    (summary, plan) => {
      summary.total += 1;
      summary.byStatus[plan.status] += 1;
      if (plan.status === "ready_for_review") {
        summary.reviewable += 1;
      }
      if (plan.status === "approved" || plan.status === "rejected" || plan.status === "archived") {
        summary.terminal += 1;
      }
      return summary;
    },
    {
      total: 0,
      reviewable: 0,
      terminal: 0,
      byStatus: {
        draft: 0,
        ready_for_review: 0,
        approved: 0,
        rejected: 0,
        archived: 0,
      },
    },
  );
}

function createPlansListResult(plans: PlanRecord[]) {
  return {
    count: plans.length,
    summary: summarizePlans(plans),
    plans,
  };
}

describe("plans commands", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("lists plans as JSON with additive metadata", async () => {
    const plan = createPlan({
      status: "ready_for_review",
    });
    callGatewayMock.mockResolvedValueOnce(createPlansListResult([plan]));

    const runtime = createRuntime();
    await plansListCommand({ json: true }, runtime);

    const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
      count: number;
      status: string | null;
      summary: PlanRegistrySummary;
      plans: Array<{ title: string; status: string; linkedFlowIds?: string[] }>;
    };

    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "plans.list",
      params: {},
    });
    expect(payload.count).toBe(1);
    expect(payload.status).toBeNull();
    expect(payload.summary.byStatus.ready_for_review).toBe(1);
    expect(payload.plans[0]).toMatchObject({
      title: "Week 1 orchestration metadata",
      status: "ready_for_review",
      linkedFlowIds: ["flow-1"],
    });
  });

  it("shows one plan by id through the gateway", async () => {
    const plan = createPlan({
      status: "approved",
    });
    callGatewayMock.mockResolvedValueOnce({ plan });

    const runtime = createRuntime();
    await plansShowCommand({ lookup: plan.planId }, runtime);

    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "plans.get",
      params: { planId: plan.planId },
    });
    const lines = vi.mocked(runtime.log).mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(`planId: ${plan.planId}`);
    expect(lines).toContain("status: approved");
    expect(lines).toContain("content:");
    expect(lines).toContain("- extend tool descriptors");
  });

  it("falls back to plans.list when showing a plan by title", async () => {
    const plan = createPlan({
      planId: "plan_456",
      title: "Gateway-backed title lookup",
      status: "approved",
    });
    callGatewayMock.mockRejectedValueOnce(new Error(`unknown plan id "${plan.title}"`));
    callGatewayMock.mockResolvedValueOnce(createPlansListResult([plan]));

    const runtime = createRuntime();
    await plansShowCommand({ lookup: plan.title }, runtime);

    expect(callGatewayMock).toHaveBeenNthCalledWith(1, {
      method: "plans.get",
      params: { planId: plan.title },
    });
    expect(callGatewayMock).toHaveBeenNthCalledWith(2, {
      method: "plans.list",
      params: {},
    });
    const lines = vi.mocked(runtime.log).mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(`planId: ${plan.planId}`);
    expect(lines).toContain(`title: ${plan.title}`);
  });

  it("updates one plan status through the gateway-backed command", async () => {
    const plan = createPlan({
      title: "Gateway-backed status update",
      status: "draft",
    });
    callGatewayMock.mockRejectedValueOnce(new Error(`unknown plan id "${plan.title}"`));
    callGatewayMock.mockResolvedValueOnce(createPlansListResult([plan]));
    callGatewayMock.mockResolvedValueOnce({
      previousStatus: "draft",
      plan: {
        ...plan,
        status: "ready_for_review",
      },
    });

    const runtime = createRuntime();
    await plansSetStatusCommand({ lookup: plan.title, status: "ready_for_review" }, runtime);

    expect(callGatewayMock).toHaveBeenNthCalledWith(1, {
      method: "plans.get",
      params: { planId: plan.title },
    });
    expect(callGatewayMock).toHaveBeenNthCalledWith(2, {
      method: "plans.list",
      params: {},
    });
    expect(callGatewayMock).toHaveBeenNthCalledWith(3, {
      method: "plans.updateStatus",
      params: {
        planId: plan.planId,
        status: "ready_for_review",
      },
    });
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("status from draft to ready_for_review"),
    );
  });

  it("fails when a plan lookup is missing", async () => {
    callGatewayMock.mockRejectedValueOnce(new Error('unknown plan id "missing-plan"'));
    callGatewayMock.mockResolvedValueOnce(createPlansListResult([]));

    const runtime = createRuntime();
    await plansShowCommand({ lookup: "missing-plan" }, runtime);

    expect(runtime.error).toHaveBeenCalledWith("Plan not found: missing-plan");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it("fails on invalid plan status transitions", async () => {
    const plan = createPlan({
      title: "Gateway-backed invalid transition",
      status: "draft",
    });
    callGatewayMock.mockRejectedValueOnce(new Error(`unknown plan id "${plan.title}"`));
    callGatewayMock.mockResolvedValueOnce(createPlansListResult([plan]));
    callGatewayMock.mockRejectedValueOnce(
      new Error("invalid plan status transition draft -> approved"),
    );

    const runtime = createRuntime();
    await plansSetStatusCommand({ lookup: plan.title, status: "approved" }, runtime);

    expect(runtime.error).toHaveBeenCalledWith("invalid plan status transition draft -> approved");
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
