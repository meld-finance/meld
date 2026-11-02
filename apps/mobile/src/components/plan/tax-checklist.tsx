import type { ChecklistItem, TaxPlan } from '@meld/shared';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';
import { useSetChecklistDone } from '@/lib/queries';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const longDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const countdown = (days: number) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

/** The year's tax moves with a deadline, grouped by date and counting down. */
export function TaxChecklist({ plan }: { plan: TaxPlan }) {
  const items = plan.checklist;
  if (!items.length) return null;
  const yearEnd = `${plan.year}-12-31`;
  const toYearEnd = daysBetween(plan.asOf, yearEnd);
  const done = items.filter((i) => i.done).length;
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of items) groups.set(item.due, [...(groups.get(item.due) ?? []), item]);

  return (
    <Card
      title={`${plan.year} year-end checklist`}
      subtitle="Tax moves that run out, by date. Tick them off as you go. General rules, not tax advice.">
      <View style={styles.hero}>
        {toYearEnd >= 0 ? (
          <View>
            <ThemedText style={styles.big}>{toYearEnd === 0 ? 'Today' : `${toYearEnd} day${toYearEnd === 1 ? '' : 's'}`}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {toYearEnd === 0 ? `is the last day of ${plan.year}` : `left in ${plan.year}`}
            </ThemedText>
          </View>
        ) : (
          <View>
            <ThemedText style={styles.big}>{`${daysBetween(plan.asOf, items[0]!.due)} days`}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              to the next {plan.year} deadline
            </ThemedText>
          </View>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {done} of {items.length} done
        </ThemedText>
      </View>
      {[...groups].map(([due, group]) => (
        <View key={due} style={styles.group}>
          <ThemedText type="smallBold">
            {longDate(due)} · {countdown(daysBetween(plan.asOf, due))}
          </ThemedText>
          {group.map((item) => (
            <Row key={item.id} item={item} year={plan.year} />
          ))}
        </View>
      ))}
    </Card>
  );
}

function Row({ item, year }: { item: ChecklistItem; year: number }) {
  const theme = useTheme();
  const green = useAccents().green;
  const toggle = useSetChecklistDone(year);
  const chat = useStartChat();
  return (
    <View style={[styles.row, { borderTopColor: theme.border }, item.done && styles.done]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.title}
        hitSlop={8}
        onPress={() => toggle.mutate({ id: item.id, done: !item.done })}
        style={[styles.box, { borderColor: item.done ? green.fg : theme.textSecondary, backgroundColor: item.done ? green.fg : 'transparent' }]}>
        {item.done && <Icon name="check" size={14} color={theme.background} strokeWidth={2.5} />}
      </Pressable>
      <View style={styles.text}>
        <ThemedText type="smallBold" style={item.done && styles.struck}>
          {item.title}
        </ThemedText>
        {!item.done && (
          <ThemedText type="small" themeColor="textSecondary">
            {item.detail}
          </ThemedText>
        )}
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {item.dueLabel}
          </ThemedText>
          {item.impact !== null && item.impact > 0 && (
            <ThemedText type="small" style={{ color: green.fg }}>
              Saves about {formatWholeCurrency(item.impact)}
            </ThemedText>
          )}
          {item.general && (
            <ThemedText type="small" themeColor="textSecondary">
              May not apply to you
            </ThemedText>
          )}
          {toggle.isError && (
            <ThemedText type="small" themeColor="negative">
              Couldn’t save: {toggle.error.message}
            </ThemedText>
          )}
        </View>
      </View>
      {!item.done && (
        <Pressable accessibilityRole="button" accessibilityHint="Ask the assistant about this" disabled={chat.isPending} onPress={() => chat.start(item.question)} hitSlop={8}>
          {chat.isPending ? (
            <ActivityIndicator size="small" />
          ) : (
            <View style={styles.ask}>
              <ThemedText type="small" themeColor="textSecondary">
                Ask
              </ThemedText>
              <Icon name="chevronRight" size={14} themeColor="textSecondary" />
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three },
  big: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  group: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  done: { opacity: 0.6 },
  box: { width: 20, height: 20, marginTop: 1, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: Spacing.half },
  struck: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three },
  ask: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half, paddingTop: 1 },
});
