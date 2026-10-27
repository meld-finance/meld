import { router } from 'expo-router';

import { useCreateChatSession } from '@/lib/queries';

/** Opens a new chat session and sends `question` as its first message. */
export function useStartChat() {
  const create = useCreateChatSession();
  function start(question: string, onStarted?: () => void) {
    const q = question.trim();
    if (!q || create.isPending) return;
    create.mutate(undefined, {
      onSuccess: (session) => {
        onStarted?.();
        router.push({ pathname: '/chat/[id]', params: { id: session.id, q } });
      },
    });
  }
  return { start, isPending: create.isPending, error: create.error };
}
