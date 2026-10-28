import { router } from 'expo-router';
import { useEffect } from 'react';

import { useChatPanel } from '@/lib/chat-panel';

/** Web: Ask Meld is the chat panel, so /ask opens it over Home. */
export default function AskScreen() {
  const panel = useChatPanel();
  useEffect(() => {
    panel?.openHome();
    router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
