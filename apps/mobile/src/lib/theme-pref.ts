import { useSyncExternalStore } from 'react';

import { prefs } from './prefs';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'theme';

// Light, dark, or follow the device; remembered across launches.
let chosen: ThemePref = 'system';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
void prefs.get(KEY).then((v) => {
  if (v === 'light' || v === 'dark') {
    chosen = v;
    emit();
  }
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, () => chosen);
  return [
    pref,
    (next) => {
      chosen = next;
      emit();
      void prefs.set(KEY, next);
    },
  ];
}
