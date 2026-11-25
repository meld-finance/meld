import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ModelPicker, privacyNote } from '@/components/chat/model-picker';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { useChatModel } from '@/lib/chat-model';
import { useChatPanel } from '@/lib/chat-panel';
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

const HOW_TO_SUGGESTIONS = [
  'What features does Meld have?',
  'How do I set up autopay tracking and alerts?',
  'How do category rules work?',
  'How do I access Meld from my phone?',
  'What data does Meld send to AI providers?',
];

/** Starting point for Ask Meld: a question box, suggestions and recent conversations. The Ask tab on phones, the chat panel's start view on web. */
export function AskStart() {
  const theme = useTheme();
  const sessions = useChatSessions();
  const profile = useProfile();
  const chat = useStartChat();
  const panel = useChatPanel();
  const { current } = useChatModel();
  const openChat = (id: string) => (panel ? panel.open(id) : router.push({ pathname: '/chat/[id]', params: { id } }));
  const [question, setQuestion] = useState('');

  const ask = (text: string) => chat.start(text, () => setQuestion(''));

  const p = profile.data;
  const profileEmpty = p && !p.annualGrossIncome && !p.filingStatus && !p.state && !p.birthYear;

  return (
    <>
      {/* Raised so the model list draws over the cards below. */}
      <Card
        style={styles.raised}
        title="Ask about your finances or Meld"
        subtitle="Answers use your accounts, transactions, investments, loans, insurance, budget, and Meld’s feature guides.">
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          placeholder="Ask about your money or Meld…"
          placeholderTextColor={theme.textSecondary}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask(question)}
          returnKeyType="send"
          multiline={false}
        />
        <View style={[styles.row, styles.raised]}>
          <Button label="Ask" disabled={!question.trim()} loading={chat.isPending} onPress={() => ask(question)} />
          <ModelPicker />
        </View>
        {chat.error && (
          <ThemedText type="small" themeColor="negative">
            {chat.error.message}
          </ThemedText>
        )}
        <View style={styles.chipGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Your finances
          </ThemedText>
          <View style={styles.chips}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => ask(s)} />
            ))}
          </View>
        </View>
        <View style={styles.chipGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            How to use Meld
          </ThemedText>
          <View style={styles.chips}>
            {HOW_TO_SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => ask(s)} />
            ))}
          </View>
        </View>
      </Card>

      {profileEmpty && (
        <Card>
          <ThemedText type="small">
            For tax and insurance questions, add your income, filing status, state and age to your{' '}
            <ThemedText type="small" themeColor="tint" onPress={() => router.push({ pathname: '/plan', params: { tab: 'profile' } })}>
              profile under Plan
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
              onPress={() => openChat(s.id)}
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
        {privacyNote(current)} Account and policy numbers are masked. Answers are educational, not professional
        financial, tax or legal advice.
      </ThemedText>
    </>
  );
}

const styles = StyleSheet.create({
  raised: { zIndex: 1 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three },
  chipGroup: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  session: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
});
