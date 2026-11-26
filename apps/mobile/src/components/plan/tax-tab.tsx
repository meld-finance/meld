import { EMPTY_TAX_SETTINGS, type FederalTax, type HarvestCandidate, type TaxPlan, type TaxSettings, type TaxSuggestion } from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { Chip } from '@/components/chip';
import { InsightCallout, StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { showsChecklist, TaxChecklist } from '@/components/plan/tax-checklist';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatDate, formatWholeCurrency } from '@/lib/format';
import { useSaveTaxSettings, useTaxPlan } from '@/lib/queries';

const thisYear = new Date().getFullYear();
const YEARS = [
  { value: String(thisYear - 1), label: String(thisYear - 1) },
  { value: String(thisYear), label: String(thisYear) },
];

const percent = (n: number | null) => (n === null ? '—' : `${(Math.round(n * 1000) / 10).toLocaleString('en-US')}%`);
const signed = (n: number) => `${n < 0 ? '−' : ''}${formatWholeCurrency(Math.abs(n))}`;

/** An estimate of the year's income tax, and moves that would lower it. */
export function TaxTab({ onShowProfile }: { onShowProfile: () => void }) {
  const [year, setYear] = useState(String(thisYear));
  const plan = useTaxPlan(Number(year));
  return (
    <>
      <TabHeading
        title="Taxes"
        subtitle="An estimate of the year’s federal and state income tax from your profile, synced accounts and the inputs below. An estimate, not tax advice."
        actions={<Segmented size="small" options={YEARS} value={year} onChange={setYear} />}
      />
      {plan.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : plan.isError ? (
        <ThemedText themeColor="negative">Couldn’t load your tax estimate: {plan.error.message}</ThemedText>
      ) : (
        <TaxPlanView key={plan.data.year} plan={plan.data} onShowProfile={onShowProfile} />
      )}
    </>
  );
}

function TaxPlanView({ plan, onShowProfile }: { plan: TaxPlan; onShowProfile: () => void }) {
  const { federal, state } = plan;
  return (
    <>
      {plan.missing.length > 0 && showsChecklist(plan) && <TaxChecklist plan={plan} onShowProfile={onShowProfile} />}

      {plan.missing.length > 0 && !showsChecklist(plan) && (
        <Card title="A couple of details first" subtitle="The estimate needs your filing status and household gross income from your profile.">
          <View style={styles.buttons}>
            <Button label="Open profile" size="small" onPress={onShowProfile} />
          </View>
        </Card>
      )}

      {federal && plan.totalTax !== null && (
        <>
          <TileRow>
            <StatTile
              label={`Estimated ${plan.year} tax`}
              value={plan.totalTax}
              caption={`Federal ${formatWholeCurrency(federal.total)}${state ? ` · ${state.state} ${formatWholeCurrency(state.total)}` : ''}`}
            />
            <StatTile label="Effective rate" value={percent(plan.effectiveRate)} caption="Total tax over gross income" />
            <StatTile
              label="Marginal rate"
              value={percent(plan.marginalRate)}
              caption={`${percent(federal.bracketRate)} federal bracket${state && state.method !== 'none' ? ` · ${percent(state.bracketRate)} ${state.state}` : ''}`}
            />
            <StatTile
              label={plan.balanceDue === null ? 'At filing' : plan.balanceDue > 0 ? 'Projected to owe' : 'Projected refund'}
              value={plan.balanceDue === null ? '—' : formatWholeCurrency(Math.abs(plan.balanceDue))}
              caption={plan.balanceDue === null ? 'Enter withholding below to see' : 'After withholding at this pace'}
            />
          </TileRow>

          <TaxChecklist plan={plan} onShowProfile={onShowProfile} />

          <Suggestions suggestions={plan.suggestions} />

          <View style={styles.columns}>
            <IncomeCard plan={plan} style={styles.half} />
            <TaxCard plan={plan} style={styles.half} />
          </View>

          <BracketLadder federal={federal} year={plan.federalTablesYear ?? plan.year} />
        </>
      )}

      {plan.harvest.length > 0 && <HarvestCard candidates={plan.harvest} />}

      <TaxInputs plan={plan} />

      {plan.notes.length > 0 && (
        <View style={styles.notes}>
          {plan.notes.map((n) => (
            <ThemedText key={n} type="small" themeColor="textSecondary">
              {n}
            </ThemedText>
          ))}
        </View>
      )}
    </>
  );
}

const ICONS = { warning: 'info', save: 'sparkles', info: 'info' } as const;
const ACCENTS = { warning: 'orange', save: 'green', info: 'blue' } as const;

function Suggestions({ suggestions }: { suggestions: TaxSuggestion[] }) {
  if (!suggestions.length) return null;
  return (
    <View style={styles.suggestions}>
      <ThemedText type="cardTitle">Ways to lower your tax</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        General rules applied to your numbers, not tax advice. Check with a tax professional before acting on one.
      </ThemedText>
      {suggestions.map((s) => (
        <InsightCallout
          key={s.id}
          icon={ICONS[s.kind]}
          accent={ACCENTS[s.kind]}
          title={s.impact !== null && s.impact > 0 ? `${s.title} · saves about ${formatWholeCurrency(s.impact)}` : s.title}
          body={s.detail}
          question={s.question}
          action="Ask"
        />
      ))}
    </View>
  );
}

function IncomeCard({ plan, style }: { plan: TaxPlan; style?: object }) {
  const income = plan.income!;
  const d = plan.detected;
  const projected = plan.elapsed < 1;
  const rows: [string, number, string?][] = [
    [
      'Wages',
      income.wages,
      plan.settings.profileIncludesRsus && income.rsuVesting > 0
        ? `Cash pay (Profile gross less RSU vests and ${formatWholeCurrency(income.pretax401k)} pre-tax 401(k))`
        : `Gross income from your profile, less ${formatWholeCurrency(income.pretax401k)} pre-tax 401(k)`,
    ],
    [
      'RSU vesting',
      income.rsuVesting,
      `${formatWholeCurrency(d.rsuVestedYtd)} vested so far, ${formatWholeCurrency(d.rsuScheduledRemaining)} scheduled`,
    ],
    ['Self-employment', income.selfEmployment],
    ['Interest', income.interest, `${formatWholeCurrency(d.interest)} so far`],
    ['Qualified dividends', income.qualifiedDividends, `${formatWholeCurrency(d.qualifiedDividends)} so far, taxable accounts`],
    ['Ordinary dividends', income.ordinaryDividends, `${formatWholeCurrency(d.ordinaryDividends)} so far`],
    [
      'Short-term gains',
      income.shortTermGains,
      plan.settings.realizedGainsOverride ? 'From your broker' : `${signed(d.realizedShortTerm)} realized`,
    ],
    [
      'Long-term gains',
      income.longTermGains,
      plan.settings.realizedGainsOverride
        ? 'From your broker, plus fund distributions'
        : `${signed(d.realizedLongTerm)} realized, ${formatWholeCurrency(d.capitalGainDistributions)} fund distributions`,
    ],
    ['Other income', income.other],
    ['HSA (deducted)', -income.hsa],
  ];
  return (
    <Card title={`Income for ${plan.year}`} subtitle={projected ? `Projected for the full year from what’s in through ${formatDate(plan.asOf)}` : undefined} style={style}>
      <View>
        {rows
          .filter(([, amount]) => amount !== 0)
          .map(([label, amount, note]) => (
            <Line key={label} label={label} value={signed(amount)} note={note} />
          ))}
        <Line label="Federal AGI" value={formatWholeCurrency(plan.federal!.agi)} strong />
      </View>
      {(d.paychecks > 0 || d.contractorDeposits > 0) && (
        <ThemedText type="small" themeColor="textSecondary">
          For comparison, deposits so far this year: {formatWholeCurrency(d.paychecks)} of paychecks
          {d.contractorDeposits > 0 ? ` and ${formatWholeCurrency(d.contractorDeposits)} of contractor payments` : ''}, after
          withholding and deductions.
        </ThemedText>
      )}
    </Card>
  );
}

function TaxCard({ plan, style }: { plan: TaxPlan; style?: object }) {
  const f = plan.federal!;
  const s = plan.state;
  const parts: [string, number][] = [
    ['Ordinary income tax', f.ordinaryTax],
    ['Capital gains and qualified dividends', f.capitalGainsTax],
    ['Net investment income tax', f.netInvestmentIncomeTax],
    ['Additional Medicare tax', f.additionalMedicareTax],
    ['Self-employment tax', f.selfEmploymentTax],
    ['Child tax credit', -f.childTaxCredit],
  ];
  return (
    <Card title="How it adds up" subtitle={plan.federalTablesYear ? `Using ${plan.federalTablesYear} federal tables` : undefined} style={style}>
      <View>
        <Line label={f.itemized ? 'Itemized deductions' : 'Standard deduction'} value={signed(-f.deduction)} />
        <Line label="Taxable income" value={formatWholeCurrency(f.taxableIncome)} strong />
        {parts
          .filter(([, amount]) => amount !== 0)
          .map(([label, amount]) => (
            <Line key={label} label={label} value={signed(amount)} />
          ))}
        <Line label="Federal tax" value={formatWholeCurrency(f.total)} strong />
        {s && (
          <>
            <Line
              label={`${s.state} tax`}
              value={formatWholeCurrency(s.total)}
              note={
                s.method === 'none'
                  ? 'No state income tax'
                  : s.method === 'flat'
                    ? `Your ${percent(s.bracketRate)} rate on federal AGI`
                    : `On ${formatWholeCurrency(s.taxableIncome)} taxable${s.tablesYear ? `, ${s.tablesYear} brackets` : ''}`
              }
              strong
            />
          </>
        )}
        <Line label="Total" value={formatWholeCurrency(plan.totalTax)} strong />
      </View>
    </Card>
  );
}

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.line, { borderTopColor: theme.border }]}>
      <View style={styles.lineLabel}>
        <ThemedText type={strong ? 'smallBold' : 'small'}>{label}</ThemedText>
        {note && (
          <ThemedText type="small" themeColor="textSecondary">
            {note}
          </ThemedText>
        )}
      </View>
      <ThemedText type={strong ? 'smallBold' : 'small'} style={styles.num}>
        {value}
      </ThemedText>
    </View>
  );
}

/** Each federal bracket, filled as far as your ordinary income reaches. */
function BracketLadder({ federal, year }: { federal: FederalTax; year: number }) {
  const viz = useVizColors();
  const theme = useTheme();
  const shown = federal.brackets.filter((b, i) => b.taxed > 0 || federal.brackets[i - 1]?.taxed);
  return (
    <Card
      title="Where your income lands"
      subtitle={`${year} federal brackets for ordinary income. Long-term gains and qualified dividends stack on top at 0/15/20%.`}>
      <View style={styles.ladder}>
        {shown.map((b) => {
          const width = b.upTo === null ? null : b.upTo - b.from;
          const fill = width === null ? (b.taxed > 0 ? 1 : 0) : b.taxed / width;
          const current = b.rate === federal.bracketRate;
          const range = b.upTo === null ? `over ${formatWholeCurrency(b.from)}` : `${formatWholeCurrency(b.from)}–${formatWholeCurrency(b.upTo)}`;
          return (
            <View
              key={b.rate}
              style={styles.rung}
              accessible
              accessibilityLabel={`${percent(b.rate)} bracket, ${range}: ${formatWholeCurrency(b.taxed)} of your income`}>
              <ThemedText type={current ? 'smallBold' : 'small'} style={styles.rate}>
                {percent(b.rate)}
              </ThemedText>
              <View style={[styles.track, { backgroundColor: viz.track }]}>
                <View style={[styles.fill, { width: `${Math.min(1, fill) * 100}%`, backgroundColor: viz.series1 }]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.range} numberOfLines={1}>
                {range}
              </ThemedText>
              <ThemedText type={current ? 'smallBold' : 'small'} style={styles.num}>
                {formatWholeCurrency(b.taxed)}
              </ThemedText>
            </View>
          );
        })}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={{ borderTopColor: theme.border }}>
        {federal.bracketRoom === null
          ? 'You’re in the top bracket.'
          : `${formatWholeCurrency(federal.bracketRoom)} more ordinary income stays in the ${percent(federal.bracketRate)} bracket.`}
        {federal.zeroRateGainRoom > 0 ? ` Up to ${formatWholeCurrency(federal.zeroRateGainRoom)} of long-term gains would be taxed at 0%.` : ''}
      </ThemedText>
    </Card>
  );
}

function HarvestCard({ candidates }: { candidates: HarvestCandidate[] }) {
  const total = candidates.reduce((s, c) => s + c.gain, 0);
  return (
    <Card
      title="Holdings with losses"
      subtitle={`${formatWholeCurrency(-total)} of unrealized losses in taxable accounts. Purchases in the last 30 days, in any account, would make a sale a wash sale.`}>
      <View>
        {candidates.slice(0, 12).map((c) => (
          <Line
            key={`${c.accountName}|${c.ticker ?? c.name}`}
            label={`${c.ticker ?? c.name ?? 'Unknown'} · ${c.accountName}`}
            value={signed(c.gain)}
            note={[
              `${formatWholeCurrency(c.value)} now, ${formatWholeCurrency(c.costBasis)} cost`,
              c.shortTermShare > 0 ? `${percent(c.shortTermShare)} short-term` : 'long-term',
              c.recentPurchase ? `bought ${formatDate(c.recentPurchase)}: wash-sale risk` : null,
              c.recentVest ? `RSU vested ${formatDate(c.recentVest)}: wash-sale risk` : null,
              c.upcomingVest ? `RSU vests ${formatDate(c.upcomingVest)}: wash-sale risk` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </View>
    </Card>
  );
}

// --- Inputs ------------------------------------------------------------------------

type MoneyField = Exclude<keyof TaxSettings, 'hsaCoverage' | 'coveredByWorkplacePlan' | 'realizedGainsOverride' | 'profileIncludesRsus'>;

const MONEY_FIELDS: { key: MoneyField; label: string; group: 'income' | 'paid' | 'deductions' }[] = [
  { key: 'selfEmploymentIncome', label: 'Self-employment profit (part of gross income)', group: 'income' },
  { key: 'otherIncome', label: 'Other taxable income (IRA withdrawals, conversions, rent)', group: 'income' },
  { key: 'pretax401k', label: 'Pre-tax 401(k), full year', group: 'income' },
  { key: 'hsaContributions', label: 'HSA contributions, full year', group: 'income' },
  { key: 'federalWithheld', label: 'Federal withheld so far', group: 'paid' },
  { key: 'stateWithheld', label: 'State withheld so far', group: 'paid' },
  { key: 'federalEstimatedPayments', label: 'Federal estimated payments', group: 'paid' },
  { key: 'stateEstimatedPayments', label: 'State estimated payments', group: 'paid' },
  { key: 'propertyTax', label: 'Property tax', group: 'deductions' },
  { key: 'otherItemized', label: 'Mortgage interest, charity, other itemized', group: 'deductions' },
  { key: 'stateFlatRate', label: 'State tax rate (%)', group: 'deductions' },
];

const str = (v: number | null) => (v === null ? '' : String(v));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '').replace('−', '-')) : null);

function TaxInputs({ plan }: { plan: TaxPlan }) {
  const initial = plan.settings;
  const empty = JSON.stringify(initial) === JSON.stringify(EMPTY_TAX_SETTINGS);
  const [open, setOpen] = useState(empty);
  const save = useSaveTaxSettings(plan.year);
  const [text, setText] = useState(() => Object.fromEntries(MONEY_FIELDS.map((f) => [f.key, str(initial[f.key])])) as Record<MoneyField, string>);
  const [hsaCoverage, setHsaCoverage] = useState(initial.hsaCoverage);
  const [covered, setCovered] = useState(initial.coveredByWorkplacePlan);
  const [profileIncludesRsus, setProfileIncludesRsus] = useState(initial.profileIncludesRsus);
  const [shortTerm, setShortTerm] = useState(str(initial.realizedGainsOverride?.shortTerm ?? null));
  const [longTerm, setLongTerm] = useState(str(initial.realizedGainsOverride?.longTerm ?? null));
  const [saved, setSaved] = useState(false);

  const values = Object.fromEntries(MONEY_FIELDS.map((f) => [f.key, num(text[f.key])])) as Record<MoneyField, number | null>;
  const invalid = Object.fromEntries(
    MONEY_FIELDS.map((f) => {
      const v = values[f.key];
      return [f.key, v !== null && !(Number.isFinite(v) && v >= 0 && (f.key !== 'stateFlatRate' || v <= 20))];
    }),
  ) as Record<MoneyField, boolean>;
  const gains = { shortTerm: num(shortTerm), longTerm: num(longTerm) };
  const invalidGains = [gains.shortTerm, gains.longTerm].some((g) => g !== null && !Number.isFinite(g));
  const valid = !Object.values(invalid).some(Boolean) && !invalidGains;

  // Hints show what Meld will use when a field is left blank.
  const d = plan.detected;
  const placeholders: Partial<Record<MoneyField, string>> = {
    pretax401k: plan.income ? `${formatWholeCurrency(plan.income.pretax401k)} (projected)` : undefined,
    hsaContributions: d.hsaContributions ? `${formatWholeCurrency(d.hsaContributions)} (so far)` : undefined,
  };
  const showStateRate = !!plan.state && plan.state.method === 'flat' ? true : !plan.state;

  function submit() {
    if (!valid) return;
    setSaved(false);
    const settings: TaxSettings = {
      ...values,
      hsaCoverage,
      coveredByWorkplacePlan: covered,
      realizedGainsOverride:
        gains.shortTerm === null && gains.longTerm === null ? null : { shortTerm: gains.shortTerm ?? 0, longTerm: gains.longTerm ?? 0 },
      profileIncludesRsus,
    };
    save.mutate(settings, { onSuccess: () => setSaved(true) });
  }

  const fields = (group: 'income' | 'paid' | 'deductions') => (
    <Row>
      {MONEY_FIELDS.filter((f) => f.group === group && (f.key !== 'stateFlatRate' || showStateRate)).map((f) => (
        <Field key={f.key} label={f.label} invalid={invalid[f.key]}>
          <Input
            value={text[f.key]}
            onChangeText={(v) => setText((all) => ({ ...all, [f.key]: v }))}
            placeholder={placeholders[f.key] ?? (f.key === 'stateFlatRate' ? '%' : '$')}
            keyboardType="decimal-pad"
            inputMode="decimal"
          />
        </Field>
      ))}
    </Row>
  );

  return (
    <Card
      title={`Tax inputs for ${plan.year}`}
      subtitle="What Meld can’t see in your accounts. All optional; blanks use what Meld detected, or nothing."
      action={<Button label={open ? 'Hide' : 'Edit'} variant="secondary" size="small" onPress={() => setOpen(!open)} />}>
      {open && (
        <>
          <ThemedText type="smallBold">Income and pre-tax savings</ThemedText>
          {fields('income')}
          <Row>
            <Field label="HSA coverage">
              <View style={styles.chips}>
                <Chip label="Self-only" selected={hsaCoverage === 'self'} onPress={() => setHsaCoverage(hsaCoverage === 'self' ? null : 'self')} />
                <Chip label="Family" selected={hsaCoverage === 'family'} onPress={() => setHsaCoverage(hsaCoverage === 'family' ? null : 'family')} />
              </View>
            </Field>
            <Field label="Workplace retirement plan">
              <View style={styles.chips}>
                <Chip label="Covered" selected={covered === true} onPress={() => setCovered(covered === true ? null : true)} />
                <Chip label="Not covered" selected={covered === false} onPress={() => setCovered(covered === false ? null : false)} />
              </View>
            </Field>
            {d.rsuVestedYtd + d.rsuScheduledRemaining > 0 && (
              <Field label="Profile gross income">
                <View style={styles.chips}>
                  <Chip label="Cash only (add RSUs)" selected={!profileIncludesRsus} onPress={() => setProfileIncludesRsus(false)} />
                  <Chip label="Already includes RSUs" selected={profileIncludesRsus} onPress={() => setProfileIncludesRsus(true)} />
                </View>
              </Field>
            )}
          </Row>
          <ThemedText type="smallBold">Paid so far</ThemedText>
          {fields('paid')}
          <ThemedText type="smallBold">Deductions</ThemedText>
          {fields('deductions')}
          <ThemedText type="smallBold">Realized gains from your broker</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Replaces Meld’s estimate of {signed(d.realizedShortTerm)} short-term and {signed(d.realizedLongTerm)} long-term. Losses are negative.
          </ThemedText>
          <Row>
            <Field label="Short-term" invalid={gains.shortTerm !== null && !Number.isFinite(gains.shortTerm)}>
              <Input value={shortTerm} onChangeText={setShortTerm} placeholder="$" keyboardType="numbers-and-punctuation" inputMode="decimal" />
            </Field>
            <Field label="Long-term" invalid={gains.longTerm !== null && !Number.isFinite(gains.longTerm)}>
              <Input value={longTerm} onChangeText={setLongTerm} placeholder="$" keyboardType="numbers-and-punctuation" inputMode="decimal" />
            </Field>
          </Row>
          {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
          <View style={styles.buttons}>
            <Button label="Save and update estimate" disabled={!valid} loading={save.isPending} onPress={submit} />
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
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  half: { flexGrow: 1, flexShrink: 1, flexBasis: 420, maxWidth: '100%', minWidth: 0 },
  suggestions: { gap: Spacing.two },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineLabel: { flex: 1, minWidth: 0, gap: Spacing.half },
  num: { minWidth: 84, textAlign: 'right', fontVariant: ['tabular-nums'] },
  ladder: { gap: Spacing.two },
  rung: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rate: { width: 44 },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  range: { width: 150, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  notes: { gap: Spacing.one },
});
