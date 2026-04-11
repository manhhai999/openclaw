import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  loadLazyLocaleTranslation,
  resolveNavigatorLocale,
} from "../../ui/src/i18n/lib/registry.ts";
import type { TranslationMap } from "../../ui/src/i18n/lib/types.ts";

function getNestedTranslation(map: TranslationMap | null, ...path: string[]): string | undefined {
  let value: string | TranslationMap | undefined = map ?? undefined;
  for (const key of path) {
    if (value === undefined || typeof value === "string") {
      return undefined;
    }
    value = value[key];
  }
  return typeof value === "string" ? value : undefined;
}

describe("ui i18n locale registry", () => {
  it("lists supported locales", () => {
    expect(SUPPORTED_LOCALES).toEqual(["vi", "en"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("resolves browser locale fallbacks", () => {
    expect(resolveNavigatorLocale("vi-VN")).toBe("vi");
    expect(resolveNavigatorLocale("en-US")).toBe("en");
    expect(resolveNavigatorLocale("de-DE")).toBe("vi");
    expect(resolveNavigatorLocale("zh-HK")).toBe("vi");
  });

  it("loads lazy locale translations from the registry", async () => {
    const vi = await loadLazyLocaleTranslation("vi");

    expect(getNestedTranslation(vi, "common", "health")).toBe("Tình trạng");
    expect(await loadLazyLocaleTranslation("en")).toBeNull();
  });
});
