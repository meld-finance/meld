import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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

const COLLAPSED = 6;

const countdown = (days: number) => (days < 0 ? 'past due' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** Everything across Meld that wants something from you, in one list, most pressing first. */
export function TaskList({ tasks, today, loading, style }: { tasks: Task[]; today: string; loading: boolean; style?: object }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tasks : tasks.slice(0, COLLAPSED);
  const pressing = tasks.filter((t) => t.urgency !== 'later').length;

  return (
    <Card
      title="Your to-dos"
      subtitle={
        tasks.length === 0
          ? undefined
          : pressing
            ? `${pressing} need attention soon · ${tasks.length} in all, from bills, cash, taxes, estate and your plan`
            : `${tasks.length} across bills, cash, taxes, estate and your plan. Nothing urgent.`
      }
      style={style}>
      {tasks.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {loading ? 'Checking your accounts and plans…' : 'You’re all caught up. New to-dos show up here as bills come due, deadlines approach or your plans change.'}
        </ThemedText>
      ) : (
        <View>
          {shown.map((t, i) => (
            <View key={t.key} style={i > 0 && [styles.divider, { borderTopColor: theme.border }]}>
              <TaskRow task={t} today={today} />
            </View>
          ))}
        </View>
      )}
      {tasks.length > COLLAPSED && (
        <Pressable onPress={() => setExpanded((e) => !e)} style={styles.more}>
          <ThemedText type="small" themeColor="tint">
            {expanded ? 'Show less' : `Show all ${tasks.length}`}
          </ThemedText>
        </Pressable>
      )}
    </Card>
  );
}

function TaskRow({ task: t, today }: { task: Task; today: string }) {
  const theme = useTheme();
  const area = AREAS[t.area];
  const accent = useAccents()[area.accent];
  const chat = useStartChat();
  const dismiss = useDismissAlert();
  const days = t.due ? daysBetween(today, t.due) : null;
  const flag = t.urgency === 'now' ? 'negative' : t.urgency === 'soon' ? 'warning' : null;

  const meta = [
    area.label,
    t.due && days !== null && `${t.dueLabel ?? 'Due'} ${formatDate(t.due)} · ${countdown(days)}`,
    t.impact ? `worth ~${formatWholeCurrency(t.impact)}` : null,
  ].filter(Boolean);

  return (
    <View style={styles.row}>
      {t.checklist ? (
        <ChecklistBox year={t.checklist.year} id={t.checklist.id} />
      ) : (
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={area.icon} size={18} color={accent.fg} />
        </View>
      )}
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(t.href as Href)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <View style={styles.titleRow}>
          {flag && <View style={[styles.dot, { backgroundColor: theme[flag] }]} />}
          <ThemedText type="smallBold" style={styles.title}>
            {t.title}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {t.detail}
        </ThemedText>
        <ThemedText type="small" themeColor={flag ?? 'textSecondary'} style={styles.meta}>
          {meta.join(' · ')}
        </ThemedText>
      </Pressable>
      {t.question && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ask Meld about: ${t.title}`}
          disabled={chat.isPending}
          onPress={() => chat.start(t.question!)}
          style={({ hovered, pressed }) => [
            styles.ask,
            { borderColor: hovered ? theme.tint : theme.border },
            pressed && styles.pressed,
          ]}>
          <Icon name="sparkles" size={16} themeColor="tint" />
        </Pressable>
      )}
      {t.alertId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss: ${t.title}`}
          disabled={dismiss.isPending}
          onPress={() => dismiss.mutate({ id: t.alertId!, dismissed: true })}
          style={({ hovered, pressed }) => [
            styles.ask,
            { borderColor: hovered ? theme.tint : theme.border },
            pressed && styles.pressed,
          ]}>
          <Icon name="close" size={16} themeColor="textSecondary" />
        </Pressable>
      )}
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
      style={({ hovered }) => [styles.check, { borderColor: hovered ? theme.tint : theme.textSecondary }]}>
      {setDone.isPending && <Icon name="check" size={14} themeColor="tint" strokeWidth={2.5} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.three },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  check: { width: 22, height: 22, margin: 7, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: Spacing.half },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { marginTop: Spacing.one, fontSize: 13 },
  ask: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  more: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
