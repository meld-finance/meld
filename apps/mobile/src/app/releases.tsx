import type { Release } from '@meld/shared';
import { router } from 'expo-router';
import { Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Markdown } from '@/components/markdown';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UpdateCard } from '@/components/update-controls';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { compareVersions, desktop } from '@/lib/desktop';
import { useFeatures, useReleases } from '@/lib/queries';

const RELEASES_URL = 'https://github.com/meld-finance/meld/releases';

/** What's new: every Meld release's notes, newest first, with updating in the Mac app. */
export default function ReleasesScreen() {
  const releases = useReleases();
  const features = useFeatures();
  const current = desktop()?.version || features.data?.version || null;
  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <ThemedText type="linkPrimary">‹ Back</ThemedText>
    </Pressable>
  );

  return (
    <Screen
      title="What’s new"
      actions={back}
      refreshControl={<RefreshControl refreshing={releases.isRefetching} onRefresh={() => void releases.refetch()} />}>
      {current && <VersionLine version={current} />}
      <UpdateCard />
      {releases.isPending ? (
        <ThemedText themeColor="textSecondary">Loading release notes…</ThemedText>
      ) : releases.isError ? (
        <ThemedText themeColor="negative">{releases.error.message}</ThemedText>
      ) : releases.data.releases.length === 0 ? (
        <ThemedText themeColor="textSecondary">No releases yet.</ThemedText>
      ) : (
        releases.data.releases.map((r) => <ReleaseCard key={r.version} release={r} current={current} />)
      )}
      <ThemedText
        type="small"
        themeColor="textSecondary"
        accessibilityRole="link"
        style={styles.allLink}
        onPress={() => void Linking.openURL(RELEASES_URL)}>
        All releases on GitHub ›
      </ThemedText>
    </Screen>
  );
}

/** The running version, quiet: it's for reference, not the point of the page. */
function VersionLine({ version }: { version: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.version} selectable>
      You’re on Meld {version}
    </ThemedText>
  );
}

function ReleaseCard({ release, current }: { release: Release; current: string | null }) {
  const order = current ? compareVersions(release.version, current) : null;
  const date = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  // Its own header rather than Card's title, so the release name stands above the notes' headings.
  return (
    <Card>
      <View style={styles.releaseHeader}>
        <View style={styles.releaseTitles}>
          <ThemedText style={styles.releaseName}>{release.name}</ThemedText>
          {!!date && (
            <ThemedText type="small" themeColor="textSecondary">
              {date}
            </ThemedText>
          )}
        </View>
        {order === 0 ? <Badge label="Installed" tone="neutral" /> : order === 1 ? <Badge label="New" tone="accent" /> : null}
      </View>
      {release.notes ? (
        <Markdown text={release.notes} variant="document" />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No notes for this release.
        </ThemedText>
      )}
    </Card>
  );
}

function Badge({ label, tone }: { label: string; tone: 'neutral' | 'accent' }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const colors = tone === 'accent' ? { bg: accent.bg, fg: accent.fg } : { bg: theme.backgroundSelected, fg: theme.textSecondary };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color: colors.fg }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  version: { opacity: 0.75, marginTop: -Spacing.two },
  releaseHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  releaseTitles: { flexShrink: 1, gap: Spacing.half },
  releaseName: { fontSize: 22, lineHeight: 28, fontWeight: 700, letterSpacing: -0.3 },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.two, marginTop: Spacing.one },
  badgeText: { fontSize: 12, lineHeight: 18 },
  allLink: { alignSelf: 'center', paddingVertical: Spacing.two },
});
