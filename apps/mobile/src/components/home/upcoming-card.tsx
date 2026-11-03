import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { daysBetween, type Upcoming } from '@/lib/home';

const COLLAPSED = 8;

function dayLabel(today: string, date: string) {
  const days = daysBetween(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
  return `${weekday}, ${formatDate(date)}`;
}

/** Money moving in the next couple of weeks, by day: bills, autopay, premiums and paychecks. */
export function UpcomingCard({ items, today, days, style }: { items: Upcoming[]; today: string; days: number; style?: object }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, COLLAPSED);
  const out = items.reduce((s, i) => s + Math.max(i.amount ?? 0, 0), 0);
  const income = items.reduce((s, i) => s - Math.min(i.amount ?? 0, 0), 0);
  const groups = new Map<string, Upcoming[]>();
  for (const i of shown) groups.set(i.date, [...(groups.get(i.date) ?? []), i]);

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
        <ThemedText type="small" themeColor="textSecondary">
          Nothing due in the next {days} days. Bills, subscriptions and paychecks show up here once Meld has seen them repeat;
          loan and card due dates once your accounts sync.
        </ThemedText>
      ) : (
        <View style={styles.days}>
          {[...groups].map(([date, rows]) => (
            <View key={date} style={styles.day}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.dayLabel}>
                {dayLabel(today, date)}
              </ThemedText>
              {rows.map((u) => (
                <Pressable
                  key={u.key}
                  onPress={() => router.push(u.href as Href)}
                  style={({ pressed }) => [styles.row, { borderTopColor: theme.border }, pressed && styles.pressed]}>
                  <Icon name={u.icon} size={16} themeColor="textSecondary" />
                  <View style={styles.label}>
                    <ThemedText type="small" numberOfLines={1}>
                      {u.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.detail}>
                      {u.detail}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" themeColor={u.amount !== null && u.amount < 0 ? 'positive' : 'text'}>
                    {u.amount === null
                      ? '—'
                      : `${u.approximate ? '~' : ''}${u.amount < 0 ? '+' : ''}${formatCurrency(Math.abs(u.amount))}`}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      )}
      {items.length > COLLAPSED && (
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.more}>
          <ThemedText type="small" themeColor="tint">
            {expanded ? 'Show less' : `Show all ${items.length}`}
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  days: { gap: Spacing.three },
  day: { gap: Spacing.one },
  dayLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, minWidth: 0 },
  detail: { fontSize: 12 },
  more: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
