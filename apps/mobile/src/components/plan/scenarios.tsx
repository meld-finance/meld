import {
  projectRetirement,
  resolvePlan,
  ScenarioName,
  SIMULATION_DEFAULTS,
  simulateRetirement,
  withPlan,
  type RetirementPlan,
  type RetirementSummary,
} from '@meld/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Dropdown } from '@/components/dropdown';
import { Input } from '@/components/plan/profile-tab';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCompactCurrency } from '@/lib/format';
import { useCreateScenario, useDeleteScenario, useUpdateScenario } from '@/lib/queries';

/** Fewer runs than the main card: one simulation per scenario. */
const COMPARE_TRIALS = 500;

/** Asks before leaving a scenario with unsaved changes. */
const leave = async (dirty: boolean) =>
  !dirty || confirm('Discard your changes?', 'Changes to this scenario haven’t been saved.', 'Discard');

/** Picks, copies, renames and removes scenarios; the active one is the plan the rest of Meld uses. */
export function ScenarioBar({
  summary,
  dirty,
  onSelect,
}: {
  summary: RetirementSummary;
  dirty: boolean;
  /** null selects the active scenario. */
  onSelect: (id: string | null) => void;
}) {
  const create = useCreateScenario();
  const update = useUpdateScenario();
  const remove = useDeleteScenario();
  const [editing, setEditing] = useState<{ kind: 'rename' | 'copy'; name: string } | null>(null);
  const { scenario, scenarios } = summary;
  const error = create.error ?? update.error ?? remove.error;
  const nameValid = !!editing && ScenarioName.safeParse(editing.name).success;

  async function select(id: string) {
    if (id !== scenario.id && (await leave(dirty))) onSelect(id);
  }

  async function startCopy() {
    if (await leave(dirty)) setEditing({ kind: 'copy', name: `${scenario.name} copy` });
  }

  function submit() {
    if (!editing || !nameValid) return;
    if (editing.kind === 'rename') {
      update.mutate({ id: scenario.id, name: editing.name }, { onSuccess: () => setEditing(null) });
    } else {
      create.mutate({ name: editing.name, copyFrom: scenario.id }, { onSuccess: (s) => onSelect(s.id) });
    }
  }

  async function deleteScenario() {
    const ok = await confirm(`Delete ${scenario.name}?`, 'Its plan and saved runs will be deleted.', 'Delete');
    if (ok) remove.mutate(scenario.id, { onSuccess: () => onSelect(null) });
  }

  return (
    <Card
      title="Scenario"
      subtitle="Copy your plan to try a what-if without changing it. The active scenario is the one Ask Meld uses."
      // Above the cards that follow, so the open list isn't hidden.
      style={styles.raised}>
      {editing ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Input
              value={editing.name}
              onChangeText={(name) => setEditing({ ...editing, name })}
              onSubmitEditing={submit}
              maxLength={60}
              autoFocus
              accessibilityLabel={editing.kind === 'rename' ? 'Scenario name' : 'Name for the copy'}
            />
          </View>
          <Button
            label={editing.kind === 'rename' ? 'Rename' : 'Make a copy'}
            size="small"
            disabled={!nameValid}
            loading={create.isPending || update.isPending}
            onPress={submit}
          />
          <Button label="Cancel" variant="secondary" size="small" onPress={() => setEditing(null)} />
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Dropdown
              accessibilityLabel="Scenario"
              value={scenario.id}
              onChange={select}
              options={scenarios.map((s) => ({ value: s.id, label: s.active ? `${s.name} · active` : s.name }))}
            />
          </View>
          <Button label="Copy" variant="secondary" size="small" onPress={startCopy} />
          <Button label="Rename" variant="secondary" size="small" onPress={() => setEditing({ kind: 'rename', name: scenario.name })} />
          {!scenario.active && (
            <Button
              label="Make active"
              size="small"
              loading={update.isPending}
              onPress={() => update.mutate({ id: scenario.id, active: true })}
            />
          )}
          {scenarios.length > 1 && (
            <Button label="Delete" variant="secondary" size="small" loading={remove.isPending} onPress={deleteScenario} />
          )}
        </View>
      )}
      {error && <ThemedText themeColor="negative">{error.message}</ThemedText>}
    </Card>
  );
}

const COLUMNS = [
  { label: 'Scenario', width: 180 },
  { label: 'Retire at', width: 72 },
  { label: 'Spending', width: 88 },
  { label: 'Projected', width: 96 },
  { label: 'Needed', width: 96 },
  { label: 'Gap', width: 96 },
  { label: 'Lasts', width: 64 },
] as const;

/** Every scenario side by side; the one being edited uses what's typed. */
export function ScenarioCompare({
  summary,
  draft,
  dirty,
  onSelect,
}: {
  summary: RetirementSummary;
  draft: RetirementPlan;
  dirty: boolean;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  const draftKey = useDebouncedValue(JSON.stringify(draft), 250);
  const rows = useMemo(() => {
    const current = JSON.parse(draftKey) as RetirementPlan;
    return summary.scenarios.map((s) => {
      const plan = s.id === summary.scenario.id ? current : s.plan;
      const { inputs } = resolvePlan(plan, withPlan(summary, plan));
      if (!inputs) return { scenario: s, cells: null };
      const p = projectRetirement(inputs);
      const sim = simulateRetirement(inputs, { ...SIMULATION_DEFAULTS, trials: COMPARE_TRIALS });
      return {
        scenario: s,
        cells: [
          String(inputs.retirementAge),
          formatCompactCurrency(p.spendingAtRetirement),
          formatCompactCurrency(p.atRetirement),
          formatCompactCurrency(p.needed),
          p.gap > 0 ? `Short ${formatCompactCurrency(p.gap)}` : `+${formatCompactCurrency(-p.gap)}`,
          `${Math.round(sim.successRate * 100)}%`,
        ],
      };
    });
  }, [summary, draftKey]);

  async function select(id: string) {
    if (id !== summary.scenario.id && (await leave(dirty))) onSelect(id);
  }

  return (
    <Card
      title="Compare scenarios"
      subtitle={`Spending is in the first year of retirement. “Lasts” is the share of ${COMPARE_TRIALS} random-return runs where the money lasts.`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.tableRow, { borderColor: theme.border }]}>
            {COLUMNS.map((c) => (
              <ThemedText key={c.label} type="small" themeColor="textSecondary" style={{ width: c.width }}>
                {c.label}
              </ThemedText>
            ))}
          </View>
          {rows.map(({ scenario: s, cells }) => {
            const viewing = s.id === summary.scenario.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => select(s.id)}
                disabled={viewing}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}`}
                style={({ hovered }) => [styles.tableRow, { borderColor: theme.border }, hovered && !viewing && { backgroundColor: theme.background }]}>
                <View style={{ width: COLUMNS[0].width }}>
                  <ThemedText type={viewing ? 'smallBold' : 'small'} numberOfLines={1}>
                    {s.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[s.active && 'Active', viewing && (dirty ? 'Editing, unsaved' : 'Editing')].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                {cells ? (
                  cells.map((c, i) => (
                    <ThemedText key={COLUMNS[i + 1]!.label} type="small" style={{ width: COLUMNS[i + 1]!.width }}>
                      {c}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Needs your birth year and spending
                  </ThemedText>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  raised: { zIndex: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  grow: { flexGrow: 1, flexBasis: 220 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
