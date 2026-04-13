import { randomUUID } from "node:crypto";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { ModelCatalogEntry } from "../agents/model-catalog.js";
import {
  resolveAllowedModelRef,
  resolveDefaultModelForAgent,
  resolveSubagentConfiguredModelSelection,
} from "../agents/model-selection.js";
import { normalizeGroupActivation } from "../auto-reply/group-activation.js";
import {
  formatThinkingLevels,
  formatXHighModelHint,
  normalizeElevatedLevel,
  normalizeFastMode,
  normalizeReasoningLevel,
  normalizeThinkLevel,
  normalizeUsageDisplay,
  supportsXHighThinking,
} from "../auto-reply/thinking.js";
import type { OpenClawConfig } from "../config/config.js";
import type {
  SessionEntry,
  SessionPlanArtifact,
  SessionPlanStep,
  SessionWorktreeArtifact,
} from "../config/sessions.js";
import { normalizeExecTarget } from "../infra/exec-approvals.js";
import {
  isAcpSessionKey,
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { applyVerboseOverride, parseVerboseOverride } from "../sessions/level-overrides.js";
import { applyModelOverrideToSessionEntry } from "../sessions/model-overrides.js";
import { normalizeSendPolicy } from "../sessions/send-policy.js";
import { parseSessionLabel } from "../sessions/session-label.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../shared/string-coerce.js";
import {
  ErrorCodes,
  type ErrorShape,
  errorShape,
  type SessionsPatchParams,
} from "./protocol/index.js";

function invalid(message: string): { ok: false; error: ErrorShape } {
  return { ok: false, error: errorShape(ErrorCodes.INVALID_REQUEST, message) };
}

function normalizeExecSecurity(raw: string): "deny" | "allowlist" | "full" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "deny" || normalized === "allowlist" || normalized === "full") {
    return normalized;
  }
  return undefined;
}

function normalizeExecAsk(raw: string): "off" | "on-miss" | "always" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "off" || normalized === "on-miss" || normalized === "always") {
    return normalized;
  }
  return undefined;
}

function supportsSpawnLineage(storeKey: string): boolean {
  return isSubagentSessionKey(storeKey) || isAcpSessionKey(storeKey);
}

function normalizeSubagentRole(raw: string): "orchestrator" | "leaf" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "orchestrator" || normalized === "leaf") {
    return normalized;
  }
  return undefined;
}

function normalizeSubagentControlScope(raw: string): "children" | "none" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "children" || normalized === "none") {
    return normalized;
  }
  return undefined;
}

function normalizePlanMode(raw: string): "active" | "inactive" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "active" || normalized === "inactive") {
    return normalized;
  }
  return undefined;
}

function normalizePlanArtifactStatus(
  raw: string,
): "active" | "completed" | "cancelled" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "active" || normalized === "completed" || normalized === "cancelled") {
    return normalized;
  }
  return undefined;
}

function normalizeWorktreeMode(raw: string): "active" | "inactive" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "active" || normalized === "inactive") {
    return normalized;
  }
  return undefined;
}

function normalizeWorktreeCleanupPolicy(raw: string): "keep" | "remove" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "keep" || normalized === "remove") {
    return normalized;
  }
  return undefined;
}

function normalizeWorktreeArtifactStatus(
  raw: string,
): "active" | "closed" | "removed" | "remove_failed" | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  if (
    normalized === "active" ||
    normalized === "closed" ||
    normalized === "removed" ||
    normalized === "remove_failed"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizePlanStep(entry: unknown, index: number): SessionPlanStep | { error: string } {
  if (!entry || typeof entry !== "object") {
    return { error: `invalid planArtifact.steps[${index}]` };
  }
  const stepRaw = normalizeOptionalString((entry as { step?: unknown }).step) ?? "";
  if (!stepRaw) {
    return { error: `invalid planArtifact.steps[${index}].step` };
  }
  const statusRaw = normalizeOptionalString((entry as { status?: unknown }).status) ?? "";
  const status = normalizeOptionalLowercaseString(statusRaw);
  if (status !== "pending" && status !== "in_progress" && status !== "completed") {
    return { error: `invalid planArtifact.steps[${index}].status` };
  }
  return {
    step: stepRaw,
    status,
  };
}

function normalizePlanArtifactPatch(raw: unknown): SessionPlanArtifact | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "invalid planArtifact" };
  }
  const artifact = raw as Record<string, unknown>;
  const next: SessionPlanArtifact = {};

  if ("goal" in artifact) {
    const value = normalizeOptionalString(artifact.goal) ?? "";
    if (!value) {
      return { error: "invalid planArtifact.goal" };
    }
    next.goal = value;
  }
  if ("notes" in artifact) {
    const value = normalizeOptionalString(artifact.notes) ?? "";
    if (!value) {
      return { error: "invalid planArtifact.notes" };
    }
    next.notes = value;
  }
  if ("summary" in artifact) {
    const value = normalizeOptionalString(artifact.summary) ?? "";
    if (!value) {
      return { error: "invalid planArtifact.summary" };
    }
    next.summary = value;
  }
  if ("lastExplanation" in artifact) {
    const value = normalizeOptionalString(artifact.lastExplanation) ?? "";
    if (!value) {
      return { error: "invalid planArtifact.lastExplanation" };
    }
    next.lastExplanation = value;
  }
  if ("status" in artifact) {
    const value = normalizeOptionalString(artifact.status) ?? "";
    const status = normalizePlanArtifactStatus(value);
    if (!status) {
      return { error: 'invalid planArtifact.status (use "active"|"completed"|"cancelled")' };
    }
    next.status = status;
  }

  for (const key of ["enteredAt", "updatedAt", "approvedAt", "exitedAt"] as const) {
    if (key in artifact) {
      const value = artifact[key];
      if (!Number.isInteger(value) || (value as number) < 0) {
        return { error: `invalid planArtifact.${key}` };
      }
      next[key] = value as number;
    }
  }

  if ("steps" in artifact) {
    const stepsRaw = artifact.steps;
    if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
      return { error: "invalid planArtifact.steps" };
    }
    const steps = stepsRaw.map((entry, index) => normalizePlanStep(entry, index));
    const normalizedSteps: SessionPlanStep[] = [];
    for (const step of steps) {
      if ("error" in step) {
        return step;
      }
      normalizedSteps.push(step);
    }
    const inProgressCount = normalizedSteps.filter(
      (entry) => entry.status === "in_progress",
    ).length;
    if (inProgressCount > 1) {
      return { error: "planArtifact.steps can contain at most one in_progress item" };
    }
    next.steps = normalizedSteps;
  }

  return next;
}

function normalizeWorktreeArtifactPatch(
  raw: unknown,
): Partial<SessionWorktreeArtifact> | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "invalid worktreeArtifact" };
  }
  const artifact = raw as Record<string, unknown>;
  const next: Partial<SessionWorktreeArtifact> = {};

  for (const key of [
    "repoRoot",
    "worktreeDir",
    "branch",
    "baseRef",
    "requestedName",
    "cwdBefore",
  ] as const) {
    if (key in artifact) {
      const value = normalizeOptionalString(artifact[key]) ?? "";
      if (!value) {
        return { error: `invalid worktreeArtifact.${key}` };
      }
      Object.assign(next, { [key]: value });
    }
  }

  if ("cleanupPolicy" in artifact) {
    const value = normalizeOptionalString(artifact.cleanupPolicy) ?? "";
    const normalized = normalizeWorktreeCleanupPolicy(value);
    if (!normalized) {
      return { error: 'invalid worktreeArtifact.cleanupPolicy (use "keep"|"remove")' };
    }
    next.cleanupPolicy = normalized;
  }

  if ("status" in artifact) {
    const value = normalizeOptionalString(artifact.status) ?? "";
    const normalized = normalizeWorktreeArtifactStatus(value);
    if (!normalized) {
      return {
        error: 'invalid worktreeArtifact.status (use "active"|"closed"|"removed"|"remove_failed")',
      };
    }
    next.status = normalized;
  }

  for (const key of ["createdAt", "updatedAt", "exitedAt"] as const) {
    if (key in artifact) {
      const value = artifact[key];
      if (!Number.isInteger(value) || (value as number) < 0) {
        return { error: `invalid worktreeArtifact.${key}` };
      }
      Object.assign(next, { [key]: value as number });
    }
  }

  if ("lastError" in artifact) {
    const value = normalizeOptionalString(artifact.lastError) ?? "";
    if (!value) {
      return { error: "invalid worktreeArtifact.lastError" };
    }
    next.lastError = value;
  }

  return next;
}

function validateCompleteWorktreeArtifact(
  artifact: Partial<SessionWorktreeArtifact>,
): SessionWorktreeArtifact | { error: string } {
  const repoRoot = normalizeOptionalString(artifact.repoRoot) ?? "";
  if (!repoRoot) {
    return { error: "invalid worktreeArtifact.repoRoot" };
  }
  const worktreeDir = normalizeOptionalString(artifact.worktreeDir) ?? "";
  if (!worktreeDir) {
    return { error: "invalid worktreeArtifact.worktreeDir" };
  }
  if (!Number.isInteger(artifact.createdAt) || (artifact.createdAt as number) < 0) {
    return { error: "invalid worktreeArtifact.createdAt" };
  }
  return {
    repoRoot,
    worktreeDir,
    ...(normalizeOptionalString(artifact.branch) ? { branch: artifact.branch } : {}),
    ...(normalizeOptionalString(artifact.baseRef) ? { baseRef: artifact.baseRef } : {}),
    ...(normalizeOptionalString(artifact.requestedName)
      ? { requestedName: artifact.requestedName }
      : {}),
    ...(normalizeOptionalString(artifact.cwdBefore) ? { cwdBefore: artifact.cwdBefore } : {}),
    ...(artifact.cleanupPolicy ? { cleanupPolicy: artifact.cleanupPolicy } : {}),
    ...(artifact.status ? { status: artifact.status } : {}),
    createdAt: artifact.createdAt as number,
    ...(artifact.updatedAt !== undefined ? { updatedAt: artifact.updatedAt } : {}),
    ...(artifact.exitedAt !== undefined ? { exitedAt: artifact.exitedAt } : {}),
    ...(normalizeOptionalString(artifact.lastError) ? { lastError: artifact.lastError } : {}),
  };
}

export async function applySessionsPatchToStore(params: {
  cfg: OpenClawConfig;
  store: Record<string, SessionEntry>;
  storeKey: string;
  patch: SessionsPatchParams;
  loadGatewayModelCatalog?: () => Promise<ModelCatalogEntry[]>;
}): Promise<{ ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape }> {
  const { cfg, store, storeKey, patch } = params;
  const now = Date.now();
  const parsedAgent = parseAgentSessionKey(storeKey);
  const sessionAgentId = normalizeAgentId(parsedAgent?.agentId ?? resolveDefaultAgentId(cfg));
  const resolvedDefault = resolveDefaultModelForAgent({ cfg, agentId: sessionAgentId });
  const subagentModelHint = isSubagentSessionKey(storeKey)
    ? resolveSubagentConfiguredModelSelection({ cfg, agentId: sessionAgentId })
    : undefined;

  const existing = store[storeKey];
  const next: SessionEntry = existing
    ? {
        ...existing,
        updatedAt: Math.max(existing.updatedAt ?? 0, now),
      }
    : { sessionId: randomUUID(), updatedAt: now };

  if ("spawnedBy" in patch) {
    const raw = patch.spawnedBy;
    if (raw === null) {
      if (existing?.spawnedBy) {
        return invalid("spawnedBy cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      const trimmed = normalizeOptionalString(raw) ?? "";
      if (!trimmed) {
        return invalid("invalid spawnedBy: empty");
      }
      if (!supportsSpawnLineage(storeKey)) {
        return invalid("spawnedBy is only supported for subagent:* or acp:* sessions");
      }
      if (existing?.spawnedBy && existing.spawnedBy !== trimmed) {
        return invalid("spawnedBy cannot be changed once set");
      }
      next.spawnedBy = trimmed;
    }
  }

  if ("spawnedWorkspaceDir" in patch) {
    const raw = patch.spawnedWorkspaceDir;
    if (raw === null) {
      if (existing?.spawnedWorkspaceDir) {
        return invalid("spawnedWorkspaceDir cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      if (!supportsSpawnLineage(storeKey)) {
        return invalid("spawnedWorkspaceDir is only supported for subagent:* or acp:* sessions");
      }
      const trimmed = normalizeOptionalString(raw) ?? "";
      if (!trimmed) {
        return invalid("invalid spawnedWorkspaceDir: empty");
      }
      if (existing?.spawnedWorkspaceDir && existing.spawnedWorkspaceDir !== trimmed) {
        return invalid("spawnedWorkspaceDir cannot be changed once set");
      }
      next.spawnedWorkspaceDir = trimmed;
    }
  }

  if ("spawnDepth" in patch) {
    const raw = patch.spawnDepth;
    if (raw === null) {
      if (typeof existing?.spawnDepth === "number") {
        return invalid("spawnDepth cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      if (!supportsSpawnLineage(storeKey)) {
        return invalid("spawnDepth is only supported for subagent:* or acp:* sessions");
      }
      const numeric = raw;
      if (!Number.isInteger(numeric) || numeric < 0) {
        return invalid("invalid spawnDepth (use an integer >= 0)");
      }
      const normalized = numeric;
      if (typeof existing?.spawnDepth === "number" && existing.spawnDepth !== normalized) {
        return invalid("spawnDepth cannot be changed once set");
      }
      next.spawnDepth = normalized;
    }
  }

  if ("subagentRole" in patch) {
    const raw = patch.subagentRole;
    if (raw === null) {
      if (existing?.subagentRole) {
        return invalid("subagentRole cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      if (!supportsSpawnLineage(storeKey)) {
        return invalid("subagentRole is only supported for subagent:* or acp:* sessions");
      }
      const normalized = normalizeSubagentRole(raw);
      if (!normalized) {
        return invalid('invalid subagentRole (use "orchestrator" or "leaf")');
      }
      if (existing?.subagentRole && existing.subagentRole !== normalized) {
        return invalid("subagentRole cannot be changed once set");
      }
      next.subagentRole = normalized;
    }
  }

  if ("subagentControlScope" in patch) {
    const raw = patch.subagentControlScope;
    if (raw === null) {
      if (existing?.subagentControlScope) {
        return invalid("subagentControlScope cannot be cleared once set");
      }
    } else if (raw !== undefined) {
      if (!supportsSpawnLineage(storeKey)) {
        return invalid("subagentControlScope is only supported for subagent:* or acp:* sessions");
      }
      const normalized = normalizeSubagentControlScope(raw);
      if (!normalized) {
        return invalid('invalid subagentControlScope (use "children" or "none")');
      }
      if (existing?.subagentControlScope && existing.subagentControlScope !== normalized) {
        return invalid("subagentControlScope cannot be changed once set");
      }
      next.subagentControlScope = normalized;
    }
  }

  if ("label" in patch) {
    const raw = patch.label;
    if (raw === null) {
      delete next.label;
    } else if (raw !== undefined) {
      const parsed = parseSessionLabel(raw);
      if (!parsed.ok) {
        return invalid(parsed.error);
      }
      for (const [key, entry] of Object.entries(store)) {
        if (key === storeKey) {
          continue;
        }
        if (entry?.label === parsed.label) {
          return invalid(`label already in use: ${parsed.label}`);
        }
      }
      next.label = parsed.label;
    }
  }

  if ("thinkingLevel" in patch) {
    const raw = patch.thinkingLevel;
    if (raw === null) {
      // Clear the override and fall back to model default
      delete next.thinkingLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeThinkLevel(raw);
      if (!normalized) {
        const hintProvider =
          normalizeOptionalString(existing?.providerOverride) || resolvedDefault.provider;
        const hintModel = normalizeOptionalString(existing?.modelOverride) || resolvedDefault.model;
        return invalid(
          `invalid thinkingLevel (use ${formatThinkingLevels(hintProvider, hintModel, "|")})`,
        );
      }
      next.thinkingLevel = normalized;
    }
  }

  if ("fastMode" in patch) {
    const raw = patch.fastMode;
    if (raw === null) {
      delete next.fastMode;
    } else if (raw !== undefined) {
      const normalized = normalizeFastMode(raw);
      if (normalized === undefined) {
        return invalid("invalid fastMode (use true or false)");
      }
      next.fastMode = normalized;
    }
  }

  if ("verboseLevel" in patch) {
    const raw = patch.verboseLevel;
    const parsed = parseVerboseOverride(raw);
    if (!parsed.ok) {
      return invalid(parsed.error);
    }
    applyVerboseOverride(next, parsed.value);
  }

  if ("reasoningLevel" in patch) {
    const raw = patch.reasoningLevel;
    if (raw === null) {
      delete next.reasoningLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeReasoningLevel(raw);
      if (!normalized) {
        return invalid('invalid reasoningLevel (use "on"|"off"|"stream")');
      }
      // Persist "off" explicitly so that resolveDefaultReasoningLevel()
      // does not re-enable reasoning for capable models (#24406).
      next.reasoningLevel = normalized;
    }
  }

  if ("responseUsage" in patch) {
    const raw = patch.responseUsage;
    if (raw === null) {
      delete next.responseUsage;
    } else if (raw !== undefined) {
      const normalized = normalizeUsageDisplay(raw);
      if (!normalized) {
        return invalid('invalid responseUsage (use "off"|"tokens"|"full")');
      }
      if (normalized === "off") {
        delete next.responseUsage;
      } else {
        next.responseUsage = normalized;
      }
    }
  }

  if ("elevatedLevel" in patch) {
    const raw = patch.elevatedLevel;
    if (raw === null) {
      delete next.elevatedLevel;
    } else if (raw !== undefined) {
      const normalized = normalizeElevatedLevel(raw);
      if (!normalized) {
        return invalid('invalid elevatedLevel (use "on"|"off"|"ask"|"full")');
      }
      // Persist "off" explicitly so patches can override defaults.
      next.elevatedLevel = normalized;
    }
  }

  if ("execHost" in patch) {
    const raw = patch.execHost;
    if (raw === null) {
      delete next.execHost;
    } else if (raw !== undefined) {
      const normalized = normalizeExecTarget(raw) ?? undefined;
      if (!normalized) {
        return invalid('invalid execHost (use "auto"|"sandbox"|"gateway"|"node")');
      }
      next.execHost = normalized;
    }
  }

  if ("execSecurity" in patch) {
    const raw = patch.execSecurity;
    if (raw === null) {
      delete next.execSecurity;
    } else if (raw !== undefined) {
      const normalized = normalizeExecSecurity(raw);
      if (!normalized) {
        return invalid('invalid execSecurity (use "deny"|"allowlist"|"full")');
      }
      next.execSecurity = normalized;
    }
  }

  if ("execAsk" in patch) {
    const raw = patch.execAsk;
    if (raw === null) {
      delete next.execAsk;
    } else if (raw !== undefined) {
      const normalized = normalizeExecAsk(raw);
      if (!normalized) {
        return invalid('invalid execAsk (use "off"|"on-miss"|"always")');
      }
      next.execAsk = normalized;
    }
  }

  if ("execNode" in patch) {
    const raw = patch.execNode;
    if (raw === null) {
      delete next.execNode;
    } else if (raw !== undefined) {
      const trimmed = normalizeOptionalString(raw) ?? "";
      if (!trimmed) {
        return invalid("invalid execNode: empty");
      }
      next.execNode = trimmed;
    }
  }

  if ("model" in patch) {
    const raw = patch.model;
    if (raw === null) {
      applyModelOverrideToSessionEntry({
        entry: next,
        selection: {
          provider: resolvedDefault.provider,
          model: resolvedDefault.model,
          isDefault: true,
        },
        markLiveSwitchPending: true,
      });
    } else if (raw !== undefined) {
      const trimmed = normalizeOptionalString(raw) ?? "";
      if (!trimmed) {
        return invalid("invalid model: empty");
      }
      if (!params.loadGatewayModelCatalog) {
        return {
          ok: false,
          error: errorShape(ErrorCodes.UNAVAILABLE, "model catalog unavailable"),
        };
      }
      const catalog = await params.loadGatewayModelCatalog();
      const resolved = resolveAllowedModelRef({
        cfg,
        catalog,
        raw: trimmed,
        defaultProvider: resolvedDefault.provider,
        defaultModel: subagentModelHint ?? resolvedDefault.model,
      });
      if ("error" in resolved) {
        return invalid(resolved.error);
      }
      const isDefault =
        resolved.ref.provider === resolvedDefault.provider &&
        resolved.ref.model === resolvedDefault.model;
      applyModelOverrideToSessionEntry({
        entry: next,
        selection: {
          provider: resolved.ref.provider,
          model: resolved.ref.model,
          isDefault,
        },
        markLiveSwitchPending: true,
      });
    }
  }

  if (next.thinkingLevel === "xhigh") {
    const effectiveProvider = next.providerOverride ?? resolvedDefault.provider;
    const effectiveModel = next.modelOverride ?? resolvedDefault.model;
    if (!supportsXHighThinking(effectiveProvider, effectiveModel)) {
      if ("thinkingLevel" in patch) {
        return invalid(`thinkingLevel "xhigh" is only supported for ${formatXHighModelHint()}`);
      }
      next.thinkingLevel = "high";
    }
  }

  if ("sendPolicy" in patch) {
    const raw = patch.sendPolicy;
    if (raw === null) {
      delete next.sendPolicy;
    } else if (raw !== undefined) {
      const normalized = normalizeSendPolicy(raw);
      if (!normalized) {
        return invalid('invalid sendPolicy (use "allow"|"deny")');
      }
      next.sendPolicy = normalized;
    }
  }

  if ("groupActivation" in patch) {
    const raw = patch.groupActivation;
    if (raw === null) {
      delete next.groupActivation;
    } else if (raw !== undefined) {
      const normalized = normalizeGroupActivation(raw);
      if (!normalized) {
        return invalid('invalid groupActivation (use "mention"|"always")');
      }
      next.groupActivation = normalized;
    }
  }

  if ("planMode" in patch) {
    const raw = patch.planMode;
    if (raw === null) {
      delete next.planMode;
    } else if (raw !== undefined) {
      const normalized = normalizePlanMode(raw);
      if (!normalized) {
        return invalid('invalid planMode (use "active"|"inactive")');
      }
      next.planMode = normalized;
    }
  }

  if ("planArtifact" in patch) {
    const raw = patch.planArtifact;
    if (raw === null) {
      delete next.planArtifact;
    } else if (raw !== undefined) {
      const normalized = normalizePlanArtifactPatch(raw);
      if ("error" in normalized) {
        return invalid(normalized.error);
      }
      next.planArtifact = {
        ...(existing?.planArtifact ?? next.planArtifact),
        ...normalized,
      };
    }
  }

  if ("worktreeMode" in patch) {
    const raw = patch.worktreeMode;
    if (raw === null) {
      delete next.worktreeMode;
    } else if (raw !== undefined) {
      const normalized = normalizeWorktreeMode(raw);
      if (!normalized) {
        return invalid('invalid worktreeMode (use "active"|"inactive")');
      }
      next.worktreeMode = normalized;
    }
  }

  if ("worktreeArtifact" in patch) {
    const raw = patch.worktreeArtifact;
    if (raw === null) {
      delete next.worktreeArtifact;
    } else if (raw !== undefined) {
      const normalized = normalizeWorktreeArtifactPatch(raw);
      if ("error" in normalized) {
        return invalid(normalized.error);
      }
      const validated = validateCompleteWorktreeArtifact({
        ...(existing?.worktreeArtifact ?? next.worktreeArtifact),
        ...normalized,
      });
      if ("error" in validated) {
        return invalid(validated.error);
      }
      next.worktreeArtifact = validated;
    }
  }

  store[storeKey] = next;
  return { ok: true, entry: next };
}
