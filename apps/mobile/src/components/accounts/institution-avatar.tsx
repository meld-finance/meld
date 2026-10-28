import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';

const ACCENTS = Object.keys(AccentColors.light) as Accent[];

/** The same institution always gets the same color. */
function accentFor(name: string): Accent {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length]!;
}

/** A round badge with the institution's initial, or `icon` when there's no institution. */
export function InstitutionAvatar({ name, icon = 'wallet', size = 36 }: { name: string | null; icon?: IconName; size?: number }) {
  const accent = useAccents()[name ? accentFor(name) : 'blue'];
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: accent.bg }]}>
      {name ? (
        <ThemedText style={[styles.initial, { color: accent.fg, fontSize: size * 0.42 }]}>
          {name.trim()[0]?.toUpperCase()}
        </ThemedText>
      ) : (
        <Icon name={icon} size={size * 0.5} color={accent.fg} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: 700, lineHeight: undefined },
});
