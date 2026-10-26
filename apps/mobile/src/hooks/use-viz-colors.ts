import { VizColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useVizColors() {
  return VizColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
