import { router } from 'expo-router';

import { useChatModel } from '@/lib/chat-model';
import { useChatPanel } from '@/lib/chat-panel';
import { usePageQuestions } from '@/lib/page-questions';
import { useCreateChatSession } from '@/lib/queries';

/**
 * Opens a new chat session and sends `question` as its first message: in the chat panel beside the
 * current page where there is one (web), otherwise on the chat screen.
 */
export function useStartChat() {
  const create = useCreateChatSession();
  const panel = useChatPanel();
  const { current } = useChatModel();
  const { page } = usePageQuestions();
  function start(question: string, onStarted?: () => void) {
    const q = question.trim();
    if (!q || create.isPending) return;
    create.mutate(
      { page, ...(current?.id ? { model: current.id } : {}) },
      {
        onSuccess: (session) => {
          onStarted?.();
          if (panel) panel.open(session.id, q);
          else router.push({ pathname: '/chat/[id]', params: { id: session.id, q } });
        },
      },
    );
  }
  return { start, isPending: create.isPending, error: create.error };
}
