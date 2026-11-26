import { router, usePathname } from 'expo-router';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { useSetupStatus, useSwitchDemoMode } from '@/lib/setup';
import { useTour } from '@/lib/tour';

/** Routes without DB record UUIDs in the URL, safe to stay on when resetting demo data. */
const TOP_LEVEL_ROUTES = new Set([
  '/',
  '/ask',
  '/accounts',
  '/spending',
  '/plan',
  '/alerts',
  '/rules',
  '/settings',
  '/releases',
  '/connect',
]);

/** Solid accent purple with >= 5.7:1 contrast against white text in both light and dark themes. */
const SOLID_PURPLE = '#6D4AE0';

/**
 * Full-width indicator pinned to the top of the app whenever demo mode is active,
 * with quick controls for the tour, resetting sample data, and returning to real accounts.
 */
export function DemoModeBar() {
  const theme = useTheme();
  const accent = useAccents().purple;
  const dark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const width = useWindowDimensions().width;
  const pathname = usePathname();
  const status = useSetupStatus().data;
  const demo = status?.demo ?? false;
  const plaidReady = status?.plaidReady ?? false;
  const tour = useTour();
  const switchDemo = useSwitchDemoMode();

  if (!demo) return null;

  const narrow = width < 520;
  const compact = width < 640;
  const wide = width >= 760;
  const showTourButton = !tour.active || tour.minimized;
  const topPad = Platform.OS !== 'web' ? insets.top : 0;

  async function handleReset() {
    const ok = await confirm(
      'Reset demo data?',
      'This restores the Rivera sample household to its starting state.',
      'Reset',
    );
    if (!ok) return;
    switchDemo.mutate({
      enabled: true,
      reset: true,
      redirect: TOP_LEVEL_ROUTES.has(pathname) ? null : '/',
    });
  }

  return (
    <View
      accessibilityRole="banner"
      style={[
        styles.bar,
        {
          backgroundColor: accent.bg,
          borderBottomColor: dark ? 'rgba(168, 148, 255, 0.35)' : 'rgba(109, 74, 224, 0.25)',
          paddingTop: Spacing.two + topPad,
        },
      ]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.badge}>
            <Icon name="flag" size={12} color="#ffffff" strokeWidth={2.2} />
            <ThemedText style={styles.badgeText}>DEMO MODE</ThemedText>
          </View>
          {wide ? (
            <ThemedText type="small" style={[styles.summary, { color: theme.text }]} numberOfLines={1}>
              {plaidReady
                ? 'Sample household (Rivera family) — your real accounts are hidden'
                : 'Sample household (Rivera family)'}
            </ThemedText>
          ) : !narrow ? (
            <ThemedText type="small" style={[styles.summary, { color: theme.text }]} numberOfLines={1}>
              Sample household
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.actions}>
          {showTourButton && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tour.minimized ? 'Show tour' : 'Start tour'}
              disabled={switchDemo.isPending}
              onPress={() => (tour.minimized ? tour.minimize(false) : tour.start())}
              style={({ hovered, pressed }) => [
                styles.secondaryBtn,
                {
                  backgroundColor: hovered ? theme.backgroundSelected : theme.backgroundElement,
                  borderColor: theme.border,
                },
                (pressed || switchDemo.isPending) && styles.pressed,
              ]}>
              <Icon name="flag" size={13} color={accent.fg} />
              <ThemedText type="smallBold" style={{ color: theme.text }}>
                {narrow ? 'Tour' : tour.minimized ? 'Show tour' : 'Start tour'}
              </ThemedText>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset demo data"
            disabled={switchDemo.isPending}
            onPress={() => void handleReset()}
            style={({ hovered, pressed }) => [
              styles.secondaryBtn,
              compact && styles.iconOnlyBtn,
              {
                backgroundColor: hovered ? theme.backgroundSelected : theme.backgroundElement,
                borderColor: theme.border,
              },
              (pressed || switchDemo.isPending) && styles.pressed,
            ]}>
            <Icon name="restart" size={14} themeColor="textSecondary" />
            {!compact && (
              <ThemedText type="smallBold" style={{ color: theme.text }}>
                Reset data
              </ThemedText>
            )}
          </Pressable>

          {plaidReady ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to my accounts"
              disabled={switchDemo.isPending}
              onPress={() => switchDemo.mutate({ enabled: false })}
              style={({ hovered, pressed }) => [
                styles.primaryBtn,
                { opacity: hovered || pressed || switchDemo.isPending ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryBtnText}>
                {compact ? 'Exit demo' : 'Back to my accounts'}
              </ThemedText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Connect my banks"
              disabled={switchDemo.isPending}
              onPress={() => router.push('/connect')}
              style={({ hovered, pressed }) => [
                styles.primaryBtn,
                { opacity: hovered || pressed || switchDemo.isPending ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryBtnText}>
                {compact ? 'Connect' : 'Connect my banks'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>

      {switchDemo.isError && (
        <ThemedText type="small" themeColor="negative">
          {switchDemo.error.message}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  left: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: SOLID_PURPLE,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  summary: {
    flex: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 0,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 5,
    minHeight: 30,
  },
  iconOnlyBtn: {
    paddingHorizontal: Spacing.two,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SOLID_PURPLE,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: 6,
    minHeight: 30,
  },
  primaryBtnText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});
