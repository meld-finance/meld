import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useOpenAsk } from '@/hooks/use-open-ask';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import type { Insight } from '@/lib/cashflow';

/** Key takeaways; each opens the assistant to dig into it. */
export function InsightsPanel({ insights, style }: { insights: Insight[]; style?: object }) {
  const theme = useTheme();
  const accents = useAccents();
  const chat = useStartChat();
  const openAsk = useOpenAsk();

  return (
    <View style={[styles.panel, { backgroundColor: accents.blue.bg, borderColor: theme.border }, style]}>
      <View style={styles.heading}>
        <Icon name="sparkles" size={28} color={accents.blue.fg} />
        <ThemedText style={styles.title}>Insights</ThemedText>
      </View>
      <ThemedText themeColor="textSecondary">Key takeaways from your cash flow</ThemedText>

      <View style={[styles.list, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {insights.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Takeaways appear once there’s spending to compare.
          </ThemedText>
        )}
        {insights.map((i, n) => {
          const accent = accents[i.accent];
          return (
            <Pressable
              key={i.key}
              accessibilityRole="button"
              accessibilityHint="Ask the assistant about this"
              disabled={chat.isPending}
              onPress={() => chat.start(i.question)}
              style={({ hovered, pressed }) => [
                styles.insight,
                n > 0 && { borderTopWidth: 1, borderColor: theme.border },
                hovered && { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <View style={[styles.badge, { backgroundColor: accent.bg }]}>
                <Icon name={i.icon} size={22} color={accent.fg} strokeWidth={2} />
              </View>
              <View style={styles.text}>
                <ThemedText type="smallBold">{i.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {i.body}
                </ThemedText>
              </View>
              <Icon name="chevronRight" size={16} themeColor="textSecondary" />
            </Pressable>
          );
        })}
      </View>
      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}

      <Pressable
        accessibilityRole="link"
        onPress={openAsk}
        style={({ hovered, pressed }) => [
          styles.askButton,
          { backgroundColor: theme.backgroundElement, borderColor: hovered ? accents.blue.fg : theme.border },
          pressed && styles.pressed,
        ]}>
        <Icon name="message" size={20} color={accents.blue.fg} />
        <ThemedText type="smallBold" style={[styles.askText, { color: accents.blue.fg }]}>
          Ask Meld
        </ThemedText>
        <Icon name="arrowRight" size={18} color={accents.blue.fg} />
      </Pressable>
    </View>
  );
}

const QUESTIONS = [
  'How does my spending compare to last year?',
  'What’s driving my biggest spending increase?',
  'Where can I cut back to save more for retirement?',
  'What will my spending look like next year?',
];

/** Starter prompts that open a chat with the assistant. */
export function QuickQuestions({ style }: { style?: object }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const chat = useStartChat();

  return (
    <View style={[styles.panel, { backgroundColor: accent.bg, borderColor: theme.border }, style]}>
      <View style={styles.heading}>
        <Icon name="sparkles" size={22} color={accent.fg} />
        <ThemedText type="cardTitle">Quick Questions</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Try asking the AI assistant about your spending.
      </ThemedText>
      <View style={styles.questions}>
        {QUESTIONS.map((q) => (
          <Pressable
            key={q}
            onPress={() => chat.start(q)}
            disabled={chat.isPending}
            style={({ hovered, pressed }) => [
              styles.question,
              { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
              pressed && styles.pressed,
            ]}>
            <Icon name="arrowUpRight" size={16} themeColor="textSecondary" />
            <ThemedText type="small" style={styles.text}>
              {q}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: Spacing.four, borderRadius: Spacing.four, borderWidth: 1, gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: -0.3 },
  list: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden', marginTop: Spacing.two },
  empty: { padding: Spacing.three },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, padding: Spacing.three },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: Spacing.one },
  askButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    marginTop: Spacing.two,
  },
  askText: { flex: 1 },
  questions: { gap: Spacing.two, marginTop: Spacing.two },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  pressed: { opacity: 0.7 },
});
