import crypto from "node:crypto";
import { loadConfig } from "../config/config.js";
import type { SessionPlanArtifact } from "../config/sessions.js";
import { loadSessionStore, resolveAllAgentSessionStoreTargetsSync } from "../config/sessions.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { summarizePlanRecords } from "./plan-registry.summary.js";
import type {
  PlanRecord,
  PlanRecordFormat,
  PlanRecordStatus,
  PlanRegistrySummary,
  PlanScopeKind,
  PlanStatusUpdateResult,
  UpdatePlanStatusParams,
} from "./plan-registry.types.js";
import { PlanStatusTransitionError, assertPlanStatusTransition } from "./plan-registry.types.js";

const plans = new Map<string, PlanRecord>();
const planIdsByOwnerKey = new Map<string, Set<string>>();
const planIdsBySessionKey = new Map<string, Set<string>>();
const planIdsByParentPlanId = new Map<string, Set<string>>();

let durableSessionPlansHydrated = false;
let durableSessionPlansHydrationDisabledForTests = false;

function clonePlanRecord(record: PlanRecord): PlanRecord {
  return {
    ...record,
    ...(record.linkedFlowIds ? { linkedFlowIds: [...record.linkedFlowIds] } : {}),
  };
}

function normalizeLinkedFlowIds(linkedFlowIds?: string[]): string[] | undefined {
  if (!linkedFlowIds?.length) {
    return undefined;
  }
  const normalized = [...new Set(linkedFlowIds.map((id) => id.trim()).filter(Boolean))];
  return normalized.length ? normalized : undefined;
}

function formatPlanStepStatus(status: "pending" | "in_progress" | "completed"): " " | "x" | ">" {
  if (status === "completed") {
    return "x";
  }
  if (status === "in_progress") {
    return ">";
  }
  return " ";
}

function buildPlanContentFromSessionArtifact(artifact: SessionPlanArtifact): string {
  const explanation =
    normalizeOptionalString(artifact.lastExplanation) ??
    normalizeOptionalString(artifact.summary) ??
    normalizeOptionalString(artifact.notes) ??
    normalizeOptionalString(artifact.goal);
  const steps =
    artifact.steps?.map((entry) => `- [${formatPlanStepStatus(entry.status)}] ${entry.step}`) ?? [];
  if (explanation && steps.length > 0) {
    return `${explanation}\n\n${steps.join("\n")}`;
  }
  if (steps.length > 0) {
    return steps.join("\n");
  }
  return explanation ?? "Execution plan";
}

function derivePlanTitleFromSessionArtifact(artifact: SessionPlanArtifact): string {
  return (
    artifact.steps?.find((entry) => entry.status === "in_progress")?.step.trim() ||
    artifact.steps?.find((entry) => entry.status === "pending")?.step.trim() ||
    normalizeOptionalString(artifact.summary) ||
    normalizeOptionalString(artifact.lastExplanation) ||
    normalizeOptionalString(artifact.goal) ||
    normalizeOptionalString(artifact.notes) ||
    "Execution plan"
  );
}

function mapFallbackSessionArtifactStatusToPlanStatus(
  artifact: SessionPlanArtifact,
): PlanRecordStatus {
  if (artifact.status === "completed") {
    return "approved";
  }
  if (artifact.status === "cancelled") {
    return "rejected";
  }
  return "draft";
}

function createPlanId(): string {
  return `plan_${crypto.randomUUID()}`;
}

function createFallbackSessionPlanId(sessionKey: string): string {
  const digest = crypto.createHash("sha256").update(sessionKey.trim()).digest("hex").slice(0, 16);
  return `plan_session_${digest}`;
}

function upsertIndex(index: Map<string, Set<string>>, key: string | undefined, planId: string) {
  const normalizedKey = key?.trim();
  if (!normalizedKey) {
    return;
  }
  const existing = index.get(normalizedKey) ?? new Set<string>();
  existing.add(planId);
  index.set(normalizedKey, existing);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string | undefined, planId: string) {
  const normalizedKey = key?.trim();
  if (!normalizedKey) {
    return;
  }
  const existing = index.get(normalizedKey);
  if (!existing) {
    return;
  }
  existing.delete(planId);
  if (existing.size === 0) {
    index.delete(normalizedKey);
  }
}

function indexPlan(record: PlanRecord) {
  upsertIndex(planIdsByOwnerKey, record.ownerKey, record.planId);
  upsertIndex(planIdsBySessionKey, record.sessionKey, record.planId);
  upsertIndex(planIdsByParentPlanId, record.parentPlanId, record.planId);
}

function deindexPlan(record: PlanRecord) {
  removeFromIndex(planIdsByOwnerKey, record.ownerKey, record.planId);
  removeFromIndex(planIdsBySessionKey, record.sessionKey, record.planId);
  removeFromIndex(planIdsByParentPlanId, record.parentPlanId, record.planId);
}

function replacePlanRecord(record: PlanRecord): PlanRecord {
  const existing = plans.get(record.planId);
  if (existing) {
    deindexPlan(existing);
  }
  plans.set(record.planId, clonePlanRecord(record));
  indexPlan(record);
  return clonePlanRecord(record);
}

function buildPlanRecord(params: {
  planId?: string;
  ownerKey: string;
  scopeKind: PlanScopeKind;
  title: string;
  content: string;
  summary?: string;
  format?: PlanRecordFormat;
  sessionKey?: string;
  parentPlanId?: string;
  linkedFlowIds?: string[];
  status?: PlanRecordStatus;
  createdAt?: number;
  updatedAt?: number;
  reviewedAt?: number;
  approvedAt?: number;
  rejectedAt?: number;
  archivedAt?: number;
}): PlanRecord {
  const now = params.updatedAt ?? params.createdAt ?? Date.now();
  const linkedFlowIds = normalizeLinkedFlowIds(params.linkedFlowIds);
  return {
    planId: params.planId?.trim() || createPlanId(),
    ownerKey: params.ownerKey.trim(),
    scopeKind: params.scopeKind,
    ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
    ...(params.parentPlanId?.trim() ? { parentPlanId: params.parentPlanId.trim() } : {}),
    title: params.title.trim(),
    ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
    content: params.content,
    format: params.format ?? "markdown",
    status: params.status ?? "draft",
    ...(linkedFlowIds ? { linkedFlowIds } : {}),
    createdAt: params.createdAt ?? now,
    updatedAt: now,
    ...(typeof params.reviewedAt === "number" ? { reviewedAt: params.reviewedAt } : {}),
    ...(typeof params.approvedAt === "number" ? { approvedAt: params.approvedAt } : {}),
    ...(typeof params.rejectedAt === "number" ? { rejectedAt: params.rejectedAt } : {}),
    ...(typeof params.archivedAt === "number" ? { archivedAt: params.archivedAt } : {}),
  };
}

function applySessionArtifactOverlay(record: PlanRecord, artifact: SessionPlanArtifact): PlanRecord {
  const next = clonePlanRecord(record);
  const artifactSummary =
    normalizeOptionalString(artifact.summary) ?? normalizeOptionalString(artifact.lastExplanation);
  if (!next.summary && artifactSummary) {
    next.summary = artifactSummary;
  }
  if (typeof artifact.updatedAt === "number" && artifact.updatedAt > next.updatedAt) {
    next.updatedAt = artifact.updatedAt;
  }
  if (artifact.status === "completed") {
    if (next.status !== "archived") {
      next.status = "approved";
    }
    if (typeof artifact.approvedAt === "number") {
      next.approvedAt = artifact.approvedAt;
      next.reviewedAt = next.reviewedAt ?? artifact.approvedAt;
    }
  } else if (artifact.status === "cancelled") {
    if (next.status !== "archived") {
      next.status = "rejected";
    }
    const rejectedAt = artifact.exitedAt ?? artifact.updatedAt;
    if (typeof rejectedAt === "number") {
      next.rejectedAt = next.rejectedAt ?? rejectedAt;
      next.reviewedAt = next.reviewedAt ?? rejectedAt;
    }
  }
  return next;
}

function buildPlanRecordFromSessionArtifact(
  sessionKey: string,
  artifact: SessionPlanArtifact,
): PlanRecord | undefined {
  const recordSnapshot = artifact.record;
  if (recordSnapshot) {
    return applySessionArtifactOverlay(
      buildPlanRecord({
        planId: recordSnapshot.planId,
        ownerKey: sessionKey,
        scopeKind: "session",
        sessionKey,
        title: recordSnapshot.title,
        summary: recordSnapshot.summary,
        content: recordSnapshot.content,
        format: recordSnapshot.format,
        status: recordSnapshot.status,
        createdAt: recordSnapshot.createdAt,
        updatedAt: recordSnapshot.updatedAt,
        reviewedAt: recordSnapshot.reviewedAt,
        approvedAt: recordSnapshot.approvedAt,
        rejectedAt: recordSnapshot.rejectedAt,
        archivedAt: recordSnapshot.archivedAt,
      }),
      artifact,
    );
  }

  const hasArtifactData = Boolean(
    artifact.steps?.length ||
      artifact.lastExplanation ||
      artifact.summary ||
      artifact.goal ||
      artifact.notes ||
      artifact.status,
  );
  if (!hasArtifactData) {
    return undefined;
  }

  const createdAt = artifact.enteredAt ?? artifact.updatedAt ?? Date.now();
  const updatedAt = artifact.updatedAt ?? createdAt;
  const status = mapFallbackSessionArtifactStatusToPlanStatus(artifact);
  const rejectedAt =
    status === "rejected" ? (artifact.exitedAt ?? artifact.updatedAt ?? createdAt) : undefined;

  return buildPlanRecord({
    planId: createFallbackSessionPlanId(sessionKey),
    ownerKey: sessionKey,
    scopeKind: "session",
    sessionKey,
    title: derivePlanTitleFromSessionArtifact(artifact),
    summary:
      normalizeOptionalString(artifact.summary) ?? normalizeOptionalString(artifact.lastExplanation),
    content: buildPlanContentFromSessionArtifact(artifact),
    format: "markdown",
    status,
    createdAt,
    updatedAt,
    approvedAt: artifact.approvedAt,
    rejectedAt,
  });
}

function hasSessionPlanInMemory(sessionKey: string): boolean {
  const normalizedSessionKey = sessionKey.trim();
  for (const record of plans.values()) {
    if (record.scopeKind === "session" && record.sessionKey === normalizedSessionKey) {
      return true;
    }
  }
  return false;
}

function ensureDurableSessionPlansHydrated(): void {
  if (durableSessionPlansHydrated || durableSessionPlansHydrationDisabledForTests) {
    return;
  }
  try {
    const cfg = loadConfig();
    const targets = resolveAllAgentSessionStoreTargetsSync(cfg);
    for (const target of targets) {
      const store = loadSessionStore(target.storePath, { skipCache: true });
      for (const [sessionKey, entry] of Object.entries(store)) {
        const artifact = entry?.planArtifact;
        if (!artifact) {
          continue;
        }
        if (!artifact.record && hasSessionPlanInMemory(sessionKey)) {
          continue;
        }
        const record = buildPlanRecordFromSessionArtifact(sessionKey, artifact);
        if (record) {
          replacePlanRecord(record);
        }
      }
    }
    durableSessionPlansHydrated = true;
  } catch {
    // Best-effort hydration only. Live writes still keep the in-memory registry current.
    durableSessionPlansHydrated = false;
  }
}

export function serializePlanRecordForSessionArtifact(
  record: PlanRecord,
): NonNullable<SessionPlanArtifact["record"]> {
  return {
    planId: record.planId,
    title: record.title,
    ...(record.summary ? { summary: record.summary } : {}),
    content: record.content,
    format: record.format,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(typeof record.reviewedAt === "number" ? { reviewedAt: record.reviewedAt } : {}),
    ...(typeof record.approvedAt === "number" ? { approvedAt: record.approvedAt } : {}),
    ...(typeof record.rejectedAt === "number" ? { rejectedAt: record.rejectedAt } : {}),
    ...(typeof record.archivedAt === "number" ? { archivedAt: record.archivedAt } : {}),
  };
}

export function buildSessionDraftPlanRecord(params: {
  sessionKey: string;
  title: string;
  content: string;
  summary?: string;
  updatedAt?: number;
}): PlanRecord {
  ensureDurableSessionPlansHydrated();
  const sessionKey = params.sessionKey.trim();
  const updatedAt = params.updatedAt ?? Date.now();
  const existingDraft = listPlansByIndex(planIdsBySessionKey, sessionKey).find(
    (record) =>
      record.ownerKey === sessionKey && record.scopeKind === "session" && record.status === "draft",
  );
  return buildPlanRecord({
    planId: existingDraft?.planId,
    ownerKey: sessionKey,
    scopeKind: "session",
    sessionKey,
    title: params.title,
    summary: params.summary,
    content: params.content,
    format: "markdown",
    status: "draft",
    createdAt: existingDraft?.createdAt ?? updatedAt,
    updatedAt,
  });
}

export function restorePlanRecord(record: PlanRecord): PlanRecord {
  return replacePlanRecord(record);
}

export function createPlanRecord(params: {
  ownerKey: string;
  scopeKind: PlanScopeKind;
  title: string;
  content: string;
  summary?: string;
  format?: PlanRecordFormat;
  sessionKey?: string;
  parentPlanId?: string;
  linkedFlowIds?: string[];
  status?: PlanRecordStatus;
  createdAt?: number;
  updatedAt?: number;
}): PlanRecord {
  return replacePlanRecord(buildPlanRecord(params));
}

export function listPlanRecords(): PlanRecord[] {
  ensureDurableSessionPlansHydrated();
  return [...plans.values()]
    .map((record) => clonePlanRecord(record))
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.planId.localeCompare(right.planId),
    );
}

export function getPlanById(planId: string): PlanRecord | undefined {
  ensureDurableSessionPlansHydrated();
  const existing = plans.get(planId);
  return existing ? clonePlanRecord(existing) : undefined;
}

function listPlansByIndex(index: Map<string, Set<string>>, key: string): PlanRecord[] {
  const ids = index.get(key.trim());
  if (!ids) {
    return [];
  }
  return [...ids]
    .map((planId) => plans.get(planId))
    .filter((record): record is PlanRecord => Boolean(record))
    .map((record) => clonePlanRecord(record))
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.planId.localeCompare(right.planId),
    );
}

export function listPlansForOwnerKey(ownerKey: string): PlanRecord[] {
  ensureDurableSessionPlansHydrated();
  return listPlansByIndex(planIdsByOwnerKey, ownerKey);
}

export function listPlansForSessionKey(sessionKey: string): PlanRecord[] {
  ensureDurableSessionPlansHydrated();
  return listPlansByIndex(planIdsBySessionKey, sessionKey);
}

export function listChildPlans(parentPlanId: string): PlanRecord[] {
  ensureDurableSessionPlansHydrated();
  return listPlansByIndex(planIdsByParentPlanId, parentPlanId);
}

export function updatePlanRecordById(
  planId: string,
  updates: Partial<
    Pick<
      PlanRecord,
      | "title"
      | "summary"
      | "content"
      | "format"
      | "status"
      | "sessionKey"
      | "parentPlanId"
      | "linkedFlowIds"
    >
  > & {
    updatedAt?: number;
  },
): PlanRecord | undefined {
  const existing = plans.get(planId);
  if (!existing) {
    return undefined;
  }
  const nextStatus = updates.status ?? existing.status;
  const updatedAt = updates.updatedAt ?? Date.now();
  const linkedFlowIds =
    updates.linkedFlowIds !== undefined ? normalizeLinkedFlowIds(updates.linkedFlowIds) : undefined;
  const next: PlanRecord = {
    ...existing,
    ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
    ...(updates.summary !== undefined
      ? updates.summary.trim()
        ? { summary: updates.summary.trim() }
        : { summary: undefined }
      : {}),
    ...(updates.content !== undefined ? { content: updates.content } : {}),
    ...(updates.format !== undefined ? { format: updates.format } : {}),
    ...(updates.sessionKey !== undefined
      ? updates.sessionKey.trim()
        ? { sessionKey: updates.sessionKey.trim() }
        : { sessionKey: undefined }
      : {}),
    ...(updates.parentPlanId !== undefined
      ? updates.parentPlanId.trim()
        ? { parentPlanId: updates.parentPlanId.trim() }
        : { parentPlanId: undefined }
      : {}),
    ...(updates.linkedFlowIds !== undefined
      ? linkedFlowIds
        ? { linkedFlowIds }
        : { linkedFlowIds: undefined }
      : {}),
    status: nextStatus,
    updatedAt,
    reviewedAt:
      nextStatus === "ready_for_review" || nextStatus === "approved" || nextStatus === "rejected"
        ? (existing.reviewedAt ?? updatedAt)
        : existing.reviewedAt,
    approvedAt:
      nextStatus === "approved" ? (existing.approvedAt ?? updatedAt) : existing.approvedAt,
    rejectedAt:
      nextStatus === "rejected" ? (existing.rejectedAt ?? updatedAt) : existing.rejectedAt,
    archivedAt:
      nextStatus === "archived" ? (existing.archivedAt ?? updatedAt) : existing.archivedAt,
  };
  return replacePlanRecord(next);
}

export function upsertSessionDraftPlanRecord(params: {
  sessionKey: string;
  title: string;
  content: string;
  summary?: string;
  updatedAt?: number;
}): PlanRecord {
  return replacePlanRecord(buildSessionDraftPlanRecord(params));
}

export function updatePlanStatus(params: UpdatePlanStatusParams): PlanStatusUpdateResult {
  ensureDurableSessionPlansHydrated();
  const existing = plans.get(params.planId);
  if (!existing) {
    throw new PlanStatusTransitionError("plan_not_found", `plan not found: ${params.planId}`, {
      planId: params.planId,
      to: params.status,
    });
  }
  assertPlanStatusTransition({
    planId: params.planId,
    from: existing.status,
    to: params.status,
  });
  const updated = updatePlanRecordById(params.planId, {
    status: params.status,
    updatedAt: params.updatedAt,
  });
  if (!updated) {
    throw new PlanStatusTransitionError("plan_not_found", `plan not found: ${params.planId}`, {
      planId: params.planId,
      to: params.status,
    });
  }
  return {
    plan: updated,
    previousStatus: existing.status,
  };
}

export function getPlanRegistrySummary(): PlanRegistrySummary {
  ensureDurableSessionPlansHydrated();
  return summarizePlanRecords(plans.values());
}

export function enablePlanRegistryHydrationForTests(): void {
  durableSessionPlansHydrationDisabledForTests = false;
  durableSessionPlansHydrated = false;
}

export function resetPlanRegistryForTests(): void {
  plans.clear();
  planIdsByOwnerKey.clear();
  planIdsBySessionKey.clear();
  planIdsByParentPlanId.clear();
  durableSessionPlansHydrated = false;
  durableSessionPlansHydrationDisabledForTests = true;
}
