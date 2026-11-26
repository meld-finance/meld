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
import { InfoTip } from '@/components/info-tip';
import { Input } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
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

/** Compact toolbar for picking, copying, renaming, and removing scenarios; the active one is used across Meld. */
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
  const theme = useTheme();
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
    <ThemedView type="backgroundElement" style={[styles.toolbar, { borderColor: theme.border }]}>
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
          <View style={styles.labelGroup}>
            <ThemedText type="smallBold">Scenario</ThemedText>
            <InfoTip title={TIPS.scenarios.title}>{TIPS.scenarios.body}</InfoTip>
          </View>
          <View style={styles.picker}>
            <Dropdown
              accessibilityLabel="Scenario"
              value={scenario.id}
              onChange={select}
              options={scenarios.map((s) => ({ value: s.id, label: s.active ? `${s.name} · active` : s.name }))}
            />
          </View>
          <View style={styles.actions}>
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
        </View>
      )}
      {error && <ThemedText type="small" themeColor="negative">{error.message}</ThemedText>}
    </ThemedView>
  );
}

const COLUMNS = [
  { label: 'Scenario', width: 180, numeric: false },
  { label: 'Retire at', width: 88, numeric: true },
  { label: 'Spending', width: 92, numeric: true },
  { label: 'Projected', width: 100, numeric: true },
  { label: 'Needed', width: 100, numeric: true },
  { label: 'Gap', width: 104, numeric: true },
  { label: 'Lasts', width: 68, numeric: true },
] as const;

type CellSpec = { text: string; color?: ThemeColor; bold?: boolean };

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
      const pct = Math.round(sim.successRate * 100);
      const cells: CellSpec[] = [
        {
          text:
            inputs.partner && inputs.partner.retirementAge !== inputs.retirementAge
              ? `${inputs.retirementAge} / ${inputs.partner.retirementAge}`
              : String(inputs.retirementAge),
        },
        { text: formatCompactCurrency(p.spendingAtRetirement) },
        { text: formatCompactCurrency(p.atRetirement) },
        { text: formatCompactCurrency(p.needed) },
        {
          text: p.gap > 0 ? `Short ${formatCompactCurrency(p.gap)}` : `+${formatCompactCurrency(-p.gap)}`,
          color: p.gap > 0 ? 'negative' : 'positive',
          bold: true,
        },
        {
          text: `${pct}%`,
          color: pct >= 80 ? 'positive' : pct >= 60 ? 'warning' : 'negative',
          bold: true,
        },
      ];
      return { scenario: s, cells };
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
              <ThemedText
                key={c.label}
                type="small"
                themeColor="textSecondary"
                style={[{ width: c.width }, c.numeric && styles.numeric]}>
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
                style={({ hovered }) => [
                  styles.tableRow,
                  { borderColor: theme.border },
                  hovered && !viewing && { backgroundColor: theme.background },
                ]}>
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
                    <ThemedText
                      key={COLUMNS[i + 1]!.label}
                      type={c.bold ? 'smallBold' : 'small'}
                      themeColor={c.color}
                      style={[{ width: COLUMNS[i + 1]!.width }, styles.numeric]}>
                      {c.text}
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
  toolbar: {
    zIndex: 10,
    borderWidth: 1,
    borderRadius: Spacing.three + Spacing.one,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  labelGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  picker: { flexGrow: 1, flexBasis: 200 },
  grow: { flexGrow: 1, flexBasis: 220 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
});
