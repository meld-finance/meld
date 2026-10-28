import { router } from 'expo-router';

import { useChatPanel } from '@/lib/chat-panel';

/** Opens Ask Meld: the chat panel where there is one (web), otherwise the Ask tab. */
export function useOpenAsk() {
  const panel = useChatPanel();
  return () => (panel ? panel.openHome() : router.push('/ask'));
}
