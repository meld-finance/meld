import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { chatColumn, Conversation } from '@/components/chat/conversation';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { confirm } from '@/lib/confirm';
import { useDeleteChatSession } from '@/lib/queries';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/ask'));

export default function ChatScreen() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const remove = useDeleteChatSession();

  async function del() {
    if (!(await confirm('Delete this conversation?', 'This can’t be undone.', 'Delete'))) return;
    remove.mutate(id, { onSuccess: goBack });
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Conversation
            id={id}
            // A question typed elsewhere arrives as ?q= and is sent once.
            initialQuestion={q}
            onInitialSent={() => router.setParams({ q: undefined })}
            header={({ title, streaming }) => (
              <View style={styles.header}>
                <Pressable onPress={goBack}>
                  <ThemedText type="linkPrimary">‹ Ask</ThemedText>
                </Pressable>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
                  {title}
                </ThemedText>
                <Button label="Delete" variant="secondary" size="small" onPress={() => void del()} disabled={streaming} />
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    ...chatColumn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: { flex: 1 },
});
