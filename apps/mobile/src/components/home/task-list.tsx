import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatWholeCurrency } from '@/lib/format';
import { AREAS, daysBetween, type Task } from '@/lib/home';
import { useDismissAlert, useSetChecklistDone } from '@/lib/queries';

const COLLAPSED = 4;

type Filter = 'all' | 'urgent' | 'moves' | 'tax';

const countdown = (days: number) => (days < 0 ? 'past due' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** Alerts and high-leverage financial moves across Meld, sorted by urgency and dollar impact. */
export function TaskList({ tasks, today, loading, style }: { tasks: Task[]; today: string; loading: boolean; style?: ViewStyle }) {
  const theme = useTheme();
  const accents = useAccents();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const pressing = tasks.filter((t) => t.urgency !== 'later').length;
  const movesCount = tasks.filter((t) => t.kind === 'move').length;
  const taxCount = tasks.filter((t) => t.kind === 'checklist').length;

  const nonEmptyBuckets = [pressing > 0, movesCount > 0, taxCount > 0].filter(Boolean).length;
  const showFilters = tasks.length > 3 && nonEmptyBuckets >= 2;

  const activeFilter: Filter =
    filter === 'urgent' && pressing === 0
      ? 'all'
      : filter === 'moves' && movesCount === 0
        ? 'all'
        : filter === 'tax' && taxCount === 0
          ? 'all'
          : filter;

  const filtered =
    activeFilter === 'urgent'
      ? tasks.filter((t) => t.urgency !== 'later')
      : activeFilter === 'moves'
        ? tasks.filter((t) => t.kind === 'move')
        : activeFilter === 'tax'
          ? tasks.filter((t) => t.kind === 'checklist')
          : tasks;

  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED);

  const filterOptions: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: tasks.length },
    ...(pressing > 0 ? [{ key: 'urgent' as const, label: 'Urgent', count: pressing }] : []),
    ...(movesCount > 0 ? [{ key: 'moves' as const, label: 'Money moves', count: movesCount }] : []),
    ...(taxCount > 0 ? [{ key: 'tax' as const, label: 'Tax checklist', count: taxCount }] : []),
  ];

  return (
    <Card
      title="Worth your attention"
      subtitle={
        tasks.length === 0
          ? undefined
          : pressing
            ? `${pressing} ${pressing === 1 ? 'needs' : 'need'} attention soon · ${tasks.length} total`
            : `${tasks.length} opportunities across your accounts and plans`
      }
      style={style}>
      {showFilters && (
        <View style={styles.filters}>
          {filterOptions.map((o) => {
            const selected = o.key === activeFilter;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setFilter(o.key);
                  setExpanded(false);
                }}
                style={({ hovered, pressed }) => [
                  styles.filterChip,
                  selected
                    ? { backgroundColor: theme.tint, borderColor: theme.tint }
                    : { backgroundColor: theme.background, borderColor: hovered ? theme.tint : theme.border },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="small" style={[styles.filterText, { color: selected ? '#ffffff' : theme.textSecondary }]}>
                  {o.label} ({o.count})
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}

      {tasks.length === 0 ? (
        loading ? (
          <ThemedText type="small" themeColor="textSecondary">
            Checking your accounts and plans…
          </ThemedText>
        ) : (
          <View style={styles.empty}>
            <View style={[styles.emptyBadge, { backgroundColor: accents.green.bg }]}>
              <Icon name="check" size={18} color={accents.green.fg} strokeWidth={2.5} />
            </View>
            <View style={styles.emptyText}>
              <ThemedText type="smallBold">You’re all caught up</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                New items appear here as bills come due, deadlines approach, or opportunities open up.
              </ThemedText>
            </View>
          </View>
        )
      ) : (
        <View>
          {shown.map((t, i) => (
            <View key={t.key} style={i > 0 && [styles.divider, { borderTopColor: theme.border }]}>
              <TaskRow task={t} today={today} />
            </View>
          ))}
        </View>
      )}

      {filtered.length > COLLAPSED && (
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.more}>
          <ThemedText type="smallBold" themeColor="tint">
            {expanded ? 'Show less' : `Show all ${filtered.length}`}
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

function TaskRow({ task: t, today }: { task: Task; today: string }) {
  const theme = useTheme();
  const accents = useAccents();
  const area = AREAS[t.area];
  const accent = accents[area.accent];
  const chat = useStartChat();
  const dismiss = useDismissAlert();
  const days = t.due ? daysBetween(today, t.due) : null;
  const flag = t.urgency === 'now' ? 'negative' : t.urgency === 'soon' ? 'warning' : null;

  const meta = [
    area.label,
    t.due && days !== null && `${t.dueLabel ?? 'Due'} ${formatDate(t.due)} · ${countdown(days)}`,
  ].filter(Boolean);

  return (
    <View style={styles.row}>
      <View style={styles.badgeWrap}>
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={area.icon} size={18} color={accent.fg} />
        </View>
        {flag && <View style={[styles.urgencyDot, { backgroundColor: theme[flag], borderColor: theme.backgroundElement }]} />}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(t.href as Href)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <ThemedText type="smallBold" style={styles.title}>
          {t.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {t.detail}
        </ThemedText>
        <ThemedText type="small" themeColor={flag ?? 'textSecondary'} style={styles.meta}>
          {meta.join(' · ')}
        </ThemedText>
      </Pressable>

      <View style={styles.actions}>
        {t.impact !== null && t.impact > 0 && (
          <View style={[styles.impactPill, { backgroundColor: accents.green.bg }]}>
            <ThemedText type="smallBold" style={[styles.impactText, { color: accents.green.fg }]}>
              +{formatWholeCurrency(t.impact)}
            </ThemedText>
          </View>
        )}
        {t.checklist && <ChecklistBox year={t.checklist.year} id={t.checklist.id} />}
        {t.question && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask Meld about: ${t.title}`}
            disabled={chat.isPending}
            onPress={() => chat.start(t.question!)}
            style={({ hovered, pressed }) => [
              styles.actionButton,
              { borderColor: hovered ? theme.tint : theme.border },
              pressed && styles.pressed,
            ]}>
            <Icon name="sparkles" size={15} themeColor="tint" />
          </Pressable>
        )}
        {t.alertId && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss: ${t.title}`}
            disabled={dismiss.isPending}
            onPress={() => dismiss.mutate({ id: t.alertId!, dismissed: true })}
            style={({ hovered, pressed }) => [
              styles.actionButton,
              { borderColor: hovered ? theme.tint : theme.border },
              pressed && styles.pressed,
            ]}>
            <Icon name="close" size={15} themeColor="textSecondary" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Ticks a tax checklist item off right here, as on the Tax tab. */
function ChecklistBox({ year, id }: { year: number; id: string }) {
  const theme = useTheme();
  const setDone = useSetChecklistDone(year);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: false }}
      accessibilityLabel="Mark done"
      hitSlop={8}
      onPress={() => setDone.mutate({ id, done: true })}
      style={({ hovered, pressed }) => [
        styles.actionButton,
        { borderColor: hovered ? theme.positive : theme.border },
        pressed && styles.pressed,
      ]}>
      {({ hovered }) => (
        <Icon
          name="check"
          size={15}
          themeColor={setDone.isPending || hovered ? 'positive' : 'textSecondary'}
          strokeWidth={2.2}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  filterChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterText: { fontSize: 12, lineHeight: 16, fontWeight: 600 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  emptyBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyText: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.three },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  badgeWrap: { position: 'relative', marginTop: 2 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  urgencyDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  body: { flex: 1, minWidth: 0, gap: Spacing.half },
  title: { flexShrink: 1 },
  meta: { marginTop: Spacing.half, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, paddingTop: 2 },
  impactPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  impactText: { fontSize: 12, lineHeight: 16 },
  actionButton: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  more: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
