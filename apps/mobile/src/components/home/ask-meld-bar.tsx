import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';

const DEFAULT_SUGGESTIONS = [
  'Am I on track for retirement?',
  'Any tax strategies I should consider?',
  'How do I get the most out of Meld?',
];

type Props = {
  suggestions?: string[];
  compact?: boolean;
  style?: ViewStyle;
};

/** Compact Ask Meld command bar placed at the top of Home with quick contextual prompts. */
export function AskMeldBar({ suggestions = DEFAULT_SUGGESTIONS, compact = false, style }: Props) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const chat = useStartChat();
  const [question, setQuestion] = useState('');
  const [focused, setFocused] = useState(false);

  const ask = (text: string) => chat.start(text, () => setQuestion(''));
  const canSend = !!question.trim() && !chat.isPending;
  const shown = suggestions.slice(0, compact ? 2 : 3);

  return (
    <View style={[styles.bar, { backgroundColor: accent.bg, borderColor: theme.border }, style]}>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: theme.backgroundElement, borderColor: focused ? accent.fg : theme.border },
        ]}>
        <View style={styles.iconFixed}>
          <Icon name="sparkles" size={20} color={accent.fg} />
        </View>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Ask Meld about money or help…"
          placeholderTextColor={theme.textSecondary}
          value={question}
          onChangeText={setQuestion}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
          multiline={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask Meld"
          disabled={!canSend}
          onPress={() => ask(question)}
          style={({ hovered, pressed }) => [
            styles.send,
            {
              backgroundColor: canSend ? theme.tint : theme.text,
              opacity: !canSend ? 0.25 : hovered || pressed ? 0.85 : 1,
            },
          ]}>
          {chat.isPending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Icon name="arrowRight" size={16} color={canSend ? '#ffffff' : theme.backgroundElement} strokeWidth={2.2} />
          )}
        </Pressable>
      </View>

      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}

      {shown.length > 0 && (
        <View style={styles.chips}>
          {shown.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              disabled={chat.isPending}
              onPress={() => ask(s)}
              style={({ hovered, pressed }) => [
                styles.chip,
                !compact && styles.chipDesktop,
                { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
                pressed && styles.pressed,
              ]}>
              <View style={styles.iconFixed}>
                <Icon name="arrowUpRight" size={14} color={accent.fg} />
              </View>
              <ThemedText type="small" numberOfLines={1} style={styles.chipText}>
                {s}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    gap: Spacing.two + Spacing.half,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
  },
  input: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: Spacing.two },
  iconFixed: { flexShrink: 0 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingVertical: 6,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipDesktop: { maxWidth: 350 },
  chipText: { flexShrink: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
