import type { ChatMessageView } from '@meld/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputKeyPressEvent,
} from 'react-native';

import { Button } from '@/components/button';
import { Markdown } from '@/components/markdown';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { streamChatMessage } from '@/lib/chat-stream';
import { keys, useChatSession } from '@/lib/queries';

type Pending = { question: string; text: string; lookups: string[]; error: string | null; streaming: boolean };

export type ConversationState = { title: string; streaming: boolean };

type Props = {
  id: string;
  /** Sent once, as soon as the session has loaded. */
  initialQuestion?: string;
  onInitialSent?: () => void;
  header: (state: ConversationState) => ReactNode;
};

/** A chat session's messages and composer; shared by the full-page chat and the side panel. */
export function Conversation({ id, initialQuestion, onInitialSent, header }: Props) {
  const theme = useTheme();
  const qc = useQueryClient();
  const session = useChatSession(id);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const sentInitial = useRef(false);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending?.streaming) return;
    setInput('');
    setPending({ question, text: '', lookups: [], error: null, streaming: true });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamChatMessage(
        id,
        question,
        (event) => {
          switch (event.type) {
            case 'text':
              setPending((p) => p && { ...p, text: p.text + event.text });
              break;
            case 'lookup':
              setPending((p) => p && { ...p, lookups: [...p.lookups, event.label] });
              break;
            case 'error':
              setPending((p) => p && { ...p, error: event.error, streaming: false });
              break;
            case 'done':
              void qc.invalidateQueries({ queryKey: keys.chatSessions });
              // Swap the streamed draft for the saved messages once they've loaded.
              void qc.invalidateQueries({ queryKey: keys.chatSession(id) }).then(() => setPending(null));
              break;
          }
        },
        abort.signal,
      );
    } catch (err) {
      const stopped = abort.signal.aborted;
      setPending((p) => p && { ...p, streaming: false, error: stopped ? 'Stopped.' : (err as Error).message });
    }
  }

  useEffect(() => {
    if (!initialQuestion || sentInitial.current || !session.data) return;
    sentInitial.current = true;
    onInitialSent?.();
    void send(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, session.data]);

  function retry() {
    if (!pending) return;
    const question = pending.question;
    setPending(null);
    void send(question);
  }

  function onKeyPress(e: TextInputKeyPressEvent) {
    // Web: Enter sends, Shift+Enter adds a line.
    const native = e.nativeEvent as TextInputKeyPressEvent['nativeEvent'] & { shiftKey?: boolean };
    if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const messages = session.data?.messages ?? [];
  const streaming = pending?.streaming ?? false;
  const title = session.data?.title ?? pending?.question ?? initialQuestion ?? 'New conversation';

  return (
    <>
      {header({ title, streaming })}

      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {session.isPending && <ActivityIndicator />}
        {session.isError && <ThemedText themeColor="negative">{session.error.message}</ThemedText>}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {pending && (
          <>
            <UserBubble text={pending.question} />
            <View style={styles.assistant}>
              <Lookups labels={pending.lookups} />
              {pending.text ? (
                <Markdown text={pending.text} />
              ) : (
                pending.streaming && (
                  <View style={styles.thinking}>
                    <ActivityIndicator size="small" />
                    <ThemedText type="small" themeColor="textSecondary">
                      {pending.lookups.length ? 'Looking at your data…' : 'Thinking…'}
                    </ThemedText>
                  </View>
                )
              )}
              {pending.error && (
                <View style={styles.errorRow}>
                  <ThemedText type="small" themeColor="negative">
                    {pending.error}
                  </ThemedText>
                  <Button label="Try again" variant="secondary" size="small" onPress={retry} />
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.composer, { borderColor: theme.border }]}>
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          placeholder="Ask a follow-up…"
          placeholderTextColor={theme.textSecondary}
          value={input}
          onChangeText={setInput}
          onKeyPress={onKeyPress}
          multiline
          editable={!streaming}
        />
        {streaming ? (
          <Button label="Stop" variant="secondary" onPress={() => abortRef.current?.abort()} />
        ) : (
          <Button label="Send" disabled={!input.trim()} onPress={() => void send(input)} />
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        Questions and the data needed to answer them are sent to Anthropic. Not professional financial, tax or legal
        advice.
      </ThemedText>
    </>
  );
}

function Message({ message: m }: { message: ChatMessageView }) {
  if (m.role === 'user') return <UserBubble text={m.text} />;
  return (
    <View style={styles.assistant}>
      <Lookups labels={m.lookups} />
      <Markdown text={m.text} />
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <ThemedView type="backgroundSelected" style={styles.user}>
      <ThemedText>{text}</ThemedText>
    </ThemedView>
  );
}

function Lookups({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  const unique = [...new Set(labels)];
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {unique.join(' · ')}
    </ThemedText>
  );
}

/** Centers chat content at a readable width; headers use it to line up with the messages. */
export const chatColumn = { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  messages: { ...chatColumn, padding: Spacing.four, gap: Spacing.four },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  assistant: { gap: Spacing.two },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  composer: {
    ...chatColumn,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  input: {
    flex: 1,
    maxHeight: 160,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  note: { ...chatColumn, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
});
