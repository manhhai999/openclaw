/**
 * Simplified automation creation flow — Routines-style guided wizard.
 *
 * "What should it do?" → "When should it run?" → "How should it deliver?"
 *
 * Maps to the existing CronFormState fields under the hood.
 */

import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { CronFormState } from "../ui-types.ts";

// ── Types ──

export type CronQuickCreateProps = {
  open: boolean;
  step: CronQuickCreateStep;
  draft: CronQuickCreateDraft;
  onDraftChange: (patch: Partial<CronQuickCreateDraft>) => void;
  onStepChange: (step: CronQuickCreateStep) => void;
  onCreate: () => void;
  onCancel: () => void;
};

export type CronQuickCreateStep = "what" | "when" | "how";

export type CronQuickCreateDraft = {
  prompt: string;
  name: string;
  schedulePreset: SchedulePresetId | "custom";
  deliveryPreset: DeliveryPresetId;
};

type SchedulePresetId =
  | "every-morning"
  | "every-evening"
  | "hourly"
  | "weekdays"
  | "weekly"
  | "once";

type DeliveryPresetId = "notify" | "silent" | "isolated";

// ── Presets ──

type SchedulePreset = {
  id: SchedulePresetId;
  label: string;
  icon: string;
  description: string;
};

const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "every-morning",
    label: "Every morning",
    icon: "🌅",
    description: "Daily at 8:00 AM",
  },
  {
    id: "every-evening",
    label: "Every evening",
    icon: "🌙",
    description: "Daily at 6:00 PM",
  },
  { id: "hourly", label: "Hourly", icon: "🔄", description: "Every hour" },
  { id: "weekdays", label: "Weekdays", icon: "📅", description: "Mon–Fri at 9:00 AM" },
  { id: "weekly", label: "Weekly", icon: "📆", description: "Every Monday at 9:00 AM" },
  { id: "once", label: "Run once", icon: "⚡", description: "One-time, delete after run" },
];

type DeliveryPreset = {
  id: DeliveryPresetId;
  label: string;
  description: string;
};

const DELIVERY_PRESETS: DeliveryPreset[] = [
  { id: "notify", label: "Notify me", description: "Deliver results to chat" },
  { id: "silent", label: "Silent", description: "Run without notification" },
  { id: "isolated", label: "Independent session", description: "Run in its own session" },
];

function getSchedulePresetCopy(id: SchedulePresetId) {
  if (id === "every-morning") {
    return {
      label: t("cron.quickCreate.schedules.everyMorning.label"),
      description: t("cron.quickCreate.schedules.everyMorning.description"),
    };
  }
  if (id === "every-evening") {
    return {
      label: t("cron.quickCreate.schedules.everyEvening.label"),
      description: t("cron.quickCreate.schedules.everyEvening.description"),
    };
  }
  if (id === "hourly") {
    return {
      label: t("cron.quickCreate.schedules.hourly.label"),
      description: t("cron.quickCreate.schedules.hourly.description"),
    };
  }
  if (id === "weekdays") {
    return {
      label: t("cron.quickCreate.schedules.weekdays.label"),
      description: t("cron.quickCreate.schedules.weekdays.description"),
    };
  }
  if (id === "weekly") {
    return {
      label: t("cron.quickCreate.schedules.weekly.label"),
      description: t("cron.quickCreate.schedules.weekly.description"),
    };
  }
  return {
    label: t("cron.quickCreate.schedules.once.label"),
    description: t("cron.quickCreate.schedules.once.description"),
  };
}

function getDeliveryPresetCopy(id: DeliveryPresetId) {
  if (id === "notify") {
    return {
      label: t("cron.quickCreate.delivery.notify.label"),
      description: t("cron.quickCreate.delivery.notify.description"),
    };
  }
  if (id === "silent") {
    return {
      label: t("cron.quickCreate.delivery.silent.label"),
      description: t("cron.quickCreate.delivery.silent.description"),
    };
  }
  return {
    label: t("cron.quickCreate.delivery.isolated.label"),
    description: t("cron.quickCreate.delivery.isolated.description"),
  };
}

function getStepLabel(step: CronQuickCreateStep) {
  if (step === "what") {
    return t("cron.quickCreate.steps.what");
  }
  if (step === "when") {
    return t("cron.quickCreate.steps.when");
  }
  return t("cron.quickCreate.steps.how");
}

// ── Default draft ──

export function createDefaultDraft(): CronQuickCreateDraft {
  return {
    prompt: "",
    name: "",
    schedulePreset: "every-morning",
    deliveryPreset: "notify",
  };
}

function buildDefaultScheduleAt(now = new Date()): string {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  const hour = String(next.getHours()).padStart(2, "0");
  const minute = String(next.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// ── Convert draft to CronFormState patch ──

export function draftToCronFormPatch(draft: CronQuickCreateDraft): Partial<CronFormState> {
  const patch: Partial<CronFormState> = {
    name: draft.name || t("cron.quickCreate.defaultName"),
    payloadKind: "agentTurn",
    deleteAfterRun: false,
    scheduleAt: "",
    payloadText: draft.prompt,
    enabled: true,
  };

  // Schedule
  switch (draft.schedulePreset) {
    case "every-morning":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 8 * * *";
      break;
    case "every-evening":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 18 * * *";
      break;
    case "hourly":
      patch.scheduleKind = "every";
      patch.everyAmount = "1";
      patch.everyUnit = "hours";
      break;
    case "weekdays":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 9 * * 1-5";
      break;
    case "weekly":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 9 * * 1";
      break;
    case "once":
      patch.scheduleKind = "at";
      patch.scheduleAt = buildDefaultScheduleAt();
      patch.deleteAfterRun = true;
      break;
    default:
      break;
  }

  // Delivery
  switch (draft.deliveryPreset) {
    case "notify":
      patch.sessionTarget = "isolated";
      patch.deliveryMode = "announce";
      patch.wakeMode = "now";
      break;
    case "silent":
      patch.sessionTarget = "main";
      patch.deliveryMode = "none";
      patch.wakeMode = "now";
      break;
    case "isolated":
      patch.sessionTarget = "isolated";
      patch.deliveryMode = "none";
      patch.wakeMode = "now";
      break;
  }

  return patch;
}

// ── Step indicators ──

const STEPS: CronQuickCreateStep[] = ["what", "when", "how"];

function renderStepIndicator(current: CronQuickCreateStep) {
  const currentIdx = STEPS.indexOf(current);
  return html`
    <div class="cqc-steps">
      ${STEPS.map((step, idx) => {
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        return html`
          <div class="cqc-step cqc-step--${state}">
            <span class="cqc-step__dot">${state === "done" ? "✓" : idx + 1}</span>
            <span class="cqc-step__label">${getStepLabel(step)}</span>
          </div>
          ${idx < STEPS.length - 1
            ? html`<div class="cqc-step__line cqc-step__line--${state}"></div>`
            : nothing}
        `;
      })}
    </div>
  `;
}

// ── Step renderers ──

function renderWhatStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.whatTitle")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.whatHint")}</p>
      <textarea
        class="cqc-textarea"
        placeholder=${t("cron.quickCreate.promptPlaceholder")}
        rows="4"
        .value=${props.draft.prompt}
        @input=${(e: Event) =>
          props.onDraftChange({ prompt: (e.target as HTMLTextAreaElement).value })}
      ></textarea>
      <div class="cqc-field">
        <label class="cqc-field__label">${t("cron.quickCreate.nameLabel")}</label>
        <input
          class="cqc-input"
          type="text"
          placeholder=${t("cron.quickCreate.namePlaceholder")}
          .value=${props.draft.name}
          @input=${(e: Event) =>
            props.onDraftChange({ name: (e.target as HTMLInputElement).value })}
        />
      </div>
    </div>
    <div class="cqc-actions">
      <button class="btn" @click=${props.onCancel}>${t("common.cancel")}</button>
      <button
        class="btn primary"
        ?disabled=${!props.draft.prompt.trim()}
        @click=${() => props.onStepChange("when")}
      >
        ${t("common.next")} ${icons.chevronRight}
      </button>
    </div>
  `;
}

function renderWhenStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.whenTitle")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.whenHint")}</p>
      <div class="cqc-preset-grid">
        ${SCHEDULE_PRESETS.map((preset) => {
          const copy = getSchedulePresetCopy(preset.id);
          return html`
            <button
              class="cqc-preset-card ${props.draft.schedulePreset === preset.id
                ? "cqc-preset-card--active"
                : ""}"
              @click=${() => props.onDraftChange({ schedulePreset: preset.id })}
            >
              <span class="cqc-preset-card__icon">${preset.icon}</span>
              <span class="cqc-preset-card__label">${copy.label}</span>
              <span class="cqc-preset-card__desc muted">${copy.description}</span>
            </button>
          `;
        })}
      </div>
    </div>
    <div class="cqc-actions">
      <button class="btn" @click=${() => props.onStepChange("what")}>${t("common.back")}</button>
      <button class="btn primary" @click=${() => props.onStepChange("how")}>
        ${t("common.next")} ${icons.chevronRight}
      </button>
    </div>
  `;
}

function renderHowStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.howTitle")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.howHint")}</p>
      <div class="cqc-delivery-options">
        ${DELIVERY_PRESETS.map((preset) => {
          const copy = getDeliveryPresetCopy(preset.id);
          return html`
            <label
              class="cqc-radio-card ${props.draft.deliveryPreset === preset.id
                ? "cqc-radio-card--active"
                : ""}"
            >
              <input
                type="radio"
                name="delivery"
                .checked=${props.draft.deliveryPreset === preset.id}
                @change=${() => props.onDraftChange({ deliveryPreset: preset.id })}
              />
              <span class="cqc-radio-card__label">${copy.label}</span>
              <span class="cqc-radio-card__desc muted">${copy.description}</span>
            </label>
          `;
        })}
      </div>
    </div>
    <div class="cqc-actions">
      <button class="btn" @click=${() => props.onStepChange("when")}>${t("common.back")}</button>
      <button class="btn primary" @click=${props.onCreate}>
        ${t("common.create")} ${icons.check}
      </button>
    </div>
  `;
}

// ── Main render ──

export function renderCronQuickCreate(props: CronQuickCreateProps) {
  if (!props.open) {
    return nothing;
  }

  return html`
    <div class="cqc-container">
      <div class="cqc-header">
        <h2 class="cqc-header__title">${icons.zap} ${t("cron.quickCreate.title")}</h2>
        <button class="cqc-header__close" @click=${props.onCancel}>${icons.x}</button>
      </div>

      ${renderStepIndicator(props.step)}
      ${props.step === "what"
        ? renderWhatStep(props)
        : props.step === "when"
          ? renderWhenStep(props)
          : renderHowStep(props)}
    </div>
  `;
}
