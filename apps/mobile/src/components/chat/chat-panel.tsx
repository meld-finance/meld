import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Conversation } from '@/components/chat/conversation';
import { PanelStart } from '@/components/chat/panel-start';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useChatPanel } from '@/lib/chat-panel';

/** Ask Meld beside the page (or expanded over it): questions about that page, or the open conversation. */
export function ChatPanel() {
  const panel = useChatPanel();
  const theme = useTheme();
  const accent = useAccents().blue;
  if (!panel?.isOpen) return null;
  const { chat, expanded, canDock } = panel;

  const header = (title: string) => (
    <View style={[styles.header, { borderColor: theme.border }]}>
      {chat ? (
        <HeaderButton icon="chevronLeft" label="New question" onPress={panel.back} />
      ) : (
        <View style={styles.icon}>
          <Icon name="sparkles" size={18} color={accent.fg} />
        </View>
      )}
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {canDock && (
        <HeaderButton
          icon={expanded ? 'collapse' : 'expand'}
          label={expanded ? 'Dock to the side' : 'Expand'}
          onPress={() => panel.setExpanded(!expanded)}
        />
      )}
      <HeaderButton icon="close" label="Close" onPress={panel.close} />
    </View>
  );

  return (
    <ThemedView
      style={[styles.panel, expanded ? [styles.expanded] : [styles.docked, { width: panel.width }], { borderColor: theme.border }]}>
      {!expanded && <ResizeHandle />}
      {chat ? (
        <Conversation
          // A new conversation starts fresh; one still answering keeps going and is saved.
          key={chat.id}
          id={chat.id}
          initialQuestion={chat.question}
          header={({ title }) => header(title)}
        />
      ) : (
        <>
          {header('Ask Meld')}
          <PanelStart />
        </>
      )}
    </ThemedView>
  );
}

/** The docked panel's left edge: drag to resize. */
function ResizeHandle() {
  const panel = useChatPanel()!;
  const theme = useTheme();
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Web only (the panel is), so the DOM pointer events are available.
  const startDrag = (start: number) => {
    const startWidth = panel.width;
    let width = startWidth;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setActive(true);
    const move = (ev: PointerEvent) => {
      width = startWidth + (start - ev.clientX);
      panel.setWidth(width);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      setActive(false);
      panel.setWidth(width, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <View
      accessibilityLabel="Resize chat panel"
      onPointerDown={(e) => startDrag(e.nativeEvent.clientX)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={[styles.handle, { cursor: 'col-resize' } as object]}>
      <View style={[styles.handleLine, (active || hovered) && { backgroundColor: theme.tint }]} />
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.headerButton,
        hovered && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={16} themeColor="textSecondary" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 0 },
  docked: { borderLeftWidth: 1 },
  // Straddles the border so it's easy to grab; above the panel's content.
  handle: { position: 'absolute', top: 0, bottom: 0, left: -5, width: 9, zIndex: 20, alignItems: 'center' },
  handleLine: { width: 2, height: '100%' },
  expanded: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  title: { flex: 1 },
  // Lines up with the back button that takes its place in a conversation.
  icon: { padding: Spacing.two },
  headerButton: { padding: Spacing.two, borderRadius: Spacing.two },
  pressed: { opacity: 0.7 },
});
