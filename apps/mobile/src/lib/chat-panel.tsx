import { usePathname } from 'expo-router';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

/** Width of the chat panel when docked beside the page. */
export const CHAT_PANEL_WIDTH = 420;
/** Below this window width the panel always covers the page; docked, the page would be too cramped. */
const DOCK_MIN_WIDTH = 1100;

type Chat = { id: string; question?: string };

type ChatPanel = {
  /** Whether the panel is showing; with no `chat` it shows the start view and recent conversations. */
  isOpen: boolean;
  chat: Chat | null;
  /** Covering the page rather than docked beside it. */
  expanded: boolean;
  /** Whether the window is wide enough to dock at all. */
  canDock: boolean;
  open: (id: string, question?: string) => void;
  /** Opens the panel's start view. */
  openHome: () => void;
  /** Leaves the conversation for the start view, keeping the panel open. */
  back: () => void;
  close: () => void;
  setExpanded: (expanded: boolean) => void;
};

const ChatPanelContext = createContext<ChatPanel | null>(null);

/** Web: Ask Meld lives in a panel beside the current page instead of on a page of its own. */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const canDock = useWindowDimensions().width >= DOCK_MIN_WIDTH;
  const [isOpen, setIsOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const pathname = usePathname();
  // The page the chat was expanded over; going to another page shows it, with the chat docked beside it.
  const [expandedOn, setExpandedOn] = useState<string | null>(null);
  const expanded = expandedOn === pathname;
  const value = useMemo<ChatPanel>(
    () => ({
      isOpen,
      chat,
      expanded: expanded || !canDock,
      canDock,
      open: (id, question) => {
        setIsOpen(true);
        setChat({ id, question });
      },
      openHome: () => {
        setIsOpen(true);
        setChat(null);
      },
      back: () => setChat(null),
      close: () => {
        setIsOpen(false);
        setChat(null);
        setExpandedOn(null);
      },
      setExpanded: (expand) => setExpandedOn(expand ? pathname : null),
    }),
    [isOpen, chat, expanded, canDock, pathname],
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
  return panel?.isOpen && !panel.expanded ? width - CHAT_PANEL_WIDTH : width;
}
