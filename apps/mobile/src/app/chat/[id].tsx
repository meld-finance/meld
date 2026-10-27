import type { ChatMessageView } from '@meld/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputKeyPressEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Markdown } from '@/components/markdown';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { streamChatMessage } from '@/lib/chat-stream';
import { confirm } from '@/lib/confirm';
import { keys, useChatSession, useDeleteChatSession } from '@/lib/queries';

type Pending = { question: string; text: string; lookups: string[]; error: string | null; streaming: boolean };

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/ask'));

export default function ChatScreen() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const theme = useTheme();
  const qc = useQueryClient();
  const session = useChatSession(id);
  const remove = useDeleteChatSession();
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

  // A question typed on the Ask tab arrives as ?q= and is sent once.
  useEffect(() => {
    if (!q || sentInitial.current || !session.data) return;
    sentInitial.current = true;
    router.setParams({ q: undefined });
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, session.data]);

  function retry() {
    if (!pending) return;
    const question = pending.question;
    setPending(null);
    void send(question);
  }

  async function del() {
    if (!(await confirm('Delete this conversation?', 'This can’t be undone.', 'Delete'))) return;
    remove.mutate(id, { onSuccess: goBack });
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

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable onPress={goBack}>
              <ThemedText type="linkPrimary">‹ Ask</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
              {session.data?.title ?? pending?.question ?? 'New conversation'}
            </ThemedText>
            <Button label="Delete" variant="secondary" size="small" onPress={() => void del()} disabled={streaming} />
          </View>

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
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
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

const column = { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' } as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    ...column,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: { flex: 1 },
  messages: { ...column, padding: Spacing.four, gap: Spacing.four },
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
    ...column,
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
  note: { ...column, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
});
