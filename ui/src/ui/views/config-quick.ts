/**
 * Quick Settings view — opinionated card layout for the most common settings.
 * Replaces the raw schema-driven form as the default settings experience.
 *
 * Each card answers a "what do I want to do?" question with status + actions.
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { BorderRadiusStop } from "../storage.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeMode, ThemeName } from "../theme.ts";
import { CONFIG_PRESETS, detectActivePreset, type ConfigPresetId } from "./config-presets.ts";

// ── Types ──

export type QuickSettingsChannel = {
  id: string;
  label: string;
  connected: boolean;
  detail?: string;
};

export type QuickSettingsApiKey = {
  provider: string;
  label: string;
  masked?: string;
  isSet: boolean;
};

export type QuickSettingsAutomation = {
  cronJobCount: number;
  skillCount: number;
  mcpServerCount: number;
};

export type QuickSettingsSecurity = {
  gatewayAuth: string;
  execPolicy: string;
  deviceAuth: boolean;
};

export type QuickSettingsProps = {
  // Model & Thinking
  currentModel: string;
  thinkingLevel: string;
  fastMode: boolean;
  onModelChange?: () => void;
  onThinkingChange?: (level: string) => void;
  onFastModeToggle?: () => void;

  // Channels
  channels: QuickSettingsChannel[];
  onChannelConfigure?: (channelId: string) => void;

  // API Keys
  apiKeys: QuickSettingsApiKey[];
  onApiKeyChange?: (provider: string) => void;

  // Automations
  automation: QuickSettingsAutomation;
  onManageCron?: () => void;
  onBrowseSkills?: () => void;
  onConfigureMcp?: () => void;

  // Security
  security: QuickSettingsSecurity;
  onSecurityConfigure?: () => void;

  // Appearance
  theme: ThemeName;
  themeMode: ThemeMode;
  borderRadius: number;
  setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  setBorderRadius: (value: number) => void;

  // Presets
  configObject?: Record<string, unknown>;
  onApplyPreset?: (presetId: ConfigPresetId) => void;

  // Navigation
  onAdvancedSettings?: () => void;

  // Connection
  connected: boolean;
  gatewayUrl: string;
  assistantName: string;
  version: string;
};

// ── Theme options ──

type ThemeOption = { id: ThemeName; label: string };
const THEME_OPTIONS: ThemeOption[] = [
  { id: "claw", label: "Claw" },
  { id: "knot", label: "Knot" },
  { id: "dash", label: "Dash" },
];

const BORDER_RADIUS_STOPS: Array<{ value: BorderRadiusStop; label: string }> = [
  { value: 0, label: "None" },
  { value: 25, label: "Slight" },
  { value: 50, label: "Default" },
  { value: 75, label: "Round" },
  { value: 100, label: "Full" },
];

const THINKING_LEVELS = ["off", "low", "medium", "high"];

function getThinkingLevelLabel(level: string) {
  const normalized = level.trim().toLowerCase();
  if (normalized === "off") {
    return t("dashboard.quickSettings.thinkingLevels.off");
  }
  if (normalized === "low") {
    return t("dashboard.quickSettings.thinkingLevels.low");
  }
  if (normalized === "medium") {
    return t("dashboard.quickSettings.thinkingLevels.medium");
  }
  if (normalized === "high") {
    return t("dashboard.quickSettings.thinkingLevels.high");
  }
  return level;
}

function getThemeModeLabel(mode: ThemeMode) {
  if (mode === "light") {
    return t("common.light");
  }
  if (mode === "dark") {
    return t("common.dark");
  }
  return t("common.system");
}

function getBorderRadiusLabel(value: BorderRadiusStop) {
  if (value === 0) {
    return t("dashboard.config.appearance.radius.none");
  }
  if (value === 25) {
    return t("dashboard.config.appearance.radius.slight");
  }
  if (value === 50) {
    return t("dashboard.config.appearance.radius.default");
  }
  if (value === 75) {
    return t("dashboard.config.appearance.radius.round");
  }
  return t("dashboard.config.appearance.radius.full");
}

function formatCountLabel(singularKey: string, pluralKey: string, count: number) {
  return t(count === 1 ? singularKey : pluralKey, { count: String(count) });
}

function getPresetCopy(id: ConfigPresetId) {
  return {
    label: t(`dashboard.quickSettings.presets.${id}.label`),
    description: t(`dashboard.quickSettings.presets.${id}.description`),
  };
}

function getGatewayAuthLabel(value: string) {
  if (value === "none") {
    return t("dashboard.quickSettings.authModes.none");
  }
  if (value === "password") {
    return t("dashboard.quickSettings.authModes.password");
  }
  if (value === "token") {
    return t("dashboard.quickSettings.authModes.token");
  }
  if (value === "trusted-proxy") {
    return t("dashboard.quickSettings.authModes.trustedProxy");
  }
  return t("dashboard.quickSettings.authModes.unknown");
}

function getExecPolicyLabel(value: string) {
  if (value === "allowlist") {
    return t("dashboard.quickSettings.execPolicies.allowlist");
  }
  if (value === "full") {
    return t("dashboard.quickSettings.execPolicies.full");
  }
  if (value === "deny") {
    return t("dashboard.quickSettings.execPolicies.deny");
  }
  return t("dashboard.quickSettings.execPolicies.unknown");
}

// ── Card renderers ──

function renderCardHeader(icon: TemplateResult, title: string, action?: TemplateResult) {
  return html`
    <div class="qs-card__header">
      <div class="qs-card__header-left">
        <span class="qs-card__icon">${icon}</span>
        <h3 class="qs-card__title">${title}</h3>
      </div>
      ${action ? action : nothing}
    </div>
  `;
}

function renderModelCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.brain, t("dashboard.quickSettings.cards.modelThinking"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.model")}</span>
          <button class="qs-row__value qs-row__value--action" @click=${props.onModelChange}>
            <code>${props.currentModel || t("dashboard.agent.defaultSuffix")}</code>
            <span class="qs-row__chevron">${icons.chevronRight}</span>
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.thinking")}</span>
          <div class="qs-segmented">
            ${THINKING_LEVELS.map(
              (level) => html`
                <button
                  class="qs-segmented__btn ${level === props.thinkingLevel
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${() => props.onThinkingChange?.(level)}
                >
                  ${getThinkingLevelLabel(level)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.fastMode")}</span>
          <label class="qs-toggle">
            <input type="checkbox" .checked=${props.fastMode} @change=${props.onFastModeToggle} />
            <span class="qs-toggle__track"></span>
            <span class="qs-toggle__hint muted"
              >${props.fastMode
                ? t("dashboard.quickSettings.fastModeOn")
                : t("dashboard.quickSettings.fastModeOff")}</span
            >
          </label>
        </div>
      </div>
    </div>
  `;
}

function renderChannelsCard(props: QuickSettingsProps) {
  const connectedCount = props.channels.filter((c) => c.connected).length;
  const badge =
    connectedCount > 0
      ? html`<span class="qs-badge qs-badge--ok"
          >${t("dashboard.quickSettings.channelsConnected", {
            count: String(connectedCount),
          })}</span
        >`
      : undefined;

  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.send, t("dashboard.quickSettings.cards.channels"), badge)}
      <div class="qs-card__body">
        ${props.channels.length === 0
          ? html`<div class="qs-empty muted">${t("dashboard.quickSettings.noChannels")}</div>`
          : props.channels.map(
              (ch) => html`
                <div class="qs-row">
                  <span class="qs-row__label">
                    <span class="qs-status-dot ${ch.connected ? "qs-status-dot--ok" : ""}"></span>
                    ${ch.label}
                  </span>
                  <span class="qs-row__value">
                    ${ch.connected
                      ? html`<span class="muted">${ch.detail ?? t("common.connected")}</span>`
                      : html`<button
                          class="qs-link-btn"
                          @click=${() => props.onChannelConfigure?.(ch.id)}
                        >
                          ${t("common.connect")} ${icons.chevronRight}
                        </button>`}
                  </span>
                </div>
              `,
            )}
      </div>
    </div>
  `;
}

function renderApiKeysCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.plug, t("dashboard.quickSettings.cards.apiKeys"))}
      <div class="qs-card__body">
        ${props.apiKeys.length === 0
          ? html`<div class="qs-empty muted">${t("dashboard.quickSettings.noApiKeys")}</div>`
          : props.apiKeys.map(
              (key) => html`
                <div class="qs-row">
                  <span class="qs-row__label">${key.label}</span>
                  <span class="qs-row__value">
                    ${key.isSet
                      ? html`
                          <code class="qs-masked">${key.masked ?? "••••••••"}</code>
                          <button
                            class="qs-link-btn"
                            @click=${() => props.onApiKeyChange?.(key.provider)}
                          >
                            ${t("common.change")}
                          </button>
                        `
                      : html`<button
                          class="qs-link-btn"
                          @click=${() => props.onApiKeyChange?.(key.provider)}
                        >
                          ${t("common.add")} ${icons.chevronRight}
                        </button>`}
                  </span>
                </div>
              `,
            )}
      </div>
    </div>
  `;
}

function renderAutomationsCard(props: QuickSettingsProps) {
  const { cronJobCount, skillCount, mcpServerCount } = props.automation;

  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.zap, t("dashboard.quickSettings.cards.automations"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">
            ${formatCountLabel(
              "dashboard.quickSettings.scheduledTasksSingle",
              "dashboard.quickSettings.scheduledTasksPlural",
              cronJobCount,
            )}
          </span>
          <button class="qs-link-btn" @click=${props.onManageCron}>
            ${t("common.manage")} ${icons.chevronRight}
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">
            ${formatCountLabel(
              "dashboard.quickSettings.skillsInstalledSingle",
              "dashboard.quickSettings.skillsInstalledPlural",
              skillCount,
            )}
          </span>
          <button class="qs-link-btn" @click=${props.onBrowseSkills}>
            ${t("common.browse")} ${icons.chevronRight}
          </button>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">
            ${formatCountLabel(
              "dashboard.quickSettings.mcpServersSingle",
              "dashboard.quickSettings.mcpServersPlural",
              mcpServerCount,
            )}
          </span>
          <button class="qs-link-btn" @click=${props.onConfigureMcp}>
            ${t("common.configure")} ${icons.chevronRight}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderSecurityCard(props: QuickSettingsProps) {
  const { gatewayAuth, execPolicy, deviceAuth } = props.security;

  return html`
    <div class="qs-card">
      ${renderCardHeader(
        icons.eye,
        t("dashboard.quickSettings.cards.security"),
        html`<button class="qs-link-btn" @click=${props.onSecurityConfigure}>
          ${t("common.configure")} ${icons.chevronRight}
        </button>`,
      )}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.gatewayAuth")}</span>
          <span class="qs-row__value">
            <span class="qs-badge ${gatewayAuth !== "none" ? "qs-badge--ok" : "qs-badge--warn"}"
              >${getGatewayAuthLabel(gatewayAuth)}</span
            >
          </span>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.execPolicy")}</span>
          <span class="qs-row__value"
            ><span class="qs-badge">${getExecPolicyLabel(execPolicy)}</span></span
          >
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.quickSettings.deviceAuth")}</span>
          <span class="qs-row__value">
            <span class="qs-badge ${deviceAuth ? "qs-badge--ok" : "qs-badge--warn"}"
              >${deviceAuth ? t("common.enabled") : t("common.disabled")}</span
            >
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderAppearanceCard(props: QuickSettingsProps) {
  return html`
    <div class="qs-card">
      ${renderCardHeader(icons.spark, t("dashboard.quickSettings.cards.appearance"))}
      <div class="qs-card__body">
        <div class="qs-row">
          <span class="qs-row__label">${t("common.theme")}</span>
          <div class="qs-segmented">
            ${THEME_OPTIONS.map(
              (opt) => html`
                <button
                  class="qs-segmented__btn ${opt.id === props.theme
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${(e: Event) => {
                    if (opt.id !== props.theme) {
                      props.setTheme(opt.id, {
                        element: (e.currentTarget as HTMLElement) ?? undefined,
                      });
                    }
                  }}
                >
                  ${opt.label}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("common.mode")}</span>
          <div class="qs-segmented">
            ${(["light", "dark", "system"] as ThemeMode[]).map(
              (mode) => html`
                <button
                  class="qs-segmented__btn ${mode === props.themeMode
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${(e: Event) => {
                    if (mode !== props.themeMode) {
                      props.setThemeMode(mode, {
                        element: (e.currentTarget as HTMLElement) ?? undefined,
                      });
                    }
                  }}
                >
                  ${getThemeModeLabel(mode)}
                </button>
              `,
            )}
          </div>
        </div>
        <div class="qs-row">
          <span class="qs-row__label">${t("dashboard.config.appearance.roundnessTitle")}</span>
          <div class="qs-segmented">
            ${BORDER_RADIUS_STOPS.map(
              (stop) => html`
                <button
                  class="qs-segmented__btn qs-segmented__btn--compact ${stop.value ===
                  props.borderRadius
                    ? "qs-segmented__btn--active"
                    : ""}"
                  @click=${() => props.setBorderRadius(stop.value)}
                >
                  ${getBorderRadiusLabel(stop.value)}
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPresetsCard(props: QuickSettingsProps) {
  const activePreset = props.configObject ? detectActivePreset(props.configObject) : "personal";

  return html`
    <div class="qs-card qs-card--span-all">
      ${renderCardHeader(icons.zap, t("dashboard.quickSettings.cards.profile"))}
      <div class="qs-card__body qs-presets-grid">
        ${CONFIG_PRESETS.map((preset) => {
          const copy = getPresetCopy(preset.id);
          return html`
            <button
              class="qs-preset ${preset.id === activePreset ? "qs-preset--active" : ""}"
              @click=${() => props.onApplyPreset?.(preset.id)}
            >
              <span class="qs-preset__icon">${preset.icon}</span>
              <span class="qs-preset__label">${copy.label}</span>
              <span class="qs-preset__desc muted">${copy.description}</span>
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

function renderConnectionFooter(props: QuickSettingsProps) {
  return html`
    <div class="qs-footer">
      <div class="qs-footer__row">
        <span class="qs-status-dot ${props.connected ? "qs-status-dot--ok" : ""}"></span>
        <span class="muted">${props.connected ? t("common.connected") : t("common.offline")}</span>
        ${props.assistantName ? html`<span class="muted">· ${props.assistantName}</span>` : nothing}
        ${props.version ? html`<span class="muted">· v${props.version}</span>` : nothing}
      </div>
    </div>
  `;
}

// ── Main render ──

export function renderQuickSettings(props: QuickSettingsProps) {
  return html`
    <div class="qs-container">
      <div class="qs-header">
        <h2 class="qs-header__title">${icons.settings} ${t("dashboard.quickSettings.title")}</h2>
        <button class="btn btn--sm" @click=${props.onAdvancedSettings}>
          ${t("dashboard.quickSettings.advanced")} ${icons.chevronRight}
        </button>
      </div>

      <div class="qs-grid">
        ${renderModelCard(props)} ${renderChannelsCard(props)} ${renderApiKeysCard(props)}
        ${renderAutomationsCard(props)} ${renderSecurityCard(props)} ${renderAppearanceCard(props)}
        ${renderPresetsCard(props)}
      </div>

      ${renderConnectionFooter(props)}
    </div>
  `;
}
