import { router, type Href } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { AREAS, type SetupProgress, type SetupStep } from '@/lib/home';
import { prefs } from '@/lib/prefs';

const COLLAPSED_PREVIEW = 3;
const PREF_KEY = 'home.setupHidden';

let setupHidden = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
void prefs.get(PREF_KEY).then((v) => {
  if (v === '1') {
    setupHidden = true;
    emit();
  }
});

function useSetupHidden(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => setupHidden,
  );
  return [
    hidden,
    (next) => {
      setupHidden = next;
      emit();
      void prefs.set(PREF_KEY, next ? '1' : '0');
    },
  ];
}

/** Smart, data-aware guide to features the user hasn't configured yet; auto-hides when done. */
export function SetupGuide({ progress, wide }: { progress: SetupProgress; wide: boolean }) {
  const theme = useTheme();
  const accents = useAccents();
  const [hidden, setHidden] = useSetupHidden();
  const [showAll, setShowAll] = useState(false);

  if (progress.total === 0 || progress.remaining.length === 0) return null;

  const pct = Math.round((progress.completed / progress.total) * 100);

  if (hidden) {
    return (
      <ThemedView type="backgroundElement" style={[styles.collapsedBar, { borderColor: theme.border }]}>
        <View style={styles.collapsedLeft}>
          <View style={[styles.collapsedDot, { backgroundColor: theme.tint }]} />
          <ThemedText type="smallBold">Finish setting up Meld</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.collapsedMeta}>
            {progress.completed} of {progress.total} complete
          </ThemedText>
          <View style={[styles.miniTrack, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.miniFill, { width: `${pct}%`, backgroundColor: theme.tint }]} />
          </View>
        </View>
        <Pressable onPress={() => setHidden(false)} style={({ pressed }) => [pressed && styles.pressed]}>
          <ThemedText type="smallBold" themeColor="tint">
            Show steps
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const shown = showAll ? progress.remaining : progress.remaining.slice(0, COLLAPSED_PREVIEW);

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedText type="cardTitle">Complete your picture</ThemedText>
          <View style={[styles.countPill, { backgroundColor: accents.blue.bg }]}>
            <ThemedText type="smallBold" style={[styles.countText, { color: accents.blue.fg }]}>
              {progress.completed} of {progress.total} done
            </ThemedText>
          </View>
        </View>
        <View style={styles.headerActions}>
          {progress.remaining.length > COLLAPSED_PREVIEW && (
            <Pressable onPress={() => setShowAll((s) => !s)} style={({ pressed }) => [pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="tint">
                {showAll ? 'Show fewer' : `See all ${progress.remaining.length}`}
              </ThemedText>
            </Pressable>
          )}
          <Pressable onPress={() => setHidden(true)} style={({ pressed }) => [pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              Hide
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <View
        style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.tint }]} />
      </View>

      <View style={styles.grid}>
        {shown.map((step) => (
          <StepCard key={step.id} step={step} wide={wide} />
        ))}
      </View>
    </Card>
  );
}

function StepCard({ step, wide }: { step: SetupStep; wide: boolean }) {
  const theme = useTheme();
  const accents = useAccents();
  const area = AREAS[step.area];
  const accent = accents[area.accent];
  const spotted = !!step.badge && step.badge.includes('spotted');

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(step.href as Href)}
      style={({ hovered, pressed }) => [
        styles.stepCard,
        {
          flexBasis: wide ? 260 : 220,
          backgroundColor: theme.background,
          borderColor: hovered ? accent.fg : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      <View style={styles.stepTop}>
        <View style={[styles.stepBadge, { backgroundColor: accent.bg }]}>
          <Icon name={step.icon} size={16} color={accent.fg} />
        </View>
        {step.badge && (
          <View
            style={[
              styles.metaPill,
              spotted
                ? { backgroundColor: accents.orange.bg, borderColor: 'transparent' }
                : { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}>
            <ThemedText
              type="small"
              style={[styles.metaPillText, { color: spotted ? accents.orange.fg : theme.textSecondary }]}>
              {step.badge}
            </ThemedText>
          </View>
        )}
      </View>

      <ThemedText type="smallBold" numberOfLines={2}>
        {step.title}
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.reason}>
        {step.reason}
      </ThemedText>

      <ThemedText type="small" themeColor="tint" style={styles.cta}>
        {step.cta} →
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collapsedBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
  },
  collapsedLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  collapsedDot: { width: 8, height: 8, borderRadius: 4 },
  collapsedMeta: { fontSize: 13 },
  miniTrack: { width: 72, height: 5, borderRadius: 3, overflow: 'hidden' },
  miniFill: { height: 5, borderRadius: 3 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  countPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999 },
  countText: { fontSize: 12, lineHeight: 16 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  stepCard: {
    flexGrow: 1,
    minWidth: 220,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: 14,
    gap: Spacing.two,
  },
  stepTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  stepBadge: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  metaPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  metaPillText: { fontSize: 11, lineHeight: 15, fontWeight: 600 },
  reason: { fontSize: 13, lineHeight: 18 },
  cta: { fontSize: 13, fontWeight: 600, marginTop: 'auto', paddingTop: 2 },
  pressed: { opacity: 0.7 },
});
