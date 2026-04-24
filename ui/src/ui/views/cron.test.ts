import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import type { CronJob } from "../types.ts";
import { renderCron, type CronProps } from "./cron.ts";

function createJob(id: string): CronJob {
  return {
    id,
    name: "Daily ping",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "ping" },
  };
}

function createProps(overrides: Partial<CronProps> = {}): CronProps {
  return {
    basePath: "",
    loading: false,
    jobsLoadingMore: false,
    status: null,
    jobs: [],
    jobsTotal: 0,
    jobsHasMore: false,
    jobsQuery: "",
    jobsEnabledFilter: "all",
    jobsScheduleKindFilter: "all",
    jobsLastStatusFilter: "all",
    jobsSortBy: "nextRunAtMs",
    jobsSortDir: "asc",
    error: null,
    busy: false,
    form: { ...DEFAULT_CRON_FORM },
    fieldErrors: {},
    canSubmit: true,
    editingJobId: null,
    channels: [],
    channelLabels: {},
    runsJobId: null,
    runs: [],
    runsTotal: 0,
    runsHasMore: false,
    runsLoadingMore: false,
    runsScope: "all",
    runsStatuses: [],
    runsDeliveryStatuses: [],
    runsStatusFilter: "all",
    runsQuery: "",
    runsSortDir: "desc",
    agentSuggestions: [],
    modelSuggestions: [],
    thinkingSuggestions: [],
    timezoneSuggestions: [],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: () => undefined,
    onRefresh: () => undefined,
    onAdd: () => undefined,
    onEdit: () => undefined,
    onClone: () => undefined,
    onCancelEdit: () => undefined,
    onToggle: () => undefined,
    onRun: () => undefined,
    onRemove: () => undefined,
    onLoadRuns: () => undefined,
    onLoadMoreJobs: () => undefined,
    onJobsFiltersChange: () => undefined,
    onJobsFiltersReset: () => undefined,
    onLoadMoreRuns: () => undefined,
    onRunsFiltersChange: () => undefined,
    ...overrides,
  };
}

function getButtonByText(container: Element, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (btn) => btn.textContent?.trim() === text,
  );
}

beforeEach(async () => {
  await i18n.setLocale("vi");
});

describe("cron view", () => {
  it("shows all-job history mode and wires run/job filters", () => {
    const container = document.createElement("div");
    const onRunsFiltersChange = vi.fn();
    const onJobsFiltersChange = vi.fn();
    const onJobsFiltersReset = vi.fn();
    render(
      renderCron(
        createProps({
          onRunsFiltersChange,
          onJobsFiltersChange,
          runsScope: "all",
          runs: [
            {
              ts: Date.now(),
              jobId: "job-1",
              status: "ok",
              summary: "done",
              nextRunAtMs: Date.now() - 13 * 60_000,
            },
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("cron.runs.subtitleAll"));
    expect(container.textContent).toContain(t("cron.runs.status"));
    expect(container.textContent).toContain(t("cron.runs.allStatuses"));
    expect(container.textContent).toContain(t("cron.runs.delivery"));
    expect(container.textContent).toContain(t("cron.runs.allDelivery"));
    expect(container.textContent).not.toContain("multi-select");

    const statusOk = container.querySelector(
      '.cron-filter-dropdown[data-filter="status"] input[value="ok"]',
    );
    expect(statusOk).not.toBeNull();
    if (!(statusOk instanceof HTMLInputElement)) {
      return;
    }
    statusOk.checked = true;
    statusOk.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onRunsFiltersChange).toHaveBeenCalledWith({ cronRunsStatuses: ["ok"] });

    const duePrefix = t("cron.runEntry.due", { rel: "__REL__" }).replace("__REL__", "").trim();
    expect(container.textContent).toContain(duePrefix);
    expect(container.textContent).not.toContain(t("cron.runEntry.next", { rel: "13m" }));

    const scheduleSelect = container.querySelector(
      'select[data-test-id="cron-jobs-schedule-filter"]',
    );
    expect(scheduleSelect).not.toBeNull();
    if (!(scheduleSelect instanceof HTMLSelectElement)) {
      return;
    }
    scheduleSelect.value = "cron";
    scheduleSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onJobsFiltersChange).toHaveBeenCalledWith({ cronJobsScheduleKindFilter: "cron" });

    const lastRunSelect = container.querySelector(
      'select[data-test-id="cron-jobs-last-status-filter"]',
    );
    expect(lastRunSelect).not.toBeNull();
    if (!(lastRunSelect instanceof HTMLSelectElement)) {
      return;
    }
    lastRunSelect.value = "error";
    lastRunSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onJobsFiltersChange).toHaveBeenCalledWith({ cronJobsLastStatusFilter: "error" });

    render(
      renderCron(
        createProps({
          jobsQuery: "digest",
          onJobsFiltersReset,
        }),
      ),
      container,
    );

    const reset = container.querySelector('button[data-test-id="cron-jobs-filters-reset"]');
    expect(reset).not.toBeNull();
    reset?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onJobsFiltersReset).toHaveBeenCalledTimes(1);
  });

  it("marks the selected job, routes history clicks, and sorts runs newest first", () => {
    const container = document.createElement("div");
    const onLoadRuns = vi.fn();
    const job = createJob("job-1");
    render(
      renderCron(
        createProps({
          basePath: "/ui",
          jobs: [job],
          runsJobId: "job-1",
          runsScope: "job",
          runs: [
            { ts: 1, jobId: "job-1", status: "ok", summary: "older run" },
            {
              ts: 2,
              jobId: "job-1",
              status: "ok",
              summary: "newer run",
              sessionKey: "agent:main:cron:job-1:run:abc",
            },
          ],
          onLoadRuns,
        }),
      ),
      container,
    );

    const selected = container.querySelector(".list-item-selected");
    expect(selected).not.toBeNull();

    const row = container.querySelector(".list-item-clickable");
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLoadRuns).toHaveBeenCalledWith("job-1");

    const historyButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === t("cron.jobList.history"),
    );
    expect(historyButton).not.toBeUndefined();
    historyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onLoadRuns).toHaveBeenCalledTimes(2);
    expect(onLoadRuns).toHaveBeenNthCalledWith(1, "job-1");
    expect(onLoadRuns).toHaveBeenNthCalledWith(2, "job-1");

    const link = container.querySelector("a.session-link");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain(
      "/ui/chat?session=agent%3Amain%3Acron%3Ajob-1%3Arun%3Aabc",
    );

    expect(container.textContent).toContain(t("cron.runs.subtitleJob", { title: "Daily ping" }));

    const cards = Array.from(container.querySelectorAll(".card"));
    const runHistoryCard = cards.find(
      (card) => card.querySelector(".card-title")?.textContent?.trim() === t("cron.runs.title"),
    );
    expect(runHistoryCard).not.toBeUndefined();

    const summaries = Array.from(
      runHistoryCard?.querySelectorAll(".list-item .list-sub") ?? [],
    ).map((el) => (el.textContent ?? "").trim());
    expect(summaries[0]).toBe("newer run");
    expect(summaries[1]).toBe("older run");
  });

  it("renders supported delivery options and normalizes stale announce selection", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          form: { ...DEFAULT_CRON_FORM, payloadKind: "agentTurn" },
        }),
      ),
      container,
    );

    const options = Array.from(container.querySelectorAll("option")).map((opt) =>
      (opt.textContent ?? "").trim(),
    );
    expect(options).toContain(t("cron.form.webhookPost"));

    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            sessionTarget: "main",
            payloadKind: "systemEvent",
            deliveryMode: "announce",
          },
        }),
      ),
      container,
    );

    const normalizedOptions = Array.from(container.querySelectorAll("option")).map((opt) =>
      (opt.textContent ?? "").trim(),
    );
    expect(normalizedOptions).not.toContain(t("cron.form.announceDefault"));
    expect(normalizedOptions).toContain(t("cron.form.webhookPost"));
    expect(normalizedOptions).toContain(t("cron.form.noneInternal"));
    expect(container.querySelector('input[placeholder="https://example.com/cron"]')).toBeNull();
  });

  it("shows webhook delivery details for jobs", () => {
    const container = document.createElement("div");
    const job = {
      ...createJob("job-2"),
      sessionTarget: "isolated" as const,
      payload: { kind: "agentTurn" as const, message: "do it" },
      delivery: { mode: "webhook" as const, to: "https://example.invalid/cron" },
    };
    render(
      renderCron(
        createProps({
          jobs: [job],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("cron.jobDetail.delivery"));
    expect(container.textContent).toContain("webhook");
    expect(container.textContent).toContain("https://example.invalid/cron");
  });

  it("wires the Edit action and shows save/cancel controls when editing", () => {
    const container = document.createElement("div");
    const onEdit = vi.fn();
    const onLoadRuns = vi.fn();
    const onCancelEdit = vi.fn();
    const job = createJob("job-3");

    render(
      renderCron(
        createProps({
          jobs: [job],
          editingJobId: "job-3",
          onEdit,
          onLoadRuns,
          onCancelEdit,
        }),
      ),
      container,
    );

    const editButton = getButtonByText(container, t("cron.jobList.edit"));
    expect(editButton).not.toBeUndefined();
    editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith(job);
    expect(onLoadRuns).toHaveBeenCalledWith("job-3");

    expect(container.textContent).toContain(t("cron.form.editJob"));
    expect(container.textContent).toContain(t("cron.form.saveChanges"));

    const cancelButton = getButtonByText(container, t("cron.form.cancel"));
    expect(cancelButton).not.toBeUndefined();
    cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("renders cron form sections and toggles advanced controls by schedule", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            scheduleKind: "cron",
            payloadKind: "agentTurn",
            deliveryMode: "announce",
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("cron.form.advanced"));
    expect(container.textContent).toContain(t("cron.form.exactTiming"));
    expect(container.textContent).toContain(t("cron.form.staggerWindow"));
    expect(container.textContent).toContain(t("cron.form.lightContext"));
    expect(container.textContent).toContain(t("cron.form.model"));
    expect(container.textContent).toContain(t("cron.form.thinking"));
    expect(container.textContent).toContain(t("cron.form.bestEffortDelivery"));

    const staggerGroup = container.querySelector(".cron-stagger-group");
    expect(staggerGroup).not.toBeNull();
    expect(staggerGroup?.textContent).toContain(t("cron.form.staggerWindow"));
    expect(staggerGroup?.textContent).toContain(t("cron.form.staggerUnit"));
    expect(container.textContent).toContain(t("cron.form.timeoutHelp"));
    expect(container.textContent).toContain(t("cron.form.jitterHelp"));

    expect(container.textContent).toContain(t("cron.summary.enabled"));
    expect(container.textContent).toContain(t("cron.jobs.title"));
    expect(container.textContent).toContain(t("cron.summary.nextWake"));
    expect(container.textContent).toContain(t("cron.form.basics"));
    expect(container.textContent).toContain(t("cron.form.schedule"));
    expect(container.textContent).toContain(t("cron.form.execution"));
    expect(container.textContent).toContain(t("cron.form.deliverySection"));

    const checkboxLabel = container.querySelector(".cron-checkbox");
    expect(checkboxLabel).not.toBeNull();
    const firstElement = checkboxLabel?.firstElementChild;
    expect(firstElement?.tagName.toLowerCase()).toBe("input");

    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            clearAgent: true,
          },
        }),
      ),
      container,
    );

    const agentInput = container.querySelector(
      `input[placeholder="${t("cron.form.agentPlaceholder")}"]`,
    );
    expect(agentInput).not.toBeNull();
    expect(agentInput instanceof HTMLInputElement).toBe(true);
    expect(agentInput instanceof HTMLInputElement ? agentInput.disabled : false).toBe(true);

    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            scheduleKind: "every",
            payloadKind: "systemEvent",
            deliveryMode: "none",
          },
        }),
      ),
      container,
    );
    expect(container.textContent).not.toContain(t("cron.form.exactTiming"));
    expect(container.textContent).not.toContain(t("cron.form.staggerWindow"));
    expect(container.textContent).not.toContain(t("cron.form.model"));
    expect(container.textContent).not.toContain(t("cron.form.bestEffortDelivery"));
  });

  it("renders inline validation errors, disabled submit, and required aria bindings", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            name: "",
            scheduleKind: "cron",
            cronExpr: "",
            payloadText: "",
          },
          fieldErrors: {
            name: "cron.errors.nameRequired",
            cronExpr: "cron.errors.cronExprRequired",
            payloadText: "cron.errors.agentMessageRequired",
          },
          canSubmit: false,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("cron.errors.nameRequired"));
    expect(container.textContent).toContain(t("cron.errors.cronExprRequired"));
    expect(container.textContent).toContain(t("cron.errors.agentMessageRequired"));
    expect(container.textContent).toContain(t("cron.form.cantAddYet"));
    expect(container.textContent).toContain(t("cron.form.fixFields", { count: "3" }));

    const saveButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      [t("cron.form.addJob"), t("cron.form.saveChanges")].includes(btn.textContent?.trim() ?? ""),
    );
    expect(saveButton).not.toBeUndefined();
    expect(saveButton?.disabled).toBe(true);

    render(
      renderCron(
        createProps({
          form: {
            ...DEFAULT_CRON_FORM,
            scheduleKind: "every",
            name: "",
            everyAmount: "",
            payloadText: "",
          },
          fieldErrors: {
            name: "cron.errors.nameRequired",
            everyAmount: "cron.errors.everyAmountInvalid",
            payloadText: "cron.errors.agentMessageRequired",
          },
          canSubmit: false,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain(t("cron.form.required"));

    const nameInput = container.querySelector("#cron-name");
    expect(nameInput?.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput?.getAttribute("aria-describedby")).toBe("cron-error-name");
    expect(container.querySelector("#cron-error-name")?.textContent).toContain(
      t("cron.errors.nameRequired"),
    );

    const everyInput = container.querySelector("#cron-every-amount");
    expect(everyInput?.getAttribute("aria-invalid")).toBe("true");
    expect(everyInput?.getAttribute("aria-describedby")).toBe("cron-error-everyAmount");
    expect(container.querySelector("#cron-error-everyAmount")?.textContent).toContain(
      t("cron.errors.everyAmountInvalid"),
    );
  });

  it("wires job row actions and selects the row before acting", () => {
    const container = document.createElement("div");
    const onClone = vi.fn();
    const onToggle = vi.fn();
    const onRun = vi.fn();
    const onRemove = vi.fn();
    const actionLoadRuns = vi.fn();
    const actionJob = createJob("job-actions");
    render(
      renderCron(
        createProps({
          jobs: [actionJob],
          onClone,
          onToggle,
          onRun,
          onRemove,
          onLoadRuns: actionLoadRuns,
        }),
      ),
      container,
    );

    const cloneButton = getButtonByText(container, t("cron.jobList.clone"));
    expect(cloneButton).not.toBeUndefined();
    cloneButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const enableButton = getButtonByText(container, t("cron.jobList.disable"));
    expect(enableButton).not.toBeUndefined();
    enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const runButton = getButtonByText(container, t("cron.jobList.run"));
    expect(runButton).not.toBeUndefined();
    runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const runDueButton = getButtonByText(container, "Run if due");
    expect(runDueButton).not.toBeUndefined();
    runDueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const removeButton = getButtonByText(container, t("cron.jobList.remove"));
    expect(removeButton).not.toBeUndefined();
    removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onClone).toHaveBeenCalledWith(actionJob);
    expect(onToggle).toHaveBeenCalledWith(actionJob, false);
    expect(onRun).toHaveBeenNthCalledWith(1, actionJob, "force");
    expect(onRun).toHaveBeenNthCalledWith(2, actionJob, "due");
    expect(onRemove).toHaveBeenCalledWith(actionJob);
    expect(actionLoadRuns).toHaveBeenCalledTimes(5);
    expect(actionLoadRuns).toHaveBeenNthCalledWith(1, "job-actions");
    expect(actionLoadRuns).toHaveBeenNthCalledWith(2, "job-actions");
    expect(actionLoadRuns).toHaveBeenNthCalledWith(3, "job-actions");
    expect(actionLoadRuns).toHaveBeenNthCalledWith(4, "job-actions");
    expect(actionLoadRuns).toHaveBeenNthCalledWith(5, "job-actions");
  });

  it("renders suggestion datalists for agent/model/thinking/timezone", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          form: { ...DEFAULT_CRON_FORM, scheduleKind: "cron", payloadKind: "agentTurn" },
          agentSuggestions: ["main"],
          modelSuggestions: ["openai/gpt-5.2"],
          thinkingSuggestions: ["low"],
          timezoneSuggestions: ["UTC"],
          deliveryToSuggestions: ["+15551234567"],
          accountSuggestions: ["default"],
        }),
      ),
      container,
    );

    expect(container.querySelector("datalist#cron-agent-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-model-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-thinking-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-tz-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-delivery-to-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-delivery-account-suggestions")).not.toBeNull();
    expect(container.querySelector('input[list="cron-agent-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-model-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-thinking-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-tz-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-delivery-to-suggestions"]')).not.toBeNull();
    expect(
      container.querySelector('input[list="cron-delivery-account-suggestions"]'),
    ).not.toBeNull();
  });
});
