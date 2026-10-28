import { router, useLocalSearchParams } from 'expo-router';

/**
 * The selected sub-tab, kept in the URL (`?tab=…`) so links and reloads land on it.
 * The first tab is the default and leaves the param off.
 */
export function useTabParam<T extends string>(tabs: readonly { value: T }[], key = 'tab'): [T, (next: T) => void] {
  const params = useLocalSearchParams<Record<string, string | undefined>>();
  const first = tabs[0]!.value;
  const tab = tabs.find((t) => t.value === params[key])?.value ?? first;
  return [tab, (next) => router.setParams({ [key]: next === first ? undefined : next })];
}
