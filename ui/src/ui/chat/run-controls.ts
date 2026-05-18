import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import { viDashboardI18nText as uiText } from "../vi-dashboard-text.ts";

export type ChatRunControlsProps = {
  canAbort: boolean;
  connected: boolean;
  draft: string;
  hasMessages: boolean;
  isBusy: boolean;
  sending: boolean;
  onAbort?: () => void;
  onExport: () => void;
  onNewSession: () => void;
  onSend: () => void;
  onStoreDraft: (draft: string) => void;
};

export function renderChatRunControls(props: ChatRunControlsProps) {
  return html`
    <div class="agent-chat__toolbar-right">
      ${props.canAbort
        ? nothing
        : html`
            <button
              class="btn btn--ghost"
              @click=${props.onNewSession}
              title=${uiText("chat.runControls.newSession", "Phiên mới")}
              aria-label=${uiText("chat.runControls.newSession", "Phiên mới")}
            >
              ${icons.plus}
            </button>
          `}
      <button
        class="btn btn--ghost"
        @click=${props.onExport}
        title=${uiText("chat.runControls.export", "Xuất")}
        aria-label=${uiText("chat.runControls.exportChat", "Xuất chat")}
        ?disabled=${!props.hasMessages}
      >
        ${icons.download}
      </button>

      ${props.canAbort
        ? html`
            <button
              class="chat-send-btn"
              @click=${() => {
                if (props.draft.trim()) {
                  props.onStoreDraft(props.draft);
                }
                props.onSend();
              }}
              ?disabled=${!props.connected || props.sending}
              title=${uiText("chat.runControls.queue", "Xếp hàng")}
              aria-label=${uiText("chat.runControls.queueMessage", "Xếp tin nhắn vào hàng chờ")}
            >
              ${icons.send}
            </button>
            <button
              class="chat-send-btn chat-send-btn--stop"
              @click=${props.onAbort}
              title=${uiText("chat.runControls.stop", "Dừng")}
              aria-label=${uiText("chat.runControls.stopGenerating", "Dừng tạo phản hồi")}
            >
              ${icons.stop}
            </button>
          `
        : html`
            <button
              class="chat-send-btn"
              @click=${() => {
                if (props.draft.trim()) {
                  props.onStoreDraft(props.draft);
                }
                props.onSend();
              }}
              ?disabled=${!props.connected || props.sending}
              title=${props.isBusy
                ? uiText("chat.runControls.queue", "Xếp hàng")
                : uiText("chat.runControls.send", "Gửi")}
              aria-label=${props.isBusy
                ? uiText("chat.runControls.queueMessage", "Xếp tin nhắn vào hàng chờ")
                : uiText("chat.runControls.sendMessage", "Gửi tin nhắn")}
            >
              ${icons.send}
            </button>
          `}
    </div>
  `;
}
