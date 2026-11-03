import type { Alert, AlertSeverity } from '@meld/shared';
import { Link, router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeTime } from '@/lib/format';
import { useAlerts, useDismissAlert } from '@/lib/queries';

export const SEVERITY: Record<AlertSeverity, { icon: IconName; color: 'negative' | 'warning' | 'tint' }> = {
  critical: { icon: 'info', color: 'negative' },
  warning: { icon: 'info', color: 'warning' },
  info: { icon: 'bell', color: 'tint' },
};

export const isOpen = (a: Alert) => !a.dismissedAt && !a.resolvedAt;

/** One alert: what happened, when, and buttons to open it or dismiss it. */
export function AlertRow({ alert: a, divider }: { alert: Alert; divider?: boolean }) {
  const theme = useTheme();
  const dismiss = useDismissAlert();
  const severity = SEVERITY[a.severity];
  const open = isOpen(a);
  return (
    <View style={[styles.row, divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }, !open && styles.faded]}>
      <Icon name={severity.icon} size={20} themeColor={open ? severity.color : 'textSecondary'} />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          {open && !a.readAt && <View style={[styles.dot, { backgroundColor: theme.tint }]} />}
          <ThemedText type="smallBold" style={styles.title}>
            {a.title}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {a.body}
        </ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {a.resolvedAt ? `Cleared ${formatRelativeTime(a.resolvedAt)}` : a.dismissedAt ? 'Dismissed' : formatRelativeTime(a.updatedAt)}
          </ThemedText>
          {a.href && (
            <Pressable accessibilityRole="link" onPress={() => router.push(a.href as Href)}>
              <ThemedText type="small" themeColor="tint">
                View
              </ThemedText>
            </Pressable>
          )}
          {!a.resolvedAt && (
            <Pressable accessibilityRole="button" disabled={dismiss.isPending} onPress={() => dismiss.mutate({ id: a.id, dismissed: !a.dismissedAt })}>
              <ThemedText type="small" themeColor="tint">
                {a.dismissedAt ? 'Restore' : 'Dismiss'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/** Open warnings on the home page, so they're seen on phones too (where there's no bell). */
export function HomeAlerts() {
  const alerts = useAlerts();
  const open = (alerts.data?.alerts ?? []).filter((a) => isOpen(a) && a.severity !== 'info');
  if (!open.length) return null;
  return (
    <Card
      title={open.length === 1 ? '1 alert' : `${open.length} alerts`}
      action={
        <Link href="/alerts">
          <ThemedText type="small" themeColor="tint">
            All alerts →
          </ThemedText>
        </Link>
      }>
      <View>
        {open.slice(0, 3).map((a, i) => (
          <AlertRow key={a.id} alert={a} divider={i > 0} />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.three },
  faded: { opacity: 0.65 },
  text: { flex: 1, minWidth: 0, gap: Spacing.half },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.half },
});
