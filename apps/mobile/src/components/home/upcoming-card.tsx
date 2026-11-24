import type { AutopayHealth } from '@meld/shared';
import { Link, router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { daysBetween, type Upcoming } from '@/lib/home';

const COLLAPSED = 6;

const HEALTH_PILL: Record<Exclude<AutopayHealth, 'unknown'>, { label: string; color: ThemeColor; tone: 'green' | 'orange' | 'neg' | 'neutral' }> = {
  covered: { label: 'Covered', color: 'positive', tone: 'green' },
  tight: { label: 'Tight', color: 'warning', tone: 'orange' },
  short: { label: 'Short', color: 'negative', tone: 'neg' },
  paid: { label: 'Paid', color: 'textSecondary', tone: 'neutral' },
};

function dayLabel(today: string, date: string) {
  const days = daysBetween(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
  return `${weekday}, ${formatDate(date)}`;
}

/** Money moving in the next couple of weeks, by day: bills, autopay, premiums and paychecks. */
export function UpcomingCard({ items, today, days, style }: { items: Upcoming[]; today: string; days: number; style?: ViewStyle }) {
  const theme = useTheme();
  const accents = useAccents();
  const dark = useColorScheme() === 'dark';
  const [expanded, setExpanded] = useState(false);

  const shown = expanded ? items : items.slice(0, COLLAPSED);
  const out = items.reduce((s, i) => s + Math.max(i.amount ?? 0, 0), 0);
  const income = items.reduce((s, i) => s - Math.min(i.amount ?? 0, 0), 0);
  const groups = new Map<string, Upcoming[]>();
  for (const i of shown) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);

  const toneBg = (tone: 'green' | 'orange' | 'neg' | 'neutral') =>
    tone === 'green'
      ? accents.green.bg
      : tone === 'orange'
        ? accents.orange.bg
        : tone === 'neg'
          ? dark
            ? 'rgba(242, 139, 130, 0.16)'
            : 'rgba(197, 34, 31, 0.10)'
          : theme.backgroundSelected;

  return (
    <Card
      title="Coming up"
      subtitle={
        items.length
          ? `Next ${days} days · ${formatWholeCurrency(out)} out${income ? ` · ${formatWholeCurrency(income)} in` : ''}`
          : `Next ${days} days`
      }
      action={
        <Pressable accessibilityRole="link" onPress={() => router.push('/spending?tab=recurring')}>
          <ThemedText type="small" themeColor="tint">
            Recurring →
          </ThemedText>
        </Pressable>
      }
      style={style}>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText type="small" themeColor="textSecondary">
            Nothing due in the next {days} days. Bills, subscriptions and paychecks show up here once Meld sees them repeat;
            loan and card due dates once your accounts sync.
          </ThemedText>
          <Link href="/spending?tab=recurring">
            <ThemedText type="smallBold" themeColor="tint">
              Manage recurring & autopay →
            </ThemedText>
          </Link>
        </View>
      ) : (
        <View style={styles.days}>
          {[...groups].map(([date, rows]) => (
            <View key={date} style={styles.day}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.dayLabel}>
                {dayLabel(today, date)}
              </ThemedText>
              {rows.map((u) => {
                const pill = u.autopayHealth && u.autopayHealth !== 'unknown' ? HEALTH_PILL[u.autopayHealth] : null;
                return (
                  <Pressable
                    key={u.key}
                    onPress={() => router.push(u.href as Href)}
                    style={({ pressed }) => [styles.row, { borderTopColor: theme.border }, pressed && styles.pressed]}>
                    <View style={[styles.iconTile, { backgroundColor: theme.background }]}>
                      <Icon name={u.icon} size={15} themeColor="textSecondary" />
                    </View>
                    <View style={styles.label}>
                      <ThemedText type="small" numberOfLines={1}>
                        {u.name}
                      </ThemedText>
                      <View style={styles.detailRow}>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.detail}>
                          {u.detail}
                        </ThemedText>
                        {pill && (
                          <View style={[styles.healthPill, { backgroundColor: toneBg(pill.tone) }]}>
                            <ThemedText type="smallBold" themeColor={pill.color} style={styles.healthText}>
                              {pill.label}
                            </ThemedText>
                          </View>
                        )}
                      </View>
                    </View>
                    <ThemedText type="smallBold" themeColor={u.amount !== null && u.amount < 0 ? 'positive' : 'text'}>
                      {u.amount === null
                        ? '—'
                        : `${u.approximate ? '~' : ''}${u.amount < 0 ? '+' : ''}${formatCurrency(Math.abs(u.amount))}`}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}
      {items.length > COLLAPSED && (
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.more}>
          <ThemedText type="smallBold" themeColor="tint">
            {expanded ? 'Show less' : `Show all ${items.length}`}
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { gap: Spacing.two },
  days: { gap: Spacing.three },
  day: { gap: Spacing.one },
  dayLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.half, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  iconTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, gap: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detail: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  healthPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  healthText: { fontSize: 11, lineHeight: 14 },
  more: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
