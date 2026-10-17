/**
 * The frame's layout state, apart from what it draws: whether the sidebar is
 * folded, whether the conversation is open, and what each means when the
 * window is narrow. On a wide window both are remembered per browser; on a
 * narrow one they start folded and are never remembered — a drawer left open
 * on a phone would greet the next visit from a laptop.
 *
 * Narrow means the sidebar is a rail that unfolds over the content (an
 * overlay, not a push) and the conversation is a drawer over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { CONSOLE_DRAFT_EVENT } from "../desktop/consoleDraft";
import { getDialogDepth } from "../ui";
import { useCommands, type Command } from "../commands/registry";

export const CHAT_KEY = "mordomo.moldura.chat.v1";
/** Shows and hides the conversation. */
export const CHAT_TOGGLE = "Mod+.";
export const SIDEBAR_KEY = "mordomo.moldura.sidebar.v1";
/** Below this the frame cannot hold three columns (design Tela 1, "estreita"). */
export const NARROW = "(max-width: 899px)";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function storeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private mode: the choice lasts this tab */
  }
}

export interface FrameLayout {
  narrow: boolean;
  /** Icons only: the wide choice, or the narrow rail. */
  collapsed: boolean;
  /** Narrow and unfolded: the sidebar is a modal overlay on the content. */
  navOverlay: boolean;
  chatOpen: boolean;
  /** Narrow and open: the conversation is a modal drawer. */
  chatDrawer: boolean;
  toggleSidebar: () => void;
  foldSidebar: () => void;
  setChat: (open: boolean) => void;
}

export function useFrameLayout(): FrameLayout {
  const narrow = useMediaQuery(NARROW);

  const [wideCollapsed, setWideCollapsed] = useState(() => readFlag(SIDEBAR_KEY, false));
  const [narrowCollapsed, setNarrowCollapsed] = useState(true);
  useEffect(() => {
    if (narrow) setNarrowCollapsed(true);
  }, [narrow]);
  const collapsed = narrow ? narrowCollapsed : wideCollapsed;
  const toggleSidebar = useCallback(() => {
    if (narrow) setNarrowCollapsed((v) => !v);
    else {
      const next = !wideCollapsed;
      setWideCollapsed(next);
      storeFlag(SIDEBAR_KEY, next);
    }
  }, [narrow, wideCollapsed]);
  const foldSidebar = useCallback(() => setNarrowCollapsed(true), []);

  const [chatColumn, setChatColumn] = useState(() => readFlag(CHAT_KEY, true));
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  useEffect(() => {
    if (!narrow) setChatDrawerOpen(false);
  }, [narrow]);
  const chatOpen = narrow ? chatDrawerOpen : chatColumn;
  const setChat = useCallback(
    (open: boolean) => {
      if (narrow) setChatDrawerOpen(open);
      else {
        setChatColumn(open);
        storeFlag(CHAT_KEY, open);
      }
    },
    [narrow],
  );

  // Words put on the line from elsewhere ("ask about this", "@ref") need the line on screen.
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  useEffect(() => {
    const onDraft = () => {
      if (!chatOpenRef.current) setChat(true);
    };
    window.addEventListener(CONSOLE_DRAFT_EVENT, onDraft);
    return () => window.removeEventListener(CONSOLE_DRAFT_EVENT, onDraft);
  }, [setChat]);

  // ⌘. / Ctrl . shows and hides the conversation (the `moldura` scope). Esc is each drawer's own
  // (dialog.tsx). The narrow drawer is a modal that hides the frame's keys, so it carries the
  // toggle too — only while it is the dialog on top (the palette over it keeps its own keys).
  const layoutRef = useRef({ setChat, chatDrawer: narrow && chatDrawerOpen });
  layoutRef.current = { setChat, chatDrawer: narrow && chatDrawerOpen };
  const toggle = useMemo<Command[]>(
    () => [
      {
        id: "moldura.chat",
        title: "cmd.moldura.chat",
        group: "actions",
        scope: "moldura",
        icon: MessageSquare,
        keywords: ["chat", "conversa", "console", "voice"],
        keys: [CHAT_TOGGLE],
        palette: true,
        run: () => layoutRef.current.setChat(!chatOpenRef.current),
      },
    ],
    [],
  );
  useCommands(toggle);
  const drawerToggle = useMemo<Command[]>(
    () => [
      {
        id: "moldura.chat.drawer",
        title: "cmd.moldura.chat",
        group: "actions",
        scope: "modal",
        keys: [CHAT_TOGGLE],
        when: () => getDialogDepth() === 1,
        run: () => layoutRef.current.setChat(false),
      },
    ],
    [],
  );
  useCommands(drawerToggle, { enabled: narrow && chatDrawerOpen });

  return {
    narrow,
    collapsed,
    navOverlay: narrow && !narrowCollapsed,
    chatOpen,
    chatDrawer: narrow && chatDrawerOpen,
    toggleSidebar,
    foldSidebar,
    setChat,
  };
}
