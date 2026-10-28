import {
  childName,
  claimingFactor,
  formatFullRetirementAge,
  fullRetirementAgeMonths,
  mortgagePayoffAge,
  projectRetirement,
  PropertySale,
  resolvePlan,
  remainingLoanBalance,
  RETIREMENT_DEFAULTS,
  RetirementPlan,
  retirementBalance,
  saleProceeds,
  socialSecurityAtFullAge,
  SPENDING_DECLINE_AGE,
  SpendingChange,
  spendingAt,
  type RetirementAccount,
  type RetirementInputs,
  type RetirementProjection as Projection,
  type RetirementSummary,
  type TaxTreatment,
} from '@meld/shared';
import { useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { RetirementProjection } from '@/components/charts/retirement-projection';
import { Dropdown } from '@/components/dropdown';
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

/** The plan's numbers, typed in as text; accounts, properties and spending changes have their own controls. */
type NumberField = Exclude<keyof RetirementPlan, 'excludedAccountIds' | 'properties' | 'spendingChanges'>;
const FIELDS: NumberField[] = [
  'retirementAge',
  'lifeExpectancy',
  'annualContribution',
  'expectedReturn',
  'annualSpending',
  'spendingDeclinePercent',
  'socialSecurityAnnual',
  'socialSecurityAge',
  'pensionAnnual',
  'otherSavings',
  'propertyAppreciation',
  'sellingCostPercent',
];

/** One property's controls, as typed. */
type PropertyDraft = { on: boolean; sellAge: string; mortgageAccountId: string | null; rent: string };

/** One spending change, as typed; `key` keeps rows stable while editing, and `amount` is per month when `monthly`. */
type ChangeDraft = {
  key: number;
  label: string;
  childId: string | null;
  startAge: string;
  endAge: string;
  amount: string;
  monthly: boolean;
};

const MORTGAGE_LABEL = 'Mortgage paid off';
/** The age kids are assumed to leave home; the user changes it per child. */
const LEAVE_HOME_AGE = 18;

/** A one-tap set of spending changes; ages and amounts may be left for the user. */
type Suggestion = { id: string; caption: string; changes: Partial<SpendingChange>[] };

/** Dropdown value for "no mortgage". */
const NO_MORTGAGE = 'none';

/** Order-independent form for comparing drafts with the saved plan (jsonb doesn't keep key order). */
const sameSales = (a: PropertySale[], b: PropertySale[]) => {
  const key = (list: PropertySale[]) =>
    JSON.stringify(
      [...list]
        .sort((x, y) => x.assetId.localeCompare(y.assetId))
        .map((s) => [s.assetId, s.sellAge, s.mortgageAccountId, s.netRentAnnual]),
    );
  return key(a) === key(b);
};

const sameChanges = (a: SpendingChange[], b: SpendingChange[]) => {
  const key = (list: SpendingChange[]) =>
    JSON.stringify(list.map((c) => [c.label, c.childId, c.startAge, c.endAge, c.annualChange, c.monthly]));
  return key(a) === key(b);
};

let nextChangeKey = 0;
const changeDraft = (c: Partial<SpendingChange>): ChangeDraft => ({
  key: nextChangeKey++,
  label: c.label ?? '',
  childId: c.childId ?? null,
  startAge: str(c.startAge ?? null),
  endAge: str(c.endAge ?? null),
  amount: str(c.annualChange === undefined ? null : c.monthly ? Math.round((c.annualChange / 12) * 100) / 100 : c.annualChange),
  monthly: c.monthly ?? false,
});

const str = (v: number | null) => (v === null ? '' : String(v));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);

/** Social Security is typed per month, as the SSA statement shows it, and saved per year. */
const MONTHLY = new Set<NumberField>(['socialSecurityAnnual']);
const toText = (f: NumberField, v: number | null) => (v !== null && MONTHLY.has(f) ? str(Math.round((v / 12) * 100) / 100) : str(v));

const SSA_ACCOUNT_URL = 'https://www.ssa.gov/myaccount/';

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
  const [text, setText] = useState(() => Object.fromEntries(FIELDS.map((f) => [f, toText(f, summary.plan[f])])) as Record<NumberField, string>);
  const [properties, setProperties] = useState<Record<string, PropertyDraft>>(() =>
    Object.fromEntries(
      summary.properties.map((p) => {
        const saved = summary.plan.properties.find((s) => s.assetId === p.id);
        return [
          p.id,
          {
            on: !!saved,
            sellAge: str(saved?.sellAge ?? null),
            mortgageAccountId: saved?.mortgageAccountId ?? null,
            rent: str(saved?.netRentAnnual ?? null),
          },
        ];
      }),
    ),
  );
  const [changes, setChanges] = useState<ChangeDraft[]>(() => summary.plan.spendingChanges.map(changeDraft));
  const [saved, setSaved] = useState(false);

  // Each field is checked against the shared schema, so the form and the API agree on limits.
  const values = Object.fromEntries(
    FIELDS.map((f) => {
      const typed = num(text[f]);
      if (typed === null || !MONTHLY.has(f)) return [f, typed];
      // An untouched monthly figure keeps the saved yearly one, so rounding to cents doesn't count as a change.
      return [f, text[f] === toText(f, summary.plan[f]) ? summary.plan[f] : typed * 12];
    }),
  ) as Record<NumberField, number | null>;
  const invalid = Object.fromEntries(
    FIELDS.map((f) => [f, !RetirementPlan.shape[f].safeParse(values[f]).success]),
  ) as Record<NumberField, boolean>;

  const draftProperties = summary.properties.flatMap((p): PropertySale[] => {
    const d = properties[p.id];
    if (!d?.on) return [];
    return [{ assetId: p.id, sellAge: num(d.sellAge) ?? NaN, mortgageAccountId: d.mortgageAccountId, netRentAnnual: num(d.rent) }];
  });
  const invalidProperty = (id: string) => {
    const sale = draftProperties.find((s) => s.assetId === id);
    return {
      sellAge: !!sale && !PropertySale.shape.sellAge.safeParse(sale.sellAge).success,
      rent: !!sale && !PropertySale.shape.netRentAnnual.safeParse(sale.netRentAnnual).success,
    };
  };
  const validProperties = draftProperties.filter((s) => {
    const bad = invalidProperty(s.assetId);
    return !bad.sellAge && !bad.rent;
  });
  const draftChanges = changes.map((c) => ({
    label: c.label.trim(),
    childId: c.childId,
    startAge: num(c.startAge) ?? NaN,
    endAge: num(c.endAge),
    annualChange: (num(c.amount) ?? NaN) * (c.monthly ? 12 : 1),
    monthly: c.monthly,
  }));
  const invalidChanges = draftChanges.map((c) => ({
    label: !SpendingChange.shape.label.safeParse(c.label).success,
    startAge: !SpendingChange.shape.startAge.safeParse(c.startAge).success,
    endAge: !SpendingChange.shape.endAge.safeParse(c.endAge).success || (c.endAge !== null && c.endAge <= c.startAge),
    annualChange: !SpendingChange.shape.annualChange.safeParse(c.annualChange).success,
  }));
  const validChanges = draftChanges.filter((_, i) => !Object.values(invalidChanges[i]!).some(Boolean));
  const valid =
    !Object.values(invalid).some(Boolean) &&
    validProperties.length === draftProperties.length &&
    validChanges.length === draftChanges.length;

  // Live: the tiles and chart follow what's typed, falling back to the saved plan for anything invalid.
  const draft: RetirementPlan = {
    ...summary.plan,
    ...Object.fromEntries(FIELDS.map((f) => [f, invalid[f] ? summary.plan[f] : values[f]])),
    properties: validProperties,
    spendingChanges: validChanges,
  };
  const resolved = resolvePlan(draft, summary);
  const projection = resolved.inputs && projectRetirement(resolved.inputs);
  const dirty =
    FIELDS.some((f) => values[f] !== summary.plan[f]) ||
    !sameSales(draftProperties, summary.plan.properties) ||
    !sameChanges(draftChanges, summary.plan.spendingChanges);

  function set(field: NumberField) {
    return (value: string) => {
      setSaved(false);
      setText((t) => ({ ...t, [field]: value }));
    };
  }

  function setProperty(id: string, change: Partial<PropertyDraft>) {
    setSaved(false);
    setProperties((all) => {
      const current = all[id]!;
      // Turning a property on suggests selling it at retirement.
      const sellAge =
        change.on && !current.sellAge && resolved.inputs ? String(resolved.inputs.retirementAge) : (change.sellAge ?? current.sellAge);
      return { ...all, [id]: { ...current, ...change, sellAge } };
    });
  }

  function setChange(key: number, change: Partial<ChangeDraft>) {
    setSaved(false);
    setChanges((all) => all.map((c) => (c.key === key ? { ...c, ...change } : c)));
  }

  /** Switches between per month and per year, keeping the amount the same. */
  function setMonthly(c: ChangeDraft, monthly: boolean) {
    if (monthly === c.monthly) return;
    const amount = num(c.amount);
    const converted = amount === null || !Number.isFinite(amount) ? c.amount : String(Math.round((monthly ? amount / 12 : amount * 12) * 100) / 100);
    setChange(c.key, { monthly, amount: converted });
  }

  function addChanges(list: Partial<SpendingChange>[]) {
    setSaved(false);
    setChanges((all) => [...all, ...list.map(changeDraft)]);
  }

  function removeChange(key: number) {
    setSaved(false);
    setChanges((all) => all.filter((c) => c.key !== key));
  }

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate(
      { ...summary.plan, ...values, properties: draftProperties, spendingChanges: draftChanges },
      { onSuccess: () => setSaved(true) },
    );
  }

  function toggleAccount(account: RetirementAccount, include: boolean) {
    const others = summary.plan.excludedAccountIds.filter((id) => id !== account.id);
    save.mutate({ ...summary.plan, excludedAccountIds: include ? others : [...others, account.id] });
  }

  const d = summary.defaults;
  const income = d.annualIncome;
  // The estimate a blank Social Security field uses; it depends on when you stop working.
  const ssEstimate =
    resolved.inputs && income
      ? socialSecurityAtFullAge({ socialSecurityAnnual: null }, d, resolved.inputs.retirementAge).annual
      : null;

  // Changes Meld can see coming, offered until one with the same label is added.
  const labels = new Set(changes.map((c) => c.label.trim()));
  const sold = new Set(draft.properties.map((s) => s.mortgageAccountId));
  const leaving = d.children
    .map((k) => ({ childId: k.id, label: `${childName(d.children, k.id)} leaves home` }))
    .filter((c) => !changes.some((x) => x.childId === c.childId && x.label.trim() === c.label));
  const suggestions: Suggestion[] = [
    ...(leaving.length
      ? [
          {
            id: 'kids',
            caption: `${d.children.length > 1 ? 'Kids leave' : `${childName(d.children, leaving[0]!.childId)} leaves`} home at ${LEAVE_HOME_AGE}`,
            changes: leaving.map((c) => ({ ...c, startAge: LEAVE_HOME_AGE })),
          },
        ]
      : []),
    ...(resolved.inputs
      ? summary.mortgages.flatMap((m): Suggestion[] => {
          const age = mortgagePayoffAge(m, resolved.inputs!.currentAge);
          const label = summary.mortgages.length > 1 ? `${MORTGAGE_LABEL}: ${m.name}` : MORTGAGE_LABEL;
          if (age === null || age <= resolved.inputs!.currentAge || !m.monthlyPayment || sold.has(m.id) || labels.has(label)) return [];
          return [
            {
              id: m.id,
              caption: `${label} at ${age} · −${formatWholeCurrency(m.monthlyPayment)}/mo`,
              changes: [{ label, startAge: age, annualChange: -Math.round(m.monthlyPayment * 12), monthly: true }],
            },
          ];
        })
      : []),
  ];

  const saveRow = (
    <>
      {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
      <View style={styles.buttons}>
        <Button label="Save changes" disabled={!valid || !dirty} loading={save.isPending} onPress={submit} />
        {saved && !dirty && (
          <ThemedText type="small" themeColor="textSecondary">
            Saved.
          </ThemedText>
        )}
        {dirty && (
          <ThemedText type="small" themeColor="textSecondary">
            The projection shows your changes; save to keep them.
          </ThemedText>
        )}
      </View>
    </>
  );

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        Everything is in today’s dollars: returns are after inflation, so a dollar here buys what a dollar buys now.
      </ThemedText>

      {resolved.inputs && projection ? (
        <Summary inputs={resolved.inputs} projection={projection} />
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
              Enter what you spend each year below. Once you have a year of transactions, Meld suggests your current
              spending.
            </ThemedText>
          )}
        </Card>
      )}

      <View style={styles.columns}>
        {resolved.inputs && projection && (
          <View style={[styles.column, styles.main]}>
            <Card
              title="Projected savings"
              subtitle={`Growing ${resolved.inputs.expectedReturn}% a year after inflation, then drawn down from age ${resolved.inputs.retirementAge}`}>
              <RetirementProjection points={projection.points} retirementAge={resolved.inputs.retirementAge} sales={projection.sales} />
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
          </View>
        )}

        <Card title="Assumptions" subtitle="Leave a field empty to use the suggestion shown" style={styles.column}>
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
            <Field label="Spending per year, today" invalid={invalid.annualSpending}>
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
            <Field label="Social Security per month at full retirement age" invalid={invalid.socialSecurityAnnual}>
              <Input
                value={text.socialSecurityAnnual}
                onChangeText={set('socialSecurityAnnual')}
                placeholder={ssEstimate ? `${formatWholeCurrency(ssEstimate / 12)} · estimated from income` : '$ · from your statement'}
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </Field>
            <Field label="Claim at age" invalid={invalid.socialSecurityAge}>
              <Input value={text.socialSecurityAge} onChangeText={set('socialSecurityAge')} placeholder={String(RETIREMENT_DEFAULTS.socialSecurityAge)} keyboardType="number-pad" inputMode="numeric" maxLength={2} />
            </Field>
          </Row>
          {resolved.inputs && (
            <SocialSecurity
              birthYear={d.birthYear!}
              claimAge={resolved.inputs.socialSecurityAge}
              fullAnnual={socialSecurityAtFullAge(draft, d, resolved.inputs.retirementAge)}
              income={income}
              married={d.married}
              retirementAge={resolved.inputs.retirementAge}
              onClaimAge={(age) => set('socialSecurityAge')(String(age))}
              onShowProfile={onShowProfile}
            />
          )}
          <Field label="Pension per year" invalid={invalid.pensionAnnual}>
            <Input value={text.pensionAnnual} onChangeText={set('pensionAnnual')} placeholder="$0" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
          <Field label="Other savings for retirement (outside investment accounts)" invalid={invalid.otherSavings}>
            <Input value={text.otherSavings} onChangeText={set('otherSavings')} placeholder="$0 · e.g. cash set aside" keyboardType="decimal-pad" inputMode="decimal" />
          </Field>
          {saveRow}
        </Card>
      </View>

      <View style={styles.columns}>
        <Card
          title="Spending over time"
          subtitle="Start from today’s spending and add what will change: kids leaving home, a mortgage paid off, college, travel. Add your children on Profile to time changes by their ages."
          style={styles.column}>
          {suggestions.length > 0 && (
            <View style={styles.buttons}>
              {suggestions.map((s) => (
                <Button
                  key={s.id}
                  label={`+ ${s.caption}`}
                  variant="secondary"
                  size="small"
                  onPress={() => addChanges(s.changes)}
                />
              ))}
            </View>
          )}
          {changes.map((c, i) => {
            const bad = invalidChanges[i]!;
            return (
              <View key={c.key} style={styles.property}>
                <View style={styles.row}>
                  <View style={styles.shrink}>
                    <Field label="What changes" invalid={bad.label}>
                      <Input value={c.label} onChangeText={(label) => setChange(c.key, { label })} placeholder="e.g. Kids leave home" maxLength={60} />
                    </Field>
                  </View>
                  <Button label="Remove" variant="secondary" size="small" onPress={() => removeChange(c.key)} accessibilityLabel={`Remove ${c.label || 'spending change'}`} />
                </View>
                {(d.children.length > 0 || c.childId !== null) && (
                  <Field label="Ages are">
                    <View style={styles.chips}>
                      <Chip label="Yours" selected={c.childId === null} onPress={() => setChange(c.key, { childId: null })} />
                      {d.children.map((k) => (
                        <Chip
                          key={k.id}
                          label={childName(d.children, k.id)}
                          selected={c.childId === k.id}
                          onPress={() => setChange(c.key, { childId: k.id })}
                        />
                      ))}
                    </View>
                    {c.childId !== null && !d.children.some((k) => k.id === c.childId) && (
                      <ThemedText type="small" themeColor="negative">
                        This child is no longer on your profile, so the change is left out.
                      </ThemedText>
                    )}
                  </Field>
                )}
                <Row>
                  <Field label="From age" invalid={bad.startAge}>
                    <Input value={c.startAge} onChangeText={(startAge) => setChange(c.key, { startAge })} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
                  </Field>
                  <Field label="Until age" invalid={bad.endAge}>
                    <Input value={c.endAge} onChangeText={(endAge) => setChange(c.key, { endAge })} placeholder="For good" keyboardType="number-pad" inputMode="numeric" maxLength={3} />
                  </Field>
                  <Field label={c.monthly ? 'Change per month' : 'Change per year'} invalid={bad.annualChange}>
                    <Input value={c.amount} onChangeText={(amount) => setChange(c.key, { amount })} placeholder="−$ for less, $ for more" keyboardType="numbers-and-punctuation" inputMode="decimal" />
                  </Field>
                </Row>
                <View style={styles.chips}>
                  <Chip label="Per month" selected={c.monthly} onPress={() => setMonthly(c, true)} />
                  <Chip label="Per year" selected={!c.monthly} onPress={() => setMonthly(c, false)} />
                </View>
              </View>
            );
          })}
          <View style={styles.buttons}>
            <Button label="Add a change" variant="secondary" size="small" onPress={() => addChanges([{}])} />
          </View>
          <Field label={`Spending falls each year after ${SPENDING_DECLINE_AGE}, %`} invalid={invalid.spendingDeclinePercent}>
            <Input
              value={text.spendingDeclinePercent}
              onChangeText={set('spendingDeclinePercent')}
              placeholder={`${RETIREMENT_DEFAULTS.spendingDeclinePercent} · 0 to keep it flat`}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </Field>
          <ThemedText type="small" themeColor="textSecondary">
            People tend to spend less as they age: households over 75 spend about a fifth less than those 65 to 74, even
            with higher health costs.
          </ThemedText>
          {resolved.inputs && <SpendingPath inputs={resolved.inputs} />}
          {saveRow}
        </Card>

        <Accounts summary={summary} otherSavings={draft.otherSavings} onToggle={toggleAccount} disabled={save.isPending} />

        <Card
          title="Properties"
          subtitle="Count a property you’d sell to fund retirement. Its proceeds join your savings in the year you sell."
          style={styles.column}>
          {summary.properties.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No properties yet. Add a home or rental on the Accounts tab to count a future sale here.
            </ThemedText>
          )}
          {summary.properties.map((p, i) => {
            const draftRow = properties[p.id]!;
            const bad = invalidProperty(p.id);
            const sale = validProperties.find((s) => s.assetId === p.id);
            const mortgage = summary.mortgages.find((m) => m.id === draftRow.mortgageAccountId) ?? null;
            const inputs = resolved.inputs;
            const years = sale && inputs ? Math.max(0, sale.sellAge - inputs.currentAge) : 0;
            const proceeds =
              sale && inputs
                ? saleProceeds(
                    p,
                    mortgage,
                    years,
                    draft.propertyAppreciation ?? RETIREMENT_DEFAULTS.propertyAppreciation,
                    draft.sellingCostPercent ?? RETIREMENT_DEFAULTS.sellingCostPercent,
                  )
                : null;
            const owed = mortgage ? remainingLoanBalance(mortgage.balance, mortgage.interestRatePct, mortgage.monthlyPayment, years * 12) : 0;
            const mortgageNote = !mortgage
              ? ''
              : owed > 0
                ? ` and the ${formatWholeCurrency(owed)} left on the mortgage`
                : '; the mortgage is paid off by then';
            return (
              // Earlier rows draw over later ones, so an open mortgage list isn't hidden.
              <View key={p.id} style={[styles.property, { zIndex: summary.properties.length - i }]}>
                <View style={styles.row}>
                  <View style={styles.shrink}>
                    <ThemedText numberOfLines={1} themeColor={draftRow.on ? 'text' : 'textSecondary'}>
                      {p.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {[p.address, `${formatWholeCurrency(p.value)} your share today`].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  <Switch
                    value={draftRow.on}
                    onValueChange={(on) => setProperty(p.id, { on })}
                    accessibilityLabel={`Count selling ${p.name} toward retirement`}
                  />
                </View>
                {draftRow.on && (
                  <>
                    <Row>
                      <Field label="Sell at age" invalid={bad.sellAge}>
                        <Input value={draftRow.sellAge} onChangeText={(sellAge) => setProperty(p.id, { sellAge })} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
                      </Field>
                      <Field label="Mortgage on it">
                        <Dropdown
                          accessibilityLabel={`Mortgage on ${p.name}`}
                          value={draftRow.mortgageAccountId ?? NO_MORTGAGE}
                          onChange={(v) => setProperty(p.id, { mortgageAccountId: v === NO_MORTGAGE ? null : v })}
                          options={[
                            { value: NO_MORTGAGE, label: 'None, or paid off' },
                            ...summary.mortgages.map((m) => ({
                              value: m.id,
                              label: [m.institutionName, m.name, formatCompactCurrency(m.balance)].filter(Boolean).join(' · '),
                            })),
                          ]}
                        />
                      </Field>
                      <Field label="Net rent per year" invalid={bad.rent}>
                        <Input value={draftRow.rent} onChangeText={(rent) => setProperty(p.id, { rent })} placeholder="$0 · rent minus costs" keyboardType="numbers-and-punctuation" inputMode="decimal" />
                      </Field>
                    </Row>
                    {proceeds !== null && sale && (
                      <ThemedText type="small" themeColor="textSecondary">
                        About {formatWholeCurrency(proceeds)} to you at {Math.max(sale.sellAge, inputs!.currentAge)}, after
                        selling costs{mortgageNote}. Taxes on the gain aren’t included.
                      </ThemedText>
                    )}
                  </>
                )}
              </View>
            );
          })}
          {summary.properties.length > 0 && (
            <>
              <Row>
                <Field label="Value growth after inflation, %" invalid={invalid.propertyAppreciation}>
                  <Input value={text.propertyAppreciation} onChangeText={set('propertyAppreciation')} placeholder={String(RETIREMENT_DEFAULTS.propertyAppreciation)} keyboardType="numbers-and-punctuation" inputMode="decimal" />
                </Field>
                <Field label="Selling costs, %" invalid={invalid.sellingCostPercent}>
                  <Input value={text.sellingCostPercent} onChangeText={set('sellingCostPercent')} placeholder={String(RETIREMENT_DEFAULTS.sellingCostPercent)} keyboardType="decimal-pad" inputMode="decimal" />
                </Field>
              </Row>
              <ThemedText type="small" themeColor="textSecondary">
                Selling the home you live in? You’ll still need somewhere to live, so include rent or a smaller home’s
                costs in your retirement spending.
              </ThemedText>
              {saveRow}
            </>
          )}
        </Card>
      </View>
    </>
  );
}

/** Spending at a few ages, to check the changes add up. */
function SpendingPath({ inputs }: { inputs: RetirementInputs }) {
  const start = Math.max(inputs.retirementAge, inputs.currentAge);
  const ages = [start, ...[75, 85].filter((a) => a > start && a < inputs.lifeExpectancy)];
  return (
    <ThemedText type="small" themeColor="textSecondary">
      Spending per year in today’s dollars:{' '}
      {ages.map((a, i) => `${i === 0 ? 'about ' : ''}${formatWholeCurrency(Math.round(spendingAt(inputs, a)))} at ${a}`).join(', ')}.
    </ThemedText>
  );
}

function Summary({ inputs, projection: p }: { inputs: RetirementInputs; projection: Projection }) {
  const retired = inputs.retirementAge <= inputs.currentAge;
  const saleTotal = p.sales.reduce((sum, s) => sum + s.proceeds, 0);
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
          caption={[
            `${formatWholeCurrency(-p.gap)} to spare`,
            p.depletionAge === null ? `lasts past ${inputs.lifeExpectancy}` : `runs short at ${p.depletionAge} before a later sale`,
          ].join(' · ')}
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
      {p.sales.length > 0 && (
        <StatTile
          label="Property sales"
          value={saleTotal}
          caption={p.sales.map((s) => `${s.name} at ${s.age}`).join(' · ')}
        />
      )}
    </TileRow>
  );
}

/** Where the Social Security figure comes from, and what each claiming age pays. */
function SocialSecurity({
  birthYear,
  claimAge,
  fullAnnual: { annual, estimated },
  income,
  married,
  retirementAge,
  onClaimAge,
  onShowProfile,
}: {
  birthYear: number;
  claimAge: number;
  fullAnnual: { annual: number; estimated: boolean };
  income: number | null;
  married: boolean;
  retirementAge: number;
  onClaimAge: (age: number) => void;
  onShowProfile: () => void;
}) {
  const statementLink = (
    <ThemedText type="small" themeColor="tint" onPress={() => Linking.openURL(SSA_ACCOUNT_URL)} accessibilityRole="link">
      ssa.gov
    </ThemedText>
  );
  if (annual === 0) {
    return (
      <View style={styles.missing}>
        <ThemedText type="small" themeColor="textSecondary">
          {income === null
            ? 'Add your income to your profile and Meld will estimate your Social Security, or '
            : 'Not counting Social Security. To count it, '}
          type the amount at full retirement age from your statement at {statementLink}.
        </ThemedText>
        {income === null && <Button label="Add income" variant="secondary" size="small" onPress={onShowProfile} />}
      </View>
    );
  }
  const monthly = (age: number) => (annual / 12) * claimingFactor(birthYear, age);
  const ages = [...new Set([62, Math.ceil(fullRetirementAgeMonths(birthYear) / 12), 70])];
  return (
    <View style={styles.missing}>
      <ThemedText type="small" themeColor="textSecondary">
        {estimated ? (
          <>
            Estimated from your {formatWholeCurrency(income!)} income{married ? ' for you and your spouse' : ''}, working
            to {retirementAge}, with today’s benefit formula. For your exact figure, sign in at{' '}
            {statementLink} and type the amount at full retirement age ({formatFullRetirementAge(birthYear)}).
          </>
        ) : (
          <>
            Your full retirement age is {formatFullRetirementAge(birthYear)}. Claiming at {claimAge} pays{' '}
            {formatWholeCurrency(monthly(claimAge))} a month.
          </>
        )}
      </ThemedText>
      <View style={styles.buttons}>
        {ages.map((age) => (
          <Button
            key={age}
            label={`${age} · ${formatWholeCurrency(monthly(age))}/mo`}
            variant={age === claimAge ? 'primary' : 'secondary'}
            size="small"
            onPress={() => onClaimAge(age)}
            accessibilityLabel={`Claim Social Security at ${age}`}
          />
        ))}
      </View>
    </View>
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
    <Card
      title="Counted toward retirement"
      subtitle="Your share of each investment account. Turn off any you’re saving for something else."
      style={styles.column}>
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
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  column: { flexGrow: 1, flexBasis: 420, minWidth: 0 },
  main: { flexGrow: 3, flexBasis: 560, gap: Spacing.three },
  property: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flex: 1, flexShrink: 1 },
  total: { paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
