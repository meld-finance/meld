import { DEFAULT_EMERGENCY_MONTHS, type CashPlan, type CashPosition, type CashSettings, type CashSuggestion } from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { InstitutionAvatar } from '@/components/accounts/institution-avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { InsightCallout, StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatWholeCurrency } from '@/lib/format';
import { useCashPlan, useSaveCashSettings } from '@/lib/queries';

const rate = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(2)}%`);
const months = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${n === 1 ? 'month' : 'months'}`;

/** Cash you can reach, what it earns, and how it measures up to an emergency fund. */
export function CashTab({ header }: { header: ReactNode }) {
  const plan = useCashPlan();
  return (
    <Screen wide refreshControl={<RefreshControl refreshing={plan.isRefetching} onRefresh={() => void plan.refetch()} />}>
      {header}
      <TabHeading
        title="Cash"
        subtitle="Checking, savings, money market funds and brokerage cash: what it earns, and how many months of spending it covers."
      />
      {plan.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : plan.isError ? (
        <ThemedText themeColor="negative">Couldn’t load your cash: {plan.error.message}</ThemedText>
      ) : (
        <CashPlanView plan={plan.data} />
      )}
    </Screen>
  );
}

function CashPlanView({ plan }: { plan: CashPlan }) {
  const { totals, emergency, benchmark, spending } = plan;
  if (!plan.positions.length) {
    return (
      <Card title="No cash accounts yet">
        <ThemedText type="small" themeColor="textSecondary">
          Link checking, savings or a brokerage account to see your cash here.
        </ThemedText>
      </Card>
    );
  }
  return (
    <>
      <TileRow>
        <StatTile
          label="Emergency cash"
          value={totals.emergency}
          caption={emergency.runwayMonths === null ? 'Add monthly spending to see your runway' : `${months(emergency.runwayMonths)} of spending`}
        />
        <StatTile
          label={`${emergency.targetMonths}-month target`}
          value={emergency.target ?? '—'}
          caption={
            emergency.gap === null
              ? 'Needs monthly spending'
              : emergency.gap >= 0
                ? `${formatWholeCurrency(emergency.gap)} more than needed`
                : `${formatWholeCurrency(-emergency.gap)} short`
          }
        />
        <StatTile label="Earning" value={rate(totals.apy)} caption={`About ${formatWholeCurrency(totals.yearlyInterest)} a year in interest`} />
        <StatTile
          label="High-yield rate now"
          value={rate(benchmark.apy)}
          caption={
            totals.missedInterest > 0
              ? `${formatWholeCurrency(totals.missedInterest)} a year more if you moved idle cash`
              : benchmark.source === 'entered'
                ? 'The rate you entered'
                : '3-month Treasury bill yield'
          }
        />
      </TileRow>

      {emergency.runwayMonths !== null && spending.monthly !== null && <RunwayCard plan={plan} />}

      <Suggestions suggestions={plan.suggestions} />

      <PositionsCard plan={plan} />
      <SettingsCard plan={plan} />
    </>
  );
}

/** Months of spending covered, against the target. */
function RunwayCard({ plan }: { plan: CashPlan }) {
  const viz = useVizColors();
  const theme = useTheme();
  const { emergency, spending } = plan;
  const runway = emergency.runwayMonths!;
  const target = emergency.targetMonths;
  const scale = Math.max(runway, target, 1) * 1.1;
  const short = runway < target;
  return (
    <Card
      title="Runway"
      subtitle={
        spending.source === 'entered'
          ? `At the ${formatWholeCurrency(spending.monthly)} a month you entered.`
          : `At ${formatWholeCurrency(spending.monthly)} a month, your average over the last ${spending.months} complete ${spending.months === 1 ? 'month' : 'months'} of card and bank spending.`
      }>
      <View
        accessible
        accessibilityLabel={`Your emergency cash covers ${months(runway)} of spending; your target is ${months(target)}.`}
        style={styles.meter}>
        <View style={[styles.track, { backgroundColor: viz.track }]}>
          <View
            style={[styles.fill, { width: `${(runway / scale) * 100}%`, backgroundColor: short ? viz.warning : viz.good }]}
          />
        </View>
        <View style={[styles.marker, { left: `${(target / scale) * 100}%`, backgroundColor: theme.text }]} />
      </View>
      <View style={styles.legend}>
        <ThemedText type="smallBold">{months(runway)} covered</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Target {months(target)}
          {plan.totals.earmarked > 0 ? ` · ${formatWholeCurrency(plan.totals.earmarked)} set aside, not counted` : ''}
          {plan.totals.taxAdvantaged > 0 ? ` · ${formatWholeCurrency(plan.totals.taxAdvantaged)} in retirement accounts, not counted` : ''}
        </ThemedText>
      </View>
    </Card>
  );
}

const ICONS = { earn: 'sparkles', invest: 'chart', warning: 'info', info: 'info' } as const;
const ACCENTS = { earn: 'green', invest: 'blue', warning: 'orange', info: 'blue' } as const;

function Suggestions({ suggestions }: { suggestions: CashSuggestion[] }) {
  if (!suggestions.length) return null;
  return (
    <View style={styles.suggestions}>
      <ThemedText type="cardTitle">Ways to put your cash to work</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        General rules applied to your numbers. Rates change; check them before you move money.
      </ThemedText>
      {suggestions.map((s) => (
        <InsightCallout
          key={s.id}
          icon={ICONS[s.kind]}
          accent={ACCENTS[s.kind]}
          title={s.impact !== null && s.impact > 0 ? `${s.title} · about ${formatWholeCurrency(s.impact)} more a year` : s.title}
          body={s.detail}
          question={s.question}
          action="Ask"
        />
      ))}
    </View>
  );
}

const SOURCE_LABELS: Record<NonNullable<CashPosition['apySource']>, string> = {
  entered: 'rate you entered',
  interest: 'from recent interest',
  distributions: 'from distributions',
  assumed: 'assumed, about the Treasury rate',
};

function positionLabel(p: CashPosition) {
  if (p.kind === 'bank') return p.accountName;
  if (p.kind === 'sweep') return `Cash in ${p.accountName}`;
  return `${p.ticker ?? p.name ?? 'Fund'} in ${p.accountName}`;
}

function positionDetail(p: CashPosition) {
  return [
    p.institutionName,
    p.kind === 'bank' ? p.accountSubtype : p.kind === 'sweep' ? 'uninvested cash' : p.name,
    p.taxAdvantaged ? 'retirement account' : p.earmarked ? 'set aside' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Every cash position; in edit mode, its rate and whether it's set aside. */
function PositionsCard({ plan }: { plan: CashPlan }) {
  const theme = useTheme();
  const save = useSaveCashSettings();
  const [editing, setEditing] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(plan.settings.apyPercent).map(([k, v]) => [k, String(v)])),
  );
  const [earmarked, setEarmarked] = useState(() => new Set(plan.settings.earmarked));

  const parsed = Object.fromEntries(
    Object.entries(rates)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, Number(v.replace(/[%\s]/g, ''))]),
  );
  const invalid = (key: string) => key in parsed && !(Number.isFinite(parsed[key]) && parsed[key]! >= 0 && parsed[key]! <= 20);
  const valid = !Object.keys(parsed).some(invalid);

  function submit() {
    if (!valid) return;
    const settings: CashSettings = { ...plan.settings, apyPercent: parsed as Record<string, number>, earmarked: [...earmarked] };
    save.mutate(settings, { onSuccess: () => setEditing(false) });
  }

  return (
    <Card
      title="Where your cash is"
      subtitle={
        editing
          ? 'Enter a rate to replace Meld’s estimate, and set aside cash that’s meant for something else so it doesn’t count toward your emergency fund.'
          : 'Rates are estimated from recent interest and fund distributions. Edit to correct one.'
      }
      action={
        !editing && <Button label="Edit" variant="secondary" size="small" onPress={() => setEditing(true)} />
      }>
      <View>
        {plan.positions.map((p) => (
          <View key={p.key} style={[styles.position, { borderTopColor: theme.border }]}>
            <InstitutionAvatar name={p.institutionName} icon={p.kind === 'bank' ? 'bank' : 'chart'} />
            <View style={styles.grow}>
              <ThemedText numberOfLines={1}>{positionLabel(p)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {positionDetail(p)}
              </ThemedText>
            </View>
            {editing ? (
              <View style={styles.editRow}>
                {!p.taxAdvantaged && (
                  <Chip
                    label="Set aside"
                    selected={earmarked.has(p.key)}
                    onPress={() =>
                      setEarmarked((s) => {
                        const next = new Set(s);
                        if (!next.delete(p.key)) next.add(p.key);
                        return next;
                      })
                    }
                  />
                )}
                <Input
                  value={rates[p.key] ?? ''}
                  onChangeText={(v) => setRates((all) => ({ ...all, [p.key]: v }))}
                  placeholder={p.apy === null || p.apySource === 'entered' ? '% APY' : rate(p.apy)}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel={`Rate for ${positionLabel(p)}, percent`}
                  style={[styles.rateInput, invalid(p.key) && { borderColor: theme.negative }]}
                />
              </View>
            ) : (
              <View style={styles.rate}>
                <ThemedText type="smallBold" style={styles.num}>
                  {rate(p.apy)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.num} numberOfLines={1}>
                  {p.apySource ? SOURCE_LABELS[p.apySource] : 'rate unknown'}
                </ThemedText>
              </View>
            )}
            <ThemedText style={[styles.num, styles.value]}>{formatWholeCurrency(p.value)}</ThemedText>
          </View>
        ))}
      </View>
      {editing && (
        <>
          {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
          <View style={styles.buttons}>
            <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
          </View>
        </>
      )}
    </Card>
  );
}

const str = (v: number | null) => (v === null ? '' : String(v));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);
const TARGETS = [3, 6, 9, 12];

/** The emergency fund target, monthly spending and the rate to compare against. */
function SettingsCard({ plan }: { plan: CashPlan }) {
  const { settings, spending, benchmark } = plan;
  const save = useSaveCashSettings();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(str(settings.emergencyMonths));
  const [monthly, setMonthly] = useState(str(settings.monthlySpending));
  const [benchmarkText, setBenchmarkText] = useState(str(settings.benchmarkApyPercent));
  const [saved, setSaved] = useState(false);

  const values = { emergencyMonths: num(target), monthlySpending: num(monthly), benchmarkApyPercent: num(benchmarkText) };
  const bad = {
    emergencyMonths: values.emergencyMonths !== null && !(values.emergencyMonths >= 0 && values.emergencyMonths <= 60),
    monthlySpending: values.monthlySpending !== null && !(values.monthlySpending >= 0),
    benchmarkApyPercent: values.benchmarkApyPercent !== null && !(values.benchmarkApyPercent >= 0 && values.benchmarkApyPercent <= 20),
  };
  const valid = !Object.values(bad).some(Boolean);

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate({ ...settings, ...values }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card
      title="Emergency fund settings"
      subtitle={`A ${plan.emergency.targetMonths}-month target${spending.source === 'entered' ? ' and your monthly spending' : ''}. Three to six months is common; more if your income is irregular or you’re the only earner.`}
      action={<Button label={open ? 'Hide' : 'Edit'} variant="secondary" size="small" onPress={() => setOpen(!open)} />}>
      {open && (
        <>
          <Row>
            <Field label="Months of spending to keep" invalid={bad.emergencyMonths}>
              <View style={styles.targetRow}>
                {TARGETS.map((m) => (
                  <Chip
                    key={m}
                    label={String(m)}
                    selected={(values.emergencyMonths ?? DEFAULT_EMERGENCY_MONTHS) === m}
                    onPress={() => setTarget(String(m))}
                  />
                ))}
                <Input
                  value={target}
                  onChangeText={setTarget}
                  placeholder={String(DEFAULT_EMERGENCY_MONTHS)}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel="Months of spending to keep"
                  style={styles.rateInput}
                />
              </View>
            </Field>
            <Field label="Monthly spending" invalid={bad.monthlySpending}>
              <Input
                value={monthly}
                onChangeText={setMonthly}
                placeholder={spending.average !== null ? `${formatWholeCurrency(spending.average)} (your average)` : '$'}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </Field>
            <Field label="High-yield rate to compare against (%)" invalid={bad.benchmarkApyPercent}>
              <Input
                value={benchmarkText}
                onChangeText={setBenchmarkText}
                placeholder={benchmark.apy !== null && benchmark.source === 'treasury' ? `${rate(benchmark.apy)} (Treasury)` : '%'}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </Field>
          </Row>
          <ThemedText type="small" themeColor="textSecondary">
            Leave monthly spending blank to use your average. For a leaner emergency budget, enter only the essentials: housing, food,
            insurance, debt payments.
          </ThemedText>
          {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
          <View style={styles.buttons}>
            <Button label="Save" disabled={!valid} loading={save.isPending} onPress={submit} />
            {saved && (
              <ThemedText type="small" themeColor="textSecondary">
                Saved.
              </ThemedText>
            )}
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  meter: { height: 20, justifyContent: 'center' },
  track: { height: 12, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6, minWidth: 2 },
  marker: { position: 'absolute', top: 0, width: 2, height: 20, borderRadius: 1, marginLeft: -1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  suggestions: { gap: Spacing.two },
  position: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
  rate: { alignItems: 'flex-end', maxWidth: 200 },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  value: { minWidth: 96 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rateInput: { width: 96 },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
