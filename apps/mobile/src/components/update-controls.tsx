import type { UpdateState } from '@meld/shared';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { desktop, pendingVersion, useUpdateState } from '@/lib/desktop';

/** One click does the next thing: download a found update, or restart into a downloaded one. */
function act(state: UpdateState) {
  const bridge = desktop();
  if (!bridge) return;
  if (state.status === 'ready') void bridge.installUpdate();
  else if (state.status === 'available' || state.status === 'error') void bridge.downloadUpdate();
  else if (state.status === 'downloading') router.push('/releases');
}

/**
 * The top bar's update button, shown in the Mac app once there's a new version:
 * "Update" downloads it in place, showing progress, then "Restart to update" installs it.
 */
export function UpdatePill({ compact }: { compact: boolean }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const state = useUpdateState();
  const version = pendingVersion(state);
  if (!state || !version) return null;

  const ready = state.status === 'ready';
  const downloading = state.status === 'downloading';
  const percent = downloading ? state.percent : 0;
  const label = ready
    ? compact
      ? 'Restart'
      : 'Restart to update'
    : downloading
      ? compact
        ? `${percent}%`
        : `Downloading… ${percent}%`
      : state.status === 'error'
        ? 'Retry update'
        : compact
          ? 'Update'
          : 'Update available';
  const a11y = ready
    ? `Restart Meld to update to ${version}`
    : downloading
      ? `Downloading Meld ${version}, ${percent} percent`
      : `Meld ${version} is available. Download and install it`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => act(state)}
      style={({ hovered, pressed }) => [
        styles.pill,
        ready
          ? { backgroundColor: theme.tint, borderColor: theme.tint }
          : { backgroundColor: accent.bg, borderColor: hovered ? accent.fg : accent.bg },
        pressed && styles.pressed,
      ]}>
      {downloading && <View style={[styles.progress, { width: `${percent}%`, backgroundColor: accent.fg }]} />}
      <Icon name={ready ? 'restart' : 'download'} size={16} strokeWidth={2} color={ready ? '#ffffff' : accent.fg} />
      <ThemedText type="smallBold" style={[styles.pillText, { color: ready ? '#ffffff' : accent.fg }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** The release notes page's update card (Mac app only): where updates stand and the button for the next step. */
export function UpdateCard() {
  const theme = useTheme();
  const state = useUpdateState();
  const bridge = desktop();
  if (!state || !bridge) return null;

  const check = <Button label="Check for updates" variant="secondary" size="small" onPress={() => void bridge.checkForUpdates()} />;

  switch (state.status) {
    case 'idle':
    case 'current':
      return (
        <Card>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="cardTitle">{state.status === 'current' ? 'You’re up to date' : 'Updates'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Meld checks for new versions on its own while it’s open.
              </ThemedText>
            </View>
            {check}
          </View>
        </Card>
      );
    case 'checking':
      return (
        <Card>
          <View style={styles.row}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary">Checking for updates…</ThemedText>
          </View>
        </Card>
      );
    case 'error':
      return (
        <Card>
          <View style={styles.row}>
            <ThemedText themeColor="negative" style={styles.rowText}>
              {state.message}
            </ThemedText>
            {state.version ? <Button label="Try again" size="small" onPress={() => act(state)} /> : check}
          </View>
        </Card>
      );
    case 'available':
    case 'downloading':
    case 'ready': {
      const ready = state.status === 'ready';
      const downloading = state.status === 'downloading';
      return (
        <Card style={{ borderColor: theme.tint }}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText type="cardTitle">
                {ready
                  ? `Meld ${state.version} is ready to install`
                  : downloading
                    ? `Downloading Meld ${state.version}`
                    : `Meld ${state.version} is available`}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {ready
                  ? 'Restarting takes a few seconds; your data stays as it is. It also installs the next time you quit.'
                  : downloading
                    ? 'Downloading in the background. Keep using Meld meanwhile.'
                    : 'See what’s in it below.'}
              </ThemedText>
            </View>
            {ready ? (
              <Button label="Restart to update" size="small" onPress={() => act(state)} />
            ) : downloading ? null : (
              <Button label="Download and install" size="small" onPress={() => act(state)} />
            )}
          </View>
          {downloading && (
            <View style={styles.barRow}>
              <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.barFill, { width: `${state.percent}%`, backgroundColor: theme.tint }]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.barLabel}>
                {state.percent}%
              </ThemedText>
            </View>
          )}
        </Card>
      );
    }
  }
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    height: 36,
    paddingHorizontal: Spacing.three,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pillText: { fontVariant: ['tabular-nums'] },
  progress: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.14 },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  rowText: { flex: 1, minWidth: 200, gap: Spacing.half },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  bar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  barLabel: { minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
