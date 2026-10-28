import { usePathname } from 'expo-router';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

/** Width of the chat panel when docked beside the page. */
export const CHAT_PANEL_WIDTH = 420;
/** Below this window width the panel always covers the page; docked, the page would be too cramped. */
const DOCK_MIN_WIDTH = 1100;

type Chat = { id: string; question?: string };

type ChatPanel = {
  chat: Chat | null;
  /** Covering the page rather than docked beside it. */
  expanded: boolean;
  /** Whether the window is wide enough to dock at all. */
  canDock: boolean;
  open: (id: string, question?: string) => void;
  close: () => void;
  setExpanded: (expanded: boolean) => void;
};

const ChatPanelContext = createContext<ChatPanel | null>(null);

/** Web: lets "Ask" open a conversation beside the current page instead of navigating to it. */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const canDock = useWindowDimensions().width >= DOCK_MIN_WIDTH;
  const [chat, setChat] = useState<Chat | null>(null);
  const pathname = usePathname();
  // The page the chat was expanded over; going to another page shows it, with the chat docked beside it.
  const [expandedOn, setExpandedOn] = useState<string | null>(null);
  const expanded = expandedOn === pathname;
  const value = useMemo<ChatPanel>(
    () => ({
      chat,
      expanded: expanded || !canDock,
      canDock,
      open: (id, question) => setChat({ id, question }),
      close: () => {
        setChat(null);
        setExpandedOn(null);
      },
      setExpanded: (expand) => setExpandedOn(expand ? pathname : null),
    }),
    [chat, expanded, canDock, pathname],
  );
  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}

/** The chat panel, or null where there isn't one (native, and screens outside the tabs). */
export function useChatPanel() {
  return useContext(ChatPanelContext);
}

/** Width available to the page: the window, less the chat panel when it's docked beside it. */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  const panel = useChatPanel();
  return panel?.chat && !panel.expanded ? width - CHAT_PANEL_WIDTH : width;
}
