import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelMessagingAdapter } from "../../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../../config/config.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../../test-utils/channel-plugins.js";
import { runMessageAction } from "./message-action-runner.js";

function parseTelegramTargetForTest(raw: string): {
  chatId: string;
  messageThreadId?: number;
  chatType: "direct" | "group" | "unknown";
} | null {
  const withoutPrefix = raw
    .trim()
    .replace(/^(telegram|tg):/i, "")
    .trim();
  if (!withoutPrefix) {
    return null;
  }
  const topicMatch = /^(.*):topic:(\d+)$/i.exec(withoutPrefix);
  const chatId = topicMatch?.[1]?.trim() || withoutPrefix;
  const messageThreadId = topicMatch?.[2] ? Number.parseInt(topicMatch[2], 10) : undefined;
  const numericId = chatId.startsWith("-") ? chatId.slice(1) : chatId;
  const chatType =
    /^\d+$/.test(numericId) && !chatId.startsWith("-100")
      ? "direct"
      : chatId.startsWith("-")
        ? "group"
        : "unknown";
  return { chatId, messageThreadId, chatType };
}

function normalizeTelegramTargetForTest(raw: string): string | undefined {
  const target = parseTelegramTargetForTest(raw);
  if (!target) {
    return undefined;
  }
  const suffix = target.messageThreadId == null ? "" : `:topic:${String(target.messageThreadId)}`;
  return `telegram:${target.chatId}${suffix}`.toLowerCase();
}

const telegramMessagingForTest: ChannelMessagingAdapter = {
  targetPrefixes: ["telegram", "tg"],
  normalizeTarget: normalizeTelegramTargetForTest,
  parseExplicitTarget: ({ raw }) => {
    const target = parseTelegramTargetForTest(raw);
    if (!target) {
      return null;
    }
    return {
      to: target.chatId,
      threadId: target.messageThreadId,
      chatType: target.chatType === "unknown" ? undefined : target.chatType,
    };
  },
  inferTargetChatType: ({ to }) => {
    const target = parseTelegramTargetForTest(to);
    return !target || target.chatType === "unknown" ? undefined : target.chatType;
  },
  targetResolver: {
    looksLikeId: (raw) => normalizeTelegramTargetForTest(raw) !== undefined,
    hint: "<chatId>",
  },
};

describe("runMessageAction core send routing", () => {
  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("promotes caption to message for media sends when message is empty", async () => {
    const sendMedia = vi.fn().mockResolvedValue({
      channel: "testchat",
      messageId: "m1",
      chatId: "c1",
    });
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "testchat",
          source: "test",
          plugin: createOutboundTestPlugin({
            id: "testchat",
            outbound: {
              deliveryMode: "direct",
              sendText: vi.fn().mockResolvedValue({
                channel: "testchat",
                messageId: "t1",
                chatId: "c1",
              }),
              sendMedia,
            },
          }),
        },
      ]),
    );
    const cfg = {
      channels: {
        testchat: {
          enabled: true,
        },
      },
    } as OpenClawConfig;

    const result = await runMessageAction({
      cfg,
      action: "send",
      params: {
        channel: "testchat",
        target: "channel:abc",
        media: "https://example.com/cat.png",
        caption: "caption-only text",
      },
      dryRun: false,
    });

    expect(result.kind).toBe("send");
    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "caption-only text",
        mediaUrl: "https://example.com/cat.png",
      }),
    );
  });

  it("does not misclassify send as poll when zero-valued poll params are present", async () => {
    const sendMedia = vi.fn().mockResolvedValue({
      channel: "testchat",
      messageId: "m2",
      chatId: "c1",
    });
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "testchat",
          source: "test",
          plugin: createOutboundTestPlugin({
            id: "testchat",
            outbound: {
              deliveryMode: "direct",
              sendText: vi.fn().mockResolvedValue({
                channel: "testchat",
                messageId: "t2",
                chatId: "c1",
              }),
              sendMedia,
            },
          }),
        },
      ]),
    );
    const cfg = {
      channels: {
        testchat: {
          enabled: true,
        },
      },
    } as OpenClawConfig;

    const result = await runMessageAction({
      cfg,
      action: "send",
      params: {
        channel: "testchat",
        target: "channel:abc",
        media: "https://example.com/file.txt",
        message: "hello",
        pollDurationHours: 0,
        pollDurationSeconds: 0,
        pollMulti: false,
        pollQuestion: "",
        pollOption: [],
      },
      dryRun: false,
    });

    expect(result.kind).toBe("send");
    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        mediaUrl: "https://example.com/file.txt",
      }),
    );
  });

  it("accepts Telegram numeric forum topic targets through plugin-owned grammar", async () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          source: "test",
          plugin: createOutboundTestPlugin({
            id: "telegram",
            outbound: {
              deliveryMode: "direct",
              sendText: vi.fn().mockResolvedValue({
                channel: "telegram",
                messageId: "topic-test",
              }),
            },
            messaging: telegramMessagingForTest,
          }),
        },
      ]),
    );

    const result = await runMessageAction({
      cfg: {
        channels: {
          telegram: {
            botToken: "123:test",
          },
        },
      } as OpenClawConfig,
      action: "send",
      params: {
        channel: "telegram",
        target: "-1001234567890:topic:42",
        message: "topic hello",
      },
      dryRun: true,
    });

    if (result.kind !== "send") {
      throw new Error(`Expected send result, got ${result.kind}`);
    }
    expect(result.to).toBe("telegram:-1001234567890:topic:42");
    expect(result.payload).toEqual(
      expect.objectContaining({
        to: "telegram:-1001234567890:topic:42",
        dryRun: true,
      }),
    );
  });
});
