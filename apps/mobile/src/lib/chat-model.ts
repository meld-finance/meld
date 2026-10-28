import type { ChatModelOption } from '@meld/shared';
import { useSyncExternalStore } from 'react';

import { prefs } from './prefs';
import { useChatModels } from './queries';

const KEY = 'chatModel';

// The last model picked, shared by every open conversation and remembered across launches.
let chosen: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
void prefs.get(KEY).then((v) => {
  if (chosen === null && v) {
    chosen = v;
    emit();
  }
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Ask model picker's options and choice; falls back to the server default when the saved one is gone. */
export function useChatModel(): {
  models: ChatModelOption[];
  current: ChatModelOption | null;
  choose: (id: string) => void;
} {
  const list = useChatModels();
  const saved = useSyncExternalStore(subscribe, () => chosen);
  const models = list.data?.models ?? [];
  const current = models.find((m) => m.id === saved) ?? models.find((m) => m.id === list.data?.defaultId) ?? null;
  return {
    models,
    current,
    choose(id) {
      chosen = id;
      emit();
      void prefs.set(KEY, id);
    },
  };
}
