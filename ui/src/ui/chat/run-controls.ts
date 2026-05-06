import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import { viDashboardText as uiText } from "../vi-dashboard-text.ts";

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
              title=${uiText("New session", "Phiên mới")}
              aria-label=${uiText("New session", "Phiên mới")}
            >
              ${icons.plus}
            </button>
          `}
      <button
        class="btn btn--ghost"
        @click=${props.onExport}
        title=${uiText("Export", "Xuất")}
        aria-label=${uiText("Export chat", "Xuất chat")}
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
              title=${uiText("Queue", "Xếp hàng")}
              aria-label=${uiText("Queue message", "Xếp tin nhắn vào hàng chờ")}
            >
              ${icons.send}
            </button>
            <button
              class="chat-send-btn chat-send-btn--stop"
              @click=${props.onAbort}
              title=${uiText("Stop", "Dừng")}
              aria-label=${uiText("Stop generating", "Dừng tạo phản hồi")}
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
              title=${props.isBusy ? uiText("Queue", "Xếp hàng") : uiText("Send", "Gửi")}
              aria-label=${props.isBusy
                ? uiText("Queue message", "Xếp tin nhắn vào hàng chờ")
                : uiText("Send message", "Gửi tin nhắn")}
            >
              ${icons.send}
            </button>
          `}
    </div>
  `;
}
