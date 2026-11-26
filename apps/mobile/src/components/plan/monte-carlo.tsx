import {
  firstRetireAge,
  SIMULATION_DEFAULTS,
  SimulationSettings,
  simulateRetirement,
  type RetirementInputs,
  type SavedSimulation,
  type SimulationResult,
} from '@meld/shared';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RetirementFan } from '@/components/charts/retirement-fan';
import { Chip } from '@/components/chip';
import { Dropdown } from '@/components/dropdown';
import { StatTile, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { useDeleteSimulation, useRunSimulation, useSimulations } from '@/lib/queries';

const TRIALS = ['500', '1000', '5000'] as const;

const VOLATILITY_PRESETS = [
  { label: 'Balanced · 7%', value: 7 },
  { label: 'Moderate · 10%', value: 10 },
  { label: 'Stock-heavy · 12%', value: 12 },
  { label: 'All stocks · 15%', value: 15 },
] as const;

const percent = (rate: number) => `${Math.round(rate * 100)}%`;
/** Balances at the first retirement age, or at the end of the plan once already retired. */
const milestoneOf = (inputs: RetirementInputs, result: SimulationResult) => {
  const firstRetire = firstRetireAge(inputs);
  return firstRetire > inputs.currentAge
    ? { age: firstRetire, balance: result.atRetirement }
    : { age: inputs.lifeExpectancy, balance: result.endingBalance };
};

const runDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The plan run many times with random yearly returns: how often the money lasts, and the range of
 * balances along the way. Follows the draft as it's typed; saved runs keep what they found on the day.
 */
export function MonteCarlo({ scenarioId, inputs, dirty }: { scenarioId: string; inputs: RetirementInputs; dirty: boolean }) {
  const theme = useTheme();
  const [volatilityText, setVolatilityText] = useState('');
  const [trials, setTrials] = useState<(typeof TRIALS)[number]>(String(SIMULATION_DEFAULTS.trials) as '1000');
  const [viewing, setViewing] = useState<string | null>(null);
  const simulations = useSimulations(scenarioId);
  const run = useRunSimulation(scenarioId);
  const remove = useDeleteSimulation(scenarioId);

  const typed = volatilityText.trim() ? Number(volatilityText.replace(/[%\s]/g, '')) : SIMULATION_DEFAULTS.volatility;
  const invalidVolatility = !SimulationSettings.shape.volatility.safeParse(typed).success;
  const settings: SimulationSettings = {
    trials: Number(trials),
    volatility: invalidVolatility ? SIMULATION_DEFAULTS.volatility : typed,
    seed: SIMULATION_DEFAULTS.seed,
  };

  // Thousands of runs per keystroke is too many: wait for typing to pause.
  const key = useDebouncedValue(JSON.stringify({ inputs, settings }), 250);
  const live = useMemo(() => {
    const parsed = JSON.parse(key) as { inputs: RetirementInputs; settings: SimulationSettings };
    return { ...parsed, result: simulateRetirement(parsed.inputs, parsed.settings) };
  }, [key]);

  const saved = simulations.data?.find((s) => s.id === viewing) ?? null;
  const shown: { inputs: RetirementInputs; settings: SimulationSettings; result: SimulationResult } = saved ?? live;
  const { result } = shown;
  const milestone = milestoneOf(shown.inputs, result);
  const successTone = result.successRate >= 0.8 ? 'positive' : result.successRate >= 0.6 ? 'warning' : 'negative';

  async function deleteRun(s: SavedSimulation) {
    if (!(await confirm('Delete this run?', `The run from ${runDate(s.createdAt)} will be deleted.`, 'Delete'))) return;
    if (viewing === s.id) setViewing(null);
    remove.mutate(s.id);
  }

  return (
    <Card
      title="Chance of success"
      tip={TIPS.monteCarlo}
      subtitle={`${shown.settings.trials.toLocaleString()} runs of your plan with returns that rise and fall at random each year, averaging ${shown.inputs.expectedReturn}% after inflation`}>
      {saved && (
        <View style={[styles.banner, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
            Showing the run saved {runDate(saved.createdAt)}, starting from {formatWholeCurrency(saved.inputs.startingBalance)}.
          </ThemedText>
          <Button label="Back to your plan" variant="secondary" size="small" onPress={() => setViewing(null)} />
        </View>
      )}
      <TileRow>
        <StatTile
          label="Lasts to the end"
          tone={successTone}
          value={percent(result.successRate)}
          caption={
            shown.inputs.partner && shown.inputs.lifeExpectancy > (shown.inputs.yourLifeExpectancy ?? shown.inputs.lifeExpectancy)
              ? `Of runs, lasts to ${shown.inputs.partner.name}’s ${shown.inputs.partner.lifeExpectancy}`
              : `Of runs, money lasts to ${shown.inputs.lifeExpectancy}`
          }
        />
        <StatTile label={`Median at ${milestone.age}`} value={milestone.balance.p50} caption="Half the runs end up above this" />
        <StatTile label={`Bad case at ${milestone.age}`} value={milestone.balance.p10} caption="1 run in 10 ends up below this" />
        {result.medianDepletionAge !== null && (
          <StatTile
            label="When it runs short"
            value={`Age ${result.medianDepletionAge}`}
            caption="Median, in the runs that run short"
          />
        )}
      </TileRow>
      <RetirementFan bands={result.bands} retirementAge={shown.inputs.retirementAge} partner={shown.inputs.partner ?? null} />
      <ThemedText type="small" themeColor="textSecondary">
        The line is the median. The darker band holds half the runs and the lighter one 8 in 10. A run of bad years
        early in retirement hurts most, which a single average return can’t show.
      </ThemedText>

      {!saved && (
        <>
          <Row>
            <Field label="Volatility, %" invalid={invalidVolatility} tip={TIPS.volatility}>
              <Input
                value={volatilityText}
                onChangeText={setVolatilityText}
                placeholder={`${SIMULATION_DEFAULTS.volatility} · about 6–8 for a balanced mix`}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </Field>
            <Field label="Runs">
              <Dropdown
                accessibilityLabel="Number of runs"
                value={trials}
                onChange={setTrials}
                options={TRIALS.map((t) => ({ value: t, label: Number(t).toLocaleString() }))}
              />
            </Field>
          </Row>
          <View style={styles.presets}>
            {VOLATILITY_PRESETS.map((p) => (
              <Chip
                key={p.value}
                label={p.label}
                selected={!invalidVolatility && typed === p.value}
                onPress={() => setVolatilityText(String(p.value))}
              />
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Volatility is how far a typical year strays from the average: about 15% for all stocks, 12% for a
            stock-heavy mix.
          </ThemedText>
          {run.isError && <ThemedText themeColor="negative">{run.error.message}</ThemedText>}
          <View style={styles.buttons}>
            <Button
              label="Save this run"
              variant="secondary"
              size="small"
              disabled={dirty || invalidVolatility}
              loading={run.isPending}
              onPress={() => run.mutate(settings, { onSuccess: (s) => setViewing(s.id) })}
            />
            {dirty && (
              <ThemedText type="small" themeColor="textSecondary">
                Save your plan changes first: a saved run uses the saved plan.
              </ThemedText>
            )}
          </View>
        </>
      )}

      {!!simulations.data?.length && (
        <View style={styles.runs}>
          <ThemedText type="smallBold">Saved runs</ThemedText>
          {simulations.data.map((s) => {
            const milestone = milestoneOf(s.inputs, s.result);
            return (
              <View key={s.id} style={[styles.run, { borderColor: theme.border }]}>
                <View style={styles.shrink}>
                  <ThemedText type="small">
                    {runDate(s.createdAt)} · {percent(s.result.successRate)} last
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatCompactCurrency(milestone.balance.p50)} median at {milestone.age} · from{' '}
                    {formatCompactCurrency(s.inputs.startingBalance)} · {s.settings.volatility}% volatility,{' '}
                    {s.settings.trials.toLocaleString()} runs
                  </ThemedText>
                </View>
                <View style={styles.buttons}>
                  <Button
                    label={viewing === s.id ? 'Showing' : 'View'}
                    variant={viewing === s.id ? 'primary' : 'secondary'}
                    size="small"
                    onPress={() => setViewing(viewing === s.id ? null : s.id)}
                  />
                  <Button
                    label="Run again today"
                    variant="secondary"
                    size="small"
                    disabled={run.isPending}
                    onPress={() => run.mutate(s.settings, { onSuccess: (next) => setViewing(next.id) })}
                    accessibilityLabel={`Run again with today’s balances and the settings from ${runDate(s.createdAt)}`}
                  />
                  <Button label="Delete" variant="secondary" size="small" onPress={() => deleteRun(s)} />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingBottom: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  presets: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  runs: { gap: Spacing.two },
  run: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  shrink: { flex: 1, flexShrink: 1, minWidth: 220 },
});
