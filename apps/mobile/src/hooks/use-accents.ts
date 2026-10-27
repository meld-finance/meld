import { AccentColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useAccents() {
  return AccentColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
