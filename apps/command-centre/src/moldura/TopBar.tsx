/** The frame's top bar (design Tela 1): the page title, search, notifications and the chat toggle. */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bell, MessageSquare, Search } from "lucide-react";
import { useT } from "../i18n";
import { useNotifications } from "../hooks/useNotifications";
import { BellPopover } from "./BellPopover";
import { comboLabel } from "../commands/keys";
import { PALETTE_KEY } from "../commands/global";
import { CHAT_TOGGLE } from "./useFrameLayout";

export interface TopBarProps {
  title: string;
  chatOpen: boolean;
  /** A modal drawer is open: whatever floated over the page goes. */
  modalOpen: boolean;
  onOpenPalette: () => void;
  onToggleChat: () => void;
}

export function TopBar({ title, chatOpen, modalOpen, onOpenPalette, onToggleChat }: TopBarProps) {
  const t = useT();
  const { pathname } = useLocation();
  const { unread } = useNotifications();
  const [bell, setBell] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const bellButton = useRef<HTMLButtonElement>(null);
  // A new page, or a drawer over this one, is a new subject.
  useEffect(() => setBell(false), [pathname, modalOpen]);
  const bellName =
    unread > 0 ? t("moldura.top.notificationsUnread", { n: unread }) : t("moldura.top.notifications");
  return (
    <header className="mold-top">
      <h1 className="mold-title">{title}</h1>
      {/* The text is not drawn on a narrow window; the name stays. */}
      <button
        type="button"
        className="mold-search"
        aria-label={t("moldura.top.search")}
        onClick={onOpenPalette}
      >
        <Search aria-hidden />
        <span className="mold-search-t">{t("moldura.top.search")}</span>
        <kbd className="mold-kbd mono">{comboLabel(PALETTE_KEY)}</kbd>
      </button>
      <span className="mold-top-sp" />
      <div className="mold-bell-wrap" ref={wrap}>
        <button
          type="button"
          ref={bellButton}
          className="mold-icon-btn mold-bell"
          aria-label={bellName}
          title={bellName}
          aria-expanded={bell}
          aria-haspopup="dialog"
          onClick={() => setBell((v) => !v)}
        >
          <Bell aria-hidden />
          {unread > 0 && (
            <span className="mold-dot-count mono" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {bell && (
          <BellPopover
            anchor={wrap}
            onClose={(restoreFocus) => {
              setBell(false);
              if (restoreFocus) bellButton.current?.focus();
            }}
          />
        )}
      </div>
      <button
        type="button"
        className="mold-chat-btn"
        aria-pressed={chatOpen}
        title={t("moldura.top.chatHint", { keys: comboLabel(CHAT_TOGGLE) })}
        onClick={onToggleChat}
      >
        <MessageSquare aria-hidden />
        <span>{t("moldura.top.chat")}</span>
      </button>
    </header>
  );
}
