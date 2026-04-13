import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import type { ToolsEffectiveResult } from "../../gateway/protocol/index.js";
import { getPluginToolMeta } from "../../plugins/tools.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { getChannelAgentToolMeta } from "../channel-tools.js";
import {
  describeToolSearchTool,
  TOOL_SEARCH_TOOL_DISPLAY_SUMMARY,
} from "../tool-description-presets.js";
import { summarizeToolDescriptionText } from "../tool-description-summary.js";
import { resolveToolDisplay } from "../tool-display.js";
import type { AnyAgentTool } from "./common.js";
import { ToolInputError, jsonResult, readStringParam } from "./common.js";

const ToolSearchToolSchema = Type.Object({
  query: Type.String({
    description: "Search query or `select:<tool1,tool2>` to confirm tool names.",
  }),
  maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
});

type GatewayCaller = typeof callGateway;

type SearchableToolEntry = {
  id: string;
  label: string;
  description: string;
  rawDescription: string;
  source: "core" | "plugin" | "channel";
  pluginId?: string;
  channelId?: string;
  searchHint?: string;
  searchTags?: string[];
  deferred?: boolean;
};

function normalizeText(value: string | undefined): string {
  return (normalizeOptionalString(value) ?? "").toLowerCase();
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveFallbackLabel(tool: AnyAgentTool): string {
  const explicit = normalizeOptionalString(tool.label) ?? "";
  if (explicit && explicit.toLowerCase() !== tool.name.toLowerCase()) {
    return explicit;
  }
  return resolveToolDisplay({ name: tool.name }).title;
}

function resolveFallbackDescription(tool: AnyAgentTool): string {
  return summarizeToolDescriptionText({
    rawDescription: normalizeOptionalString(tool.description) ?? "",
    displaySummary: tool.displaySummary,
  });
}

function resolveFallbackSource(tool: AnyAgentTool): {
  source: "core" | "plugin" | "channel";
  pluginId?: string;
  channelId?: string;
} {
  const pluginMeta = getPluginToolMeta(tool);
  if (pluginMeta) {
    return { source: "plugin", pluginId: pluginMeta.pluginId };
  }
  const channelMeta = getChannelAgentToolMeta(tool as never);
  if (channelMeta) {
    return { source: "channel", channelId: channelMeta.channelId };
  }
  return { source: "core" };
}

function buildFallbackEntry(tool: AnyAgentTool): SearchableToolEntry {
  const rawDescription = normalizeOptionalString(tool.description) ?? "";
  const searchTags = Array.isArray(tool.searchTags)
    ? [
        ...new Set(
          tool.searchTags.map((entry) => normalizeOptionalString(entry) ?? "").filter(Boolean),
        ),
      ]
    : undefined;
  return {
    id: tool.name,
    label: resolveFallbackLabel(tool),
    description: resolveFallbackDescription(tool),
    rawDescription,
    searchHint: normalizeOptionalString(tool.searchHint) ?? undefined,
    searchTags,
    deferred: tool.deferred === true ? true : undefined,
    ...resolveFallbackSource(tool),
  };
}

function scoreEntry(entry: SearchableToolEntry, rawQuery: string, terms: string[]): number {
  const id = normalizeText(entry.id);
  const label = normalizeText(entry.label);
  const description = normalizeText(entry.description);
  const rawDescription = normalizeText(entry.rawDescription);
  const searchHint = normalizeText(entry.searchHint);
  const searchTags = (entry.searchTags ?? []).map((value) => normalizeText(value));
  const blobs = [id, label, description, rawDescription, searchHint, ...searchTags].filter(Boolean);

  let score = 0;
  if (id === rawQuery) {
    score += 220;
  }
  if (label === rawQuery) {
    score += 200;
  }
  if (id.includes(rawQuery)) {
    score += 120;
  }
  if (label.includes(rawQuery)) {
    score += 100;
  }
  if (searchTags.some((value) => value === rawQuery)) {
    score += 90;
  }
  if (searchHint.includes(rawQuery)) {
    score += 80;
  }
  if (description.includes(rawQuery) || rawDescription.includes(rawQuery)) {
    score += 50;
  }

  let matchedTerms = 0;
  for (const term of terms) {
    if (blobs.some((blob) => blob.includes(term))) {
      matchedTerms += 1;
      score += 20;
    }
  }

  if (score === 0 || matchedTerms === 0) {
    return 0;
  }
  if (matchedTerms === terms.length) {
    score += 25;
  }
  return score;
}

function flattenInventory(result: ToolsEffectiveResult): SearchableToolEntry[] {
  return result.groups.flatMap((group) =>
    group.tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
      rawDescription: tool.rawDescription,
      source: tool.source,
      pluginId: tool.pluginId,
      channelId: tool.channelId,
      searchHint: "searchHint" in tool ? tool.searchHint : undefined,
      searchTags: "searchTags" in tool ? tool.searchTags : undefined,
      deferred: "deferred" in tool ? tool.deferred : undefined,
    })),
  );
}

function resolveSelectedTools(entries: SearchableToolEntry[], rawSelection: string) {
  const requested = rawSelection
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    throw new ToolInputError("select:<tool> requires at least one tool name");
  }

  const byNormalized = new Map<string, SearchableToolEntry>();
  for (const entry of entries) {
    byNormalized.set(normalizeText(entry.id), entry);
    byNormalized.set(normalizeText(entry.label), entry);
  }

  const selected: string[] = [];
  const missing: string[] = [];
  for (const raw of requested) {
    const match = byNormalized.get(normalizeText(raw));
    if (!match) {
      missing.push(raw);
      continue;
    }
    if (!selected.includes(match.id)) {
      selected.push(match.id);
    }
  }
  return { selected, missing };
}

export function createToolSearchTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
  callGateway?: GatewayCaller;
  resolveAvailableTools?: () => AnyAgentTool[];
}): AnyAgentTool {
  return {
    label: "Tool Search",
    name: "tool_search",
    displaySummary: TOOL_SEARCH_TOOL_DISPLAY_SUMMARY,
    description: describeToolSearchTool(),
    searchHint: "Search built-in and plugin tools by intent before choosing one.",
    searchTags: ["search", "tools", "inventory", "discover", "plugin"],
    parameters: ToolSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const maxResults =
        typeof params.maxResults === "number" && Number.isFinite(params.maxResults)
          ? Math.max(1, Math.min(20, Math.floor(params.maxResults)))
          : 8;
      const gatewayCall = opts?.callGateway ?? callGateway;

      let inventory: SearchableToolEntry[] = [];
      if (opts?.agentSessionKey) {
        try {
          const result = await gatewayCall<ToolsEffectiveResult>({
            method: "tools.effective",
            params: { sessionKey: opts.agentSessionKey },
            config: opts.config,
          });
          inventory = flattenInventory(result);
        } catch {
          inventory = [];
        }
      }
      if (inventory.length === 0) {
        inventory = (opts?.resolveAvailableTools?.() ?? []).map(buildFallbackEntry);
      }
      if (inventory.length === 0) {
        throw new ToolInputError("tool inventory unavailable");
      }

      const selectPrefix = "select:";
      if (query.toLowerCase().startsWith(selectPrefix)) {
        const { selected, missing } = resolveSelectedTools(
          inventory,
          query.slice(selectPrefix.length).trim(),
        );
        return jsonResult({
          status: "selected",
          selected,
          missing,
          note: "Selection is advisory in the current runtime; matching tools are already available when listed.",
        });
      }

      const normalizedQuery = normalizeText(query);
      const terms = tokenize(query);
      if (terms.length === 0) {
        throw new ToolInputError("query required");
      }

      const matches = inventory
        .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery, terms) }))
        .filter((entry) => entry.score > 0)
        .toSorted((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
        .slice(0, maxResults)
        .map(({ entry, score }) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description,
          source: entry.source,
          pluginId: entry.pluginId,
          channelId: entry.channelId,
          searchTags: entry.searchTags,
          deferred: entry.deferred,
          score,
        }));

      return jsonResult({
        status: "results",
        query,
        totalMatches: matches.length,
        matches,
      });
    },
  };
}
