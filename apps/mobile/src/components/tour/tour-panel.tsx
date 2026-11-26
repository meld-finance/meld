import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TOUR, useTour } from '@/lib/tour';

/** Phones on the web get a bottom tab bar; keep clear of it. */
const PHONE_BELOW = 640;
const BOTTOM_BAR = 64;
const WIDE_FROM = 1000;

/**
 * The demo tour, floating over whatever page it's on: the question, how this page answers it,
 * and Back/Next. Minimizes to a pill so it never blocks the page for long.
 */
export function TourPanel() {
  const theme = useTheme();
  const tour = useTour();
  const insets = useSafeAreaInsets();
  const width = useWindowDimensions().width;
  const phone = width < PHONE_BELOW;
  // In the corner on a wide window, where it covers the least; centered on a phone.
  const anchor = [styles.anchor, width >= WIDE_FROM && styles.anchorWide];
  if (!tour.active) return null;

  const last = tour.index === TOUR.length - 1;
  const bottom = insets.bottom + Spacing.three + (phone && Platform.OS === 'web' ? BOTTOM_BAR : 0);
  const shadow = Platform.OS === 'web' ? styles.shadowWeb : styles.shadow;

  if (tour.minimized) {
    return (
      <View pointerEvents="box-none" style={[anchor, { bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show the tour, stop ${tour.index + 1} of ${TOUR.length}`}
          onPress={() => tour.minimize(false)}
          style={({ pressed }) => [styles.pill, shadow, { backgroundColor: theme.tint }, pressed && styles.pressed]}>
          <Icon name="flag" size={16} color="#ffffff" />
          <ThemedText type="smallBold" style={styles.onTint}>
            Tour · {tour.index + 1} of {TOUR.length}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={[anchor, { bottom }]}>
      <ThemedView
        type="backgroundElement"
        accessibilityRole="summary"
        style={[styles.panel, shadow, { borderColor: theme.tint }]}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary">
            Tour · {tour.index + 1} of {TOUR.length} · {tour.step.place}
          </ThemedText>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Minimize the tour" onPress={() => tour.minimize(true)} hitSlop={8}>
              <Icon name="collapse" size={16} themeColor="textSecondary" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="End the tour" onPress={tour.end} hitSlop={8}>
              <Icon name="close" size={16} themeColor="textSecondary" />
            </Pressable>
          </View>
        </View>
        <ThemedText type="cardTitle">{tour.step.question}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {tour.step.answer}
        </ThemedText>
        <View style={styles.progress}>
          {TOUR.map((s, i) => (
            <View key={s.question} style={[styles.dot, { backgroundColor: i <= tour.index ? theme.tint : theme.backgroundSelected }]} />
          ))}
        </View>
        <View style={styles.buttons}>
          {tour.index > 0 && <Button label="Back" variant="secondary" size="small" onPress={tour.back} />}
          <View style={styles.spacer} />
          {last ? (
            <>
              <Button
                label="Keep exploring"
                variant="secondary"
                size="small"
                onPress={() => {
                  tour.end();
                  router.navigate('/');
                }}
              />
              {/* The last stop is the Connect page itself, so this just gets the tour out of the way. */}
              <Button label="Start connecting" size="small" onPress={tour.end} />
            </>
          ) : (
            <Button label="Next" size="small" onPress={tour.next} />
          )}
        </View>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.three },
  anchorWide: { alignItems: 'flex-end', paddingHorizontal: Spacing.four },
  panel: { width: '100%', maxWidth: 440, borderWidth: 1.5, borderRadius: Spacing.three + Spacing.one, padding: Spacing.three, gap: Spacing.two },
  shadow: { shadowColor: '#0F1B3D', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  shadowWeb: { boxShadow: '0 12px 32px rgba(15, 27, 61, 0.22)' } as object,
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  progress: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one },
  dot: { flex: 1, height: 4, borderRadius: 2 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  spacer: { flex: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  onTint: { color: '#ffffff' },
  pressed: { opacity: 0.8 },
});
