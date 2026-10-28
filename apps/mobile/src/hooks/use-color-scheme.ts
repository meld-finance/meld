import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useThemePref } from '@/lib/theme-pref';

/** The scheme to draw in: the user's choice, or the device's when they follow it. */
export function useColorScheme() {
  const system = useSystemColorScheme();
  const [pref] = useThemePref();
  return pref === 'system' ? system : pref;
}
