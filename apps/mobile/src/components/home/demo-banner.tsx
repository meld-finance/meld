import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useSetupStatus } from '@/lib/setup';
import { useTour } from '@/lib/tour';

/** Says the household on screen is made up, with the tour and the way to real accounts. */
export function DemoBanner() {
  const demo = useSetupStatus().data?.demo ?? false;
  const tour = useTour();
  const accent = useAccents().purple;
  if (!demo) return null;
  return (
    <View style={[styles.banner, { backgroundColor: accent.bg, borderColor: accent.fg }]}>
      <View style={[styles.badge, { backgroundColor: accent.fg }]}>
        <Icon name="flag" size={18} color="#ffffff" />
      </View>
      <View style={styles.text}>
        <ThemedText type="smallBold">You’re looking at demo data</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The Riveras are made up, so you can see what Meld does before connecting anything. The tour walks through the
          questions it answers.
        </ThemedText>
      </View>
      <View style={styles.actions}>
        {!tour.active && <Button label="Take the tour" size="small" onPress={tour.start} />}
        <Button label="Connect my banks" variant="secondary" size="small" onPress={() => router.push('/connect')} />
      </View>
    </View>
  );
}

/** A small reminder in the top bar, on every page, that this is demo data. */
export function DemoPill({ compact }: { compact?: boolean }) {
  const demo = useSetupStatus().data?.demo ?? false;
  const accent = useAccents().purple;
  if (!demo) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Demo data. Connect your banks"
      onPress={() => router.push('/connect')}
      style={({ pressed }) => [styles.pill, { backgroundColor: accent.bg }, pressed && styles.pressed]}>
      <ThemedText type="smallBold" style={[styles.pillText, { color: accent.fg }]}>
        {compact ? 'Demo' : 'Demo data · Connect banks'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three + Spacing.one,
    padding: Spacing.three,
  },
  badge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 220, gap: Spacing.half },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  pillText: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.75 },
});
