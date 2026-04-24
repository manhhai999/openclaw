import { describe, expect, it } from "vitest";
import { buildChannelsTableFromGatewayStatus } from "./channels.ts";

describe("buildChannelsTableFromGatewayStatus", () => {
  it("preserves unstable gateway summaries when linked is omitted", () => {
    const { rows } = buildChannelsTableFromGatewayStatus({
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelAccounts: {
        whatsapp: [{ enabled: true, configured: true }],
      },
      channels: {
        whatsapp: {
          configured: true,
          statusState: "unstable",
        },
      },
    });

    expect(rows).toEqual([
      {
        id: "whatsapp",
        label: "WhatsApp",
        enabled: true,
        state: "warn",
        detail: "auth stabilizing",
      },
    ]);
  });

  it("uses statusState-linked summaries even when the boolean linked field is omitted", () => {
    const { rows } = buildChannelsTableFromGatewayStatus({
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channelAccounts: {
        telegram: [{ enabled: true, configured: true }],
      },
      channels: {
        telegram: {
          configured: true,
          statusState: "linked",
        },
      },
    });

    expect(rows).toEqual([
      {
        id: "telegram",
        label: "Telegram",
        enabled: true,
        state: "ok",
        detail: "linked",
      },
    ]);
  });
});
