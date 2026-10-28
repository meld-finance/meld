import { Pressable, StyleSheet, View } from 'react-native';

import { Conversation } from '@/components/chat/conversation';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { CHAT_PANEL_WIDTH, useChatPanel } from '@/lib/chat-panel';

/** The open conversation, docked to the right of the page or expanded over it. */
export function ChatPanel() {
  const panel = useChatPanel();
  const theme = useTheme();
  const accent = useAccents().blue;
  if (!panel?.chat) return null;
  const { chat, expanded, canDock } = panel;

  return (
    <ThemedView style={[styles.panel, expanded ? styles.expanded : styles.docked, { borderColor: theme.border }]}>
      <Conversation
        // A new conversation starts fresh; one still answering keeps going and is saved.
        key={chat.id}
        id={chat.id}
        initialQuestion={chat.question}
        header={({ title }) => (
          <View style={[styles.header, { borderColor: theme.border }]}>
            <Icon name="sparkles" size={18} color={accent.fg} />
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
        )}
      />
    </ThemedView>
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
    paddingLeft: Spacing.four,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  title: { flex: 1 },
  headerButton: { padding: Spacing.two, borderRadius: Spacing.two },
  pressed: { opacity: 0.7 },
});
