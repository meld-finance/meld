import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { chatColumn } from '@/components/chat/conversation';
import { ModelPicker, privacyNote } from '@/components/chat/model-picker';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { useChatModel } from '@/lib/chat-model';
import { usePageQuestions } from '@/lib/page-questions';

/** The chat panel before a conversation starts: questions about the page beside it. */
export function PanelStart() {
  const theme = useTheme();
  const accent = useAccents().blue;
  const chat = useStartChat();
  const { current } = useChatModel();
  const { page, questions, helpQuestion } = usePageQuestions();
  const [question, setQuestion] = useState('');
  const ask = (text: string) => chat.start(text, () => setQuestion(''));

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <ThemedText type="cardTitle">Ask about {page}</ThemedText>

      <View style={styles.questions}>
        {questions.map((q) => (
          <Pressable
            key={q}
            onPress={() => ask(q)}
            disabled={chat.isPending}
            style={({ hovered, pressed }) => [
              styles.question,
              { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
              pressed && styles.pressed,
            ]}>
            <Icon name="arrowUpRight" size={16} themeColor="textSecondary" />
            <ThemedText type="small" style={styles.shrink}>
              {q}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.helpSection}>
        <ThemedText type="small" themeColor="textSecondary">
          How Meld works
        </ThemedText>
        <Pressable
          onPress={() => ask(helpQuestion)}
          disabled={chat.isPending}
          style={({ hovered, pressed }) => [
            styles.question,
            { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
            pressed && styles.pressed,
          ]}>
          <Icon name="info" size={16} color={accent.fg} />
          <ThemedText type="small" style={styles.shrink}>
            {helpQuestion}
          </ThemedText>
        </Pressable>
      </View>

      <TextInput
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        placeholder="Ask about your money or Meld…"
        placeholderTextColor={theme.textSecondary}
        value={question}
        onChangeText={setQuestion}
        onSubmitEditing={() => ask(question)}
        returnKeyType="send"
      />
      {/* Raised so the model list draws over what follows. */}
      <View style={[styles.row, styles.raised]}>
        <Button label="Ask" disabled={!question.trim()} loading={chat.isPending} onPress={() => ask(question)} />
        <ModelPicker />
      </View>
      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}

      <Pressable onPress={() => router.push('/ask')} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <ThemedText type="small" themeColor="tint">
          Past conversations
        </ThemedText>
        <Icon name="arrowRight" size={14} themeColor="tint" />
      </Pressable>

      <ThemedText type="small" themeColor="textSecondary">
        {privacyNote(current)} Not professional financial, tax or legal advice.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { ...chatColumn, padding: Spacing.four, gap: Spacing.three },
  questions: { gap: Spacing.two },
  helpSection: { gap: Spacing.two, marginTop: Spacing.one },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  input: {
    marginTop: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three },
  raised: { zIndex: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start' },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.7 },
});
