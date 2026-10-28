import {
  projectRetirement,
  PropertySale,
  resolvePlan,
  remainingLoanBalance,
  RETIREMENT_DEFAULTS,
  RetirementPlan,
  retirementBalance,
  saleProceeds,
  type RetirementAccount,
  type RetirementInputs,
  type RetirementProjection as Projection,
  type RetirementSummary,
  type TaxTreatment,
} from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
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

/** The plan's numbers, typed in as text; accounts and properties have their own controls. */
type NumberField = Exclude<keyof RetirementPlan, 'excludedAccountIds' | 'properties'>;
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
  'propertyAppreciation',
  'sellingCostPercent',
];

/** One property's controls, as typed. */
type PropertyDraft = { on: boolean; sellAge: string; mortgageAccountId: string | null; rent: string };

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
  const [saved, setSaved] = useState(false);

  // Each field is checked against the shared schema, so the form and the API agree on limits.
  const values = Object.fromEntries(FIELDS.map((f) => [f, num(text[f])])) as Record<NumberField, number | null>;
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
  const valid = !Object.values(invalid).some(Boolean) && validProperties.length === draftProperties.length;

  // Live: the tiles and chart follow what's typed, falling back to the saved plan for anything invalid.
  const draft: RetirementPlan = {
    ...summary.plan,
    ...Object.fromEntries(FIELDS.map((f) => [f, invalid[f] ? summary.plan[f] : values[f]])),
    properties: validProperties,
  };
  const resolved = resolvePlan(draft, summary);
  const projection = resolved.inputs && projectRetirement(resolved.inputs);
  const dirty =
    FIELDS.some((f) => values[f] !== summary.plan[f]) || !sameSales(draftProperties, summary.plan.properties);

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

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate({ ...summary.plan, ...values, properties: draftProperties }, { onSuccess: () => setSaved(true) });
  }

  function toggleAccount(account: RetirementAccount, include: boolean) {
    const others = summary.plan.excludedAccountIds.filter((id) => id !== account.id);
    save.mutate({ ...summary.plan, excludedAccountIds: include ? others : [...others, account.id] });
  }

  const d = summary.defaults;
  const income = d.annualIncome;
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
              Enter what you expect to spend each year in retirement below. Once you have a year of transactions, Meld
              suggests your current spending.
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
          {saveRow}
        </Card>
      </View>

      <View style={styles.columns}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flex: 1, flexShrink: 1 },
  total: { paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
