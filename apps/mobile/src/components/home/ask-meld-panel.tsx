import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';

const SUGGESTIONS = [
  'Am I on track for retirement?',
  'Should I pay extra on my mortgage?',
  'Any tax strategies I should consider?',
  'How does my insurance coverage look?',
];

export function AskMeldPanel({ style, suggestions = SUGGESTIONS }: { style?: object; suggestions?: string[] }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const chat = useStartChat();
  const [question, setQuestion] = useState('');
  const ask = (text: string) => chat.start(text, () => setQuestion(''));
  const canSend = !!question.trim() && !chat.isPending;

  return (
    <View style={[styles.panel, { backgroundColor: accent.bg, borderColor: theme.border }, style]}>
      <View style={styles.heading}>
        <Icon name="sparkles" size={28} color={accent.fg} />
        <ThemedText style={styles.title}>Ask Meld</ThemedText>
      </View>
      <ThemedText themeColor="textSecondary">
        Get answers, recommendations and tax strategies based on your full picture.
      </ThemedText>

      <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="What would you like to know?"
          placeholderTextColor={theme.textSecondary}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask"
          disabled={!canSend}
          onPress={() => ask(question)}
          style={[styles.send, { backgroundColor: theme.text, opacity: canSend ? 1 : 0.35 }]}>
          {chat.isPending ? (
            <ActivityIndicator size="small" color={theme.backgroundElement} />
          ) : (
            <Icon name="arrowRight" size={18} color={theme.backgroundElement} strokeWidth={2} />
          )}
        </Pressable>
      </View>
      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}

      <View style={styles.suggestions}>
        {suggestions.map((s) => (
          <Pressable
            key={s}
            onPress={() => ask(s)}
            disabled={chat.isPending}
            style={({ hovered, pressed }) => [
              styles.suggestion,
              { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
              pressed && styles.pressed,
            ]}>
            <Icon name="arrowUpRight" size={16} themeColor="textSecondary" />
            <ThemedText type="small" style={styles.suggestionText}>
              {s}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: Spacing.four, borderRadius: Spacing.four, borderWidth: 1, gap: Spacing.three },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  title: { fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: -0.3 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
    marginVertical: Spacing.three,
  },
  input: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: Spacing.three },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  suggestions: { gap: Spacing.two + Spacing.one },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  suggestionText: { flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
