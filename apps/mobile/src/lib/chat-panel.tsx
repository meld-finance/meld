import { usePathname } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { prefs } from './prefs';
import { useSetupStatus } from './setup';

/** Default width of the chat panel when docked beside the page; dragging its edge resizes it. */
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH = 900;
/** Room left for the sidebar and page when the panel is dragged wide. */
const PAGE_MIN_WIDTH = 248 + 480;
const WIDTH_KEY = 'chatPanelWidth';
/** Below this window width the panel always covers the page; docked, the page would be too cramped. */
const DOCK_MIN_WIDTH = 1100;

type Chat = { id: string; question?: string };

type ChatPanel = {
  /** Whether the panel is showing; with no `chat` it shows questions about the current page. */
  isOpen: boolean;
  chat: Chat | null;
  /** Covering the page rather than docked beside it. */
  expanded: boolean;
  /** Whether the window is wide enough to dock at all. */
  canDock: boolean;
  /** Docked width, kept within what the window allows. */
  width: number;
  /** Resizes the docked panel; `save` remembers the width for next time (on drag end, not every move). */
  setWidth: (width: number, save?: boolean) => void;
  open: (id: string, question?: string) => void;
  /** Opens the panel's start view: questions about the current page. */
  openHome: () => void;
  /** Leaves the conversation for the start view, keeping the panel open. */
  back: () => void;
  close: () => void;
  setExpanded: (expanded: boolean) => void;
};

const ChatPanelContext = createContext<ChatPanel | null>(null);

/** Web: lets Ask Meld open beside the current page instead of navigating away from it. */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const windowWidth = useWindowDimensions().width;
  const canDock = windowWidth >= DOCK_MIN_WIDTH;
  const [rawWidth, setRawWidth] = useState(DEFAULT_PANEL_WIDTH);
  useEffect(() => {
    void prefs.get(WIDTH_KEY).then((v) => {
      const saved = Number(v);
      if (v && Number.isFinite(saved)) setRawWidth(saved);
    });
  }, []);
  const width = clampWidth(rawWidth, windowWidth);
  const [isOpen, setIsOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const pathname = usePathname();
  // The page the chat was expanded over; going to another page shows it, with the chat docked beside it.
  const [expandedOn, setExpandedOn] = useState<string | null>(null);
  const demo = useSetupStatus().data?.demo ?? false;
  const prevDemo = useRef(demo);
  useEffect(() => {
    if (prevDemo.current === demo) return;
    prevDemo.current = demo;
    setIsOpen(false);
    setChat(null);
    setExpandedOn(null);
  }, [demo]);
  const expanded = expandedOn === pathname;
  const value = useMemo<ChatPanel>(
    () => ({
      isOpen,
      chat,
      expanded: expanded || !canDock,
      canDock,
      width,
      setWidth: (next, save) => {
        const clamped = clampWidth(next, windowWidth);
        setRawWidth(clamped);
        if (save) void prefs.set(WIDTH_KEY, String(Math.round(clamped)));
      },
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
    [isOpen, chat, expanded, canDock, width, windowWidth, pathname],
  );
  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}

function clampWidth(width: number, windowWidth: number) {
  const max = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, windowWidth - PAGE_MIN_WIDTH));
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), max);
}

/** The chat panel, or null where there isn't one (native, and screens outside the tabs). */
export function useChatPanel() {
  return useContext(ChatPanelContext);
}

/** Width available to the page: the window, less the chat panel when it's docked beside it. */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  const panel = useChatPanel();
  return panel?.isOpen && !panel.expanded ? width - panel.width : width;
}
