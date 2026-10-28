import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AskStart } from '@/components/chat/ask-start';
import { chatColumn, Conversation } from '@/components/chat/conversation';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { CHAT_PANEL_WIDTH, useChatPanel } from '@/lib/chat-panel';

/** Ask Meld beside the page (or expanded over it): the start view, or the open conversation. */
export function ChatPanel() {
  const panel = useChatPanel();
  const theme = useTheme();
  const accent = useAccents().blue;
  if (!panel?.isOpen) return null;
  const { chat, expanded, canDock } = panel;

  const header = (title: string) => (
    <View style={[styles.header, { borderColor: theme.border }]}>
      {chat ? (
        <HeaderButton icon="chevronLeft" label="All conversations" onPress={panel.back} />
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
    <ThemedView style={[styles.panel, expanded ? styles.expanded : styles.docked, { borderColor: theme.border }]}>
      {chat ? (
        <Conversation
          // A new conversation starts fresh; one still answering keeps going and is saved.
          key={chat.id}
          id={chat.id}
          initialQuestion={chat.question}
          header={({ title }) => header(title)}
        />
      ) : (
        <Start header={header('Ask Meld')} />
      )}
    </ThemedView>
  );
}

function Start({ header }: { header: ReactNode }) {
  return (
    <>
      {header}
      <ScrollView style={styles.fill} contentContainerStyle={styles.start}>
        <AskStart />
      </ScrollView>
    </>
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
  docked: { width: CHAT_PANEL_WIDTH, borderLeftWidth: 1 },
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
  fill: { flex: 1 },
  start: { ...chatColumn, padding: Spacing.four, gap: Spacing.four },
  headerButton: { padding: Spacing.two, borderRadius: Spacing.two },
  pressed: { opacity: 0.7 },
});
