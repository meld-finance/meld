import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime } from '@/lib/format';
import { useChatSessions, useProfile } from '@/lib/queries';

const SUGGESTIONS = [
  'How am I doing overall?',
  'Where is my money going this month?',
  'Should I pay down debt faster or invest more?',
  'Am I underinsured for life or disability?',
  'What tax-saving moves should I consider this year?',
  'Any tax-loss harvesting opportunities in my portfolio?',
  'How big should my emergency fund be, and do I have enough?',
];

export default function AskScreen() {
  const theme = useTheme();
  const sessions = useChatSessions();
  const profile = useProfile();
  const chat = useStartChat();
  const [question, setQuestion] = useState('');

  const ask = (text: string) => chat.start(text, () => setQuestion(''));

  const p = profile.data;
  const profileEmpty = p && !p.annualGrossIncome && !p.filingStatus && !p.state && !p.birthYear;

  return (
    <Screen
      title="Ask Meld"
      actions={<Button label="Profile" variant="secondary" size="small" onPress={() => router.push('/profile')} />}>
      <Card
        title="Ask about your finances"
        subtitle="Answers use your accounts, transactions, investments, loans, insurance and budget.">
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          placeholder="e.g. Can I afford to max out my 401(k)?"
          placeholderTextColor={theme.textSecondary}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
          multiline={false}
        />
        <View style={styles.row}>
          <Button label="Ask" disabled={!question.trim()} loading={chat.isPending} onPress={() => ask(question)} />
          {chat.error && (
            <ThemedText type="small" themeColor="negative" style={styles.shrink}>
              {chat.error.message}
            </ThemedText>
          )}
        </View>
        <View style={styles.chips}>
          {SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} onPress={() => ask(s)} />
          ))}
        </View>
      </Card>

      {profileEmpty && (
        <Card>
          <ThemedText type="small">
            For tax and insurance questions, add your income, filing status, state and age to your{' '}
            <ThemedText type="small" themeColor="tint" onPress={() => router.push('/profile')}>
              profile
            </ThemedText>
            .
          </ThemedText>
        </Card>
      )}

      {!!sessions.data?.length && (
        <Card title="Recent conversations">
          {sessions.data.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: s.id } })}
              style={({ pressed }) => [styles.session, pressed && styles.pressed]}>
              <ThemedText numberOfLines={1} style={styles.shrink}>
                {s.title ?? 'Untitled conversation'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatRelativeTime(s.updatedAt)}
              </ThemedText>
            </Pressable>
          ))}
        </Card>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        Your question and the financial data needed to answer it are sent to Anthropic. Account and policy numbers are
        masked. Answers are educational, not professional financial, tax or legal advice.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  session: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
});
