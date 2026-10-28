import {
  projectRetirement,
  resolvePlan,
  RETIREMENT_DEFAULTS,
  RetirementPlan,
  retirementBalance,
  type RetirementAccount,
  type RetirementSummary,
  type TaxTreatment,
} from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RetirementProjection } from '@/components/charts/retirement-projection';
import { InsightCallout, StatTile, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { useRetirement, useSaveRetirementPlan } from '@/lib/queries';

const TAX_LABELS: Record<TaxTreatment, string | null> = {
  tax_deferred: 'Tax-deferred',
  tax_free: 'Tax-free',
  taxable: 'Taxable',
  unknown: null,
};

/** The fields typed in as text; the account list is saved separately. */
type NumberField = Exclude<keyof RetirementPlan, 'excludedAccountIds'>;
const FIELDS: NumberField[] = [
  'retirementAge',
  'lifeExpectancy',
  'annualContribution',
  'expectedReturn',
  'annualSpending',
  'socialSecurityAnnual',
  'socialSecurityAge',
  'pensionAnnual',
  'otherSavings',
];

const str = (v: number | null) => (v === null ? '' : String(v));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);

/** Projection, gap and assumptions for retirement, in today's dollars. */
export function RetirementTab({ onShowProfile }: { onShowProfile: () => void }) {
  const retirement = useRetirement();
  if (retirement.isPending) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
  if (retirement.isError) {
    return <ThemedText themeColor="negative">Couldn’t load your retirement plan: {retirement.error.message}</ThemedText>;
  }
  return <RetirementPlanner summary={retirement.data} onShowProfile={onShowProfile} />;
}

function RetirementPlanner({ summary, onShowProfile }: { summary: RetirementSummary; onShowProfile: () => void }) {
  const save = useSaveRetirementPlan();
  const [text, setText] = useState(() => Object.fromEntries(FIELDS.map((f) => [f, str(summary.plan[f])])) as Record<NumberField, string>);
  const [saved, setSaved] = useState(false);

  // Each field is checked against the shared schema, so the form and the API agree on limits.
  const values = Object.fromEntries(FIELDS.map((f) => [f, num(text[f])])) as Record<NumberField, number | null>;
  const invalid = Object.fromEntries(
    FIELDS.map((f) => [f, !RetirementPlan.shape[f].safeParse(values[f]).success]),
  ) as Record<NumberField, boolean>;
  const valid = !Object.values(invalid).some(Boolean);

  // Live: the tiles and chart follow what's typed, falling back to the saved plan for anything invalid.
  const draft: RetirementPlan = {
    ...summary.plan,
    ...Object.fromEntries(FIELDS.map((f) => [f, invalid[f] ? summary.plan[f] : values[f]])),
  };
  const resolved = resolvePlan(draft, summary);
  const projection = resolved.inputs && projectRetirement(resolved.inputs);
  const dirty = FIELDS.some((f) => values[f] !== summary.plan[f]);

  function set(field: NumberField) {
    return (value: string) => {
      setSaved(false);
      setText((t) => ({ ...t, [field]: value }));
    };
  }

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate({ ...summary.plan, ...values }, { onSuccess: () => setSaved(true) });
  }

  function toggleAccount(account: RetirementAccount, include: boolean) {
    const others = summary.plan.excludedAccountIds.filter((id) => id !== account.id);
    save.mutate({ ...summary.plan, excludedAccountIds: include ? others : [...others, account.id] });
  }

  const d = summary.defaults;
  const income = d.annualIncome;

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Everything is in today’s dollars: returns are after inflation, so a dollar here buys what a dollar buys now.
      </ThemedText>

      {resolved.inputs && projection ? (
        <>
          <Summary inputs={resolved.inputs} projection={projection} />
          <Card
            title="Projected savings"
            subtitle={`Growing ${resolved.inputs.expectedReturn}% a year after inflation, then drawn down from age ${resolved.inputs.retirementAge}`}>
            <RetirementProjection points={projection.points} retirementAge={resolved.inputs.retirementAge} />
          </Card>
          <InsightCallout
            body={
              projection.gap > 0
                ? 'Ask Meld for ways to close the gap: contributions, account types, timing and Social Security.'
                : 'Ask Meld what could put this plan at risk, and how to make the most of the cushion.'
            }
            question={
              projection.gap > 0
                ? 'Look at my retirement plan. What are the most effective ways to close my retirement gap?'
                : 'Look at my retirement plan. Am I really on track, and what could put it at risk?'
            }
            action="Ask Meld"
          />
        </>
      ) : (
        <Card title="A couple of things first">
          {resolved.missing.includes('birth year') && (
            <View style={styles.missing}>
              <ThemedText type="small" themeColor="textSecondary">
                Add your birth year to your profile so Meld knows how many years you have to save.
              </ThemedText>
              <Button label="Add birth year" variant="secondary" size="small" onPress={onShowProfile} />
            </View>
          )}
          {resolved.missing.includes('retirement spending') && (
            <ThemedText type="small" themeColor="textSecondary">
              Enter what you expect to spend each year in retirement below. Once you have a year of transactions, Meld
              suggests your current spending.
            </ThemedText>
          )}
        </Card>
      )}

      <Card title="Assumptions" subtitle="Leave a field empty to use the suggestion shown">
        <Row>
          <Field label="Retire at age" invalid={invalid.retirementAge}>
            <Input value={text.retirementAge} onChangeText={set('retirementAge')} placeholder={String(RETIREMENT_DEFAULTS.retirementAge)} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
          </Field>
          <Field label="Plan to age" invalid={invalid.lifeExpectancy}>
            <Input value={text.lifeExpectancy} onChangeText={set('lifeExpectancy')} placeholder={String(RETIREMENT_DEFAULTS.lifeExpectancy)} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
          </Field>
          <Field label="Return after inflation, %" invalid={invalid.expectedReturn}>
            <Input value={text.expectedReturn} onChangeText={set('expectedReturn')} placeholder={String(RETIREMENT_DEFAULTS.expectedReturn)} keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
        </Row>
        <Row>
          <Field label="Saving per year, with employer match" invalid={invalid.annualContribution}>
            <Input
              value={text.annualContribution}
              onChangeText={set('annualContribution')}
              placeholder={income ? `$0 · 15% of income is ${formatWholeCurrency(income * 0.15)}` : '$0'}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </Field>
          <Field label="Spending per year in retirement" invalid={invalid.annualSpending}>
            <Input
              value={text.annualSpending}
              onChangeText={set('annualSpending')}
              placeholder={d.annualSpending !== null ? `${formatWholeCurrency(d.annualSpending)} · last 12 months` : '$'}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Social Security per year" invalid={invalid.socialSecurityAnnual}>
            <Input value={text.socialSecurityAnnual} onChangeText={set('socialSecurityAnnual')} placeholder="$0 · estimate at ssa.gov" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
          <Field label="Starting at age" invalid={invalid.socialSecurityAge}>
            <Input value={text.socialSecurityAge} onChangeText={set('socialSecurityAge')} placeholder={String(RETIREMENT_DEFAULTS.socialSecurityAge)} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
          </Field>
          <Field label="Pension per year" invalid={invalid.pensionAnnual}>
            <Input value={text.pensionAnnual} onChangeText={set('pensionAnnual')} placeholder="$0" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
        </Row>
        <Field label="Other savings for retirement (outside investment accounts)" invalid={invalid.otherSavings}>
          <Input value={text.otherSavings} onChangeText={set('otherSavings')} placeholder="$0 · e.g. cash set aside" keyboardType="decimal-pad" inputMode="decimal" />
        </Field>
        {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
        <View style={styles.buttons}>
          <Button label="Save assumptions" disabled={!valid || !dirty} loading={save.isPending} onPress={submit} />
          {saved && !dirty && (
            <ThemedText type="small" themeColor="textSecondary">
              Saved.
            </ThemedText>
          )}
        </View>
      </Card>

      <Accounts summary={summary} otherSavings={draft.otherSavings} onToggle={toggleAccount} disabled={save.isPending} />
    </>
  );
}

function Summary({
  inputs,
  projection: p,
}: {
  inputs: NonNullable<ReturnType<typeof resolvePlan>['inputs']>;
  projection: ReturnType<typeof projectRetirement>;
}) {
  const retired = inputs.retirementAge <= inputs.currentAge;
  return (
    <TileRow>
      <StatTile
        label={retired ? 'Saved today' : `Projected at ${inputs.retirementAge}`}
        value={p.atRetirement}
        caption={retired ? 'Counted toward retirement' : `From ${formatWholeCurrency(inputs.startingBalance)} today`}
      />
      <StatTile label={`Needed at ${inputs.retirementAge}`} value={p.needed} caption={`To last to age ${inputs.lifeExpectancy}`} />
      {p.gap <= 0 ? (
        <StatTile
          label="Status"
          value="On track"
          caption={`${formatWholeCurrency(-p.gap)} to spare · lasts past ${inputs.lifeExpectancy}`}
        />
      ) : (
        <StatTile
          label="Status"
          value={`Short ${formatCompactCurrency(p.gap)}`}
          caption={[
            p.depletionAge !== null && `Runs out at ${p.depletionAge}`,
            p.extraMonthly !== null ? `save ${formatWholeCurrency(p.extraMonthly)}/mo more to close it` : 'spend less or work longer',
          ]
            .filter(Boolean)
            .join(' · ')
            .replace(/^./, (c) => c.toUpperCase())}
        />
      )}
    </TileRow>
  );
}

function Accounts({
  summary,
  otherSavings,
  onToggle,
  disabled,
}: {
  summary: RetirementSummary;
  otherSavings: number | null;
  onToggle: (account: RetirementAccount, include: boolean) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const total = retirementBalance(summary, { otherSavings });
  return (
    <Card title="Counted toward retirement" subtitle="Your share of each investment account. Turn off any you’re saving for something else.">
      {summary.accounts.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No investment accounts yet. Link your 401(k), IRA or brokerage on the Accounts tab.
        </ThemedText>
      )}
      {summary.accounts.map((a) => (
        <View key={a.id} style={styles.row}>
          <View style={styles.shrink}>
            <ThemedText numberOfLines={1} themeColor={a.included ? 'text' : 'textSecondary'}>
              {a.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {[a.institutionName, a.excludedReason === 'education' ? 'Education account, not counted' : TAX_LABELS[a.taxTreatment]]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>
          <ThemedText themeColor={a.included ? 'text' : 'textSecondary'}>{formatWholeCurrency(a.value)}</ThemedText>
          {a.excludedReason !== 'education' && (
            <Switch
              value={a.included}
              disabled={disabled}
              onValueChange={(include) => onToggle(a, include)}
              accessibilityLabel={`Count ${a.name} toward retirement`}
            />
          )}
        </View>
      ))}
      {!!otherSavings && (
        <View style={styles.row}>
          <ThemedText style={styles.shrink}>Other savings</ThemedText>
          <ThemedText>{formatWholeCurrency(otherSavings)}</ThemedText>
        </View>
      )}
      <View style={[styles.row, styles.total, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" style={styles.shrink}>
          Total counted
        </ThemedText>
        <ThemedText type="smallBold">{formatWholeCurrency(total)}</ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  missing: { gap: Spacing.two, alignItems: 'flex-start' },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flex: 1, flexShrink: 1 },
  total: { paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
