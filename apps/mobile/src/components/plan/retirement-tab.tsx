import {
  childName,
  claimingFactor,
  formatFullRetirementAge,
  fullRetirementAgeMonths,
  inYourAges,
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
  spendingAt,
  type RetirementAccount,
  type RetirementInputs,
  type RetirementProjection as Projection,
  type RetirementSummary,
  type TaxTreatment,
} from '@meld/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, Switch, View, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RetirementProjection } from '@/components/charts/retirement-projection';
import { Dropdown } from '@/components/dropdown';
import { InfoTip, WithTip } from '@/components/info-tip';
import { InsightCallout, StatTile, TileRow } from '@/components/investments/common';
import {
  eventDraft,
  eventProblems,
  LifeEvents,
  sameEvents,
  toEvent,
  type EventDraft,
  type EventSeed,
  type Suggestion,
} from '@/components/plan/life-events';
import { MonteCarlo } from '@/components/plan/monte-carlo';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ScenarioBar, ScenarioCompare } from '@/components/plan/scenarios';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { useRetirement, useSaveRetirementPlan } from '@/lib/queries';

const TAX_LABELS: Record<TaxTreatment, string | null> = {
  tax_deferred: 'Tax-deferred',
  tax_free: 'Tax-free',
  taxable: 'Taxable',
  unknown: null,
};

/** The plan's numbers, typed in as text; accounts, properties and life events have their own controls. */
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

const MORTGAGE_LABEL = 'Mortgage paid off';
/** The age kids are assumed to leave home; the user changes it per child. */
const LEAVE_HOME_AGE = 18;

/** Dropdown value for "no mortgage". */
const NO_MORTGAGE = 'none';

/** How long "Saved" shows before the save bar goes away. */
const SAVED_MS = 2500;

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

/** Social Security is typed per month, as the SSA statement shows it, and saved per year. */
const MONTHLY = new Set<NumberField>(['socialSecurityAnnual']);
const toText = (f: NumberField, v: number | null) => (v !== null && MONTHLY.has(f) ? str(Math.round((v / 12) * 100) / 100) : str(v));

const SSA_ACCOUNT_URL = 'https://www.ssa.gov/myaccount/';

/** Projection, gap and assumptions for retirement, in today's dollars. */
export function RetirementTab({ onShowProfile }: { onShowProfile: () => void }) {
  // null is the active scenario.
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  // Bumped to throw away unsaved drafts.
  const [resets, setResets] = useState(0);
  const retirement = useRetirement(scenarioId);
  if (retirement.isPending) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
  if (retirement.isError) {
    return <ThemedText themeColor="negative">Couldn’t load your retirement plan: {retirement.error.message}</ThemedText>;
  }
  return (
    // A new scenario, or discarding, starts the drafts afresh.
    <RetirementPlanner
      key={`${retirement.data.scenario.id}-${resets}`}
      summary={retirement.data}
      scenarioId={scenarioId}
      onSelectScenario={setScenarioId}
      onDiscard={() => setResets((n) => n + 1)}
      onShowProfile={onShowProfile}
    />
  );
}

function RetirementPlanner({
  summary,
  scenarioId,
  onSelectScenario,
  onDiscard,
  onShowProfile,
}: {
  summary: RetirementSummary;
  scenarioId: string | null;
  onSelectScenario: (id: string | null) => void;
  onDiscard: () => void;
  onShowProfile: () => void;
}) {
  const save = useSaveRetirementPlan(scenarioId);
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
  const [events, setEvents] = useState<EventDraft[]>(() => summary.plan.spendingChanges.map((c) => eventDraft(c)));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(t);
  }, [saved]);

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
  const draftEvents = events.map(toEvent);
  const validEvents = draftEvents.filter((e) => !Object.values(eventProblems(e)).some(Boolean));
  const unfinished = validEvents.length < draftEvents.length;
  const valid = !Object.values(invalid).some(Boolean) && validProperties.length === draftProperties.length && !unfinished;

  // Live: the tiles and chart follow what's typed, falling back to the saved plan for anything invalid.
  const draft: RetirementPlan = {
    ...summary.plan,
    ...Object.fromEntries(FIELDS.map((f) => [f, invalid[f] ? summary.plan[f] : values[f]])),
    properties: validProperties,
    spendingChanges: validEvents,
  };
  const resolved = resolvePlan(draft, summary);
  const projection = resolved.inputs && projectRetirement(resolved.inputs);
  const dirty =
    FIELDS.some((f) => values[f] !== summary.plan[f]) ||
    !sameSales(draftProperties, summary.plan.properties) ||
    !sameEvents(draftEvents, summary.plan.spendingChanges);

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

  function setEvent(key: number, change: Partial<EventDraft>) {
    // Opening or closing a row isn't an edit.
    if (Object.keys(change).some((k) => k !== 'open')) setSaved(false);
    setEvents((all) => all.map((e) => (e.key === key ? { ...e, ...change } : e)));
  }

  function addEvents(list: EventSeed[]) {
    setSaved(false);
    // A single new event opens for editing; a batch (every child leaving home) stays tidy.
    setEvents((all) => [...all, ...list.map((e) => eventDraft(e, list.length === 1))]);
  }

  function removeEvent(key: number) {
    setSaved(false);
    setEvents((all) => all.filter((e) => e.key !== key));
  }

  function submit() {
    if (!valid) return;
    setSaved(false);
    save.mutate(
      { ...summary.plan, ...values, properties: draftProperties, spendingChanges: draftEvents },
      {
        onSuccess: () => {
          setSaved(true);
          setEvents((all) => all.map((e) => ({ ...e, open: false })));
        },
      },
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

  // Events Meld can see coming, offered until one with the same label is added.
  const labels = new Set(events.map((e) => e.label.trim()));
  const sold = new Set(draft.properties.map((s) => s.mortgageAccountId));
  const leaving = d.children
    .map((k) => ({ childId: k.id, label: `${childName(d.children, k.id)} leaves home` }))
    .filter((c) => !events.some((x) => x.childId === c.childId && x.label.trim() === c.label));
  const suggestions: Suggestion[] = [
    ...(leaving.length
      ? [
          {
            id: 'kids',
            caption: `${d.children.length > 1 ? 'Kids leave' : `${childName(d.children, leaving[0]!.childId)} leaves`} home at ${LEAVE_HOME_AGE}`,
            events: leaving.map((c) => ({ ...c, kind: 'spending' as const, startAge: LEAVE_HOME_AGE })),
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
              events: [{ label, kind: 'spending', startAge: age, annualChange: -Math.round(m.monthlyPayment * 12), monthly: true }],
            },
          ];
        })
      : []),
  ];

  // Where each event starts on the chart, in your ages.
  const markers =
    d.birthYear === null ? [] : inYourAges(validEvents, d.children, d.birthYear).map((e) => ({ label: e.label, age: e.startAge }));

  const lifeEventsCard = (
    <LifeEvents
      drafts={events}
      inputs={resolved.inputs}
      kids={d.children}
      birthYear={d.birthYear}
      suggestions={suggestions}
      onAdd={addEvents}
      onChange={setEvent}
      onRemove={removeEvent}
      onShowProfile={onShowProfile}
    />
  );

  const saveBar = (dirty || saved || save.isError) && (
    <SaveBar
      dirty={dirty}
      saved={saved}
      problem={
        !valid
          ? unfinished
            ? 'Finish or remove the unfinished event to save.'
            : 'Fix the fields marked “check this” to save.'
          : null
      }
      error={save.isError ? save.error.message : null}
      saving={save.isPending}
      onSave={submit}
      onDiscard={onDiscard}
    />
  );

  return (
    <>
      <ScenarioBar summary={summary} dirty={dirty} onSelect={onSelectScenario} />

      <View style={styles.intro}>
        <WithTip tip={TIPS.todaysDollars}>
          <ThemedText type="small" themeColor="textSecondary">
            Every amount is in today’s dollars
          </ThemedText>
        </WithTip>
        <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
          · Projections rest on the assumptions you set, and are for planning, not professional financial advice.
        </ThemedText>
      </View>

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
              Enter what you spend each year under “Spending in retirement”. Once you have a year of transactions, Meld
              suggests your current spending.
            </ThemedText>
          )}
        </Card>
      )}

      {/* On a phone the bar sits up top, where the numbers it saves are; on the web it follows you down the page. */}
      {Platform.OS !== 'web' && saveBar}

      <View style={styles.columns}>
        {resolved.inputs && projection && (
          <View style={[styles.column, styles.main]}>
            <Card
              title="Projected savings"
              tip={TIPS.projected}
              subtitle={`Growing ${resolved.inputs.expectedReturn}% a year after inflation, then drawn down from age ${resolved.inputs.retirementAge}. Tap or hover for any year.`}>
              <RetirementProjection
                points={projection.points}
                retirementAge={resolved.inputs.retirementAge}
                sales={projection.sales}
                events={markers}
              />
              {markers.length > 0 && <Legend />}
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
            {lifeEventsCard}
          </View>
        )}

        <View style={[styles.column, styles.side]}>
          <Card title="The basics" subtitle="Leave a field empty to use the suggestion in it.">
            <Row>
              <Field label="Retire at age" invalid={invalid.retirementAge} tip={TIPS.retirementAge}>
                <Input value={text.retirementAge} onChangeText={set('retirementAge')} placeholder={String(RETIREMENT_DEFAULTS.retirementAge)} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
              </Field>
              <Field label="Plan to age" invalid={invalid.lifeExpectancy} tip={TIPS.planToAge}>
                <Input value={text.lifeExpectancy} onChangeText={set('lifeExpectancy')} placeholder={String(RETIREMENT_DEFAULTS.lifeExpectancy)} keyboardType="number-pad" inputMode="numeric" maxLength={3} />
              </Field>
            </Row>
            <Row>
              <Field label="Saving per year" invalid={invalid.annualContribution} tip={TIPS.contribution}>
                <Input
                  value={text.annualContribution}
                  onChangeText={set('annualContribution')}
                  placeholder={income ? `$0 · 15% is ${formatCompactCurrency(income * 0.15)}` : '$0'}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Return after inflation, %" invalid={invalid.expectedReturn} tip={TIPS.expectedReturn}>
                <Input value={text.expectedReturn} onChangeText={set('expectedReturn')} placeholder={String(RETIREMENT_DEFAULTS.expectedReturn)} keyboardType="decimal-pad" inputMode="decimal" />
              </Field>
            </Row>
          </Card>

          <Card title="Spending in retirement" tip={TIPS.spending}>
            <Row>
              <Field label="Per year, in today’s dollars" invalid={invalid.annualSpending}>
                <Input
                  value={text.annualSpending}
                  onChangeText={set('annualSpending')}
                  placeholder={d.annualSpending !== null ? `${formatWholeCurrency(d.annualSpending)} · last 12 months` : '$'}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
              <Field label={`Slows after ${SPENDING_DECLINE_AGE}, % a year`} invalid={invalid.spendingDeclinePercent} tip={TIPS.spendingDecline}>
                <Input
                  value={text.spendingDeclinePercent}
                  onChangeText={set('spendingDeclinePercent')}
                  placeholder={`${RETIREMENT_DEFAULTS.spendingDeclinePercent} · 0 keeps it flat`}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
            </Row>
            {resolved.inputs && <SpendingPath inputs={resolved.inputs} />}
            <ThemedText type="small" themeColor="textSecondary">
              Expect a change, like a paid-off mortgage or kids leaving home? Add it under Life events.
            </ThemedText>
          </Card>

          <Card title="Income in retirement" subtitle="Money that comes in without selling investments.">
            <Row>
              <Field label="Social Security per month" invalid={invalid.socialSecurityAnnual} tip={TIPS.socialSecurity}>
                <Input
                  value={text.socialSecurityAnnual}
                  onChangeText={set('socialSecurityAnnual')}
                  placeholder={ssEstimate ? `${formatWholeCurrency(ssEstimate / 12)} · estimated` : '$ · from your statement'}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Start it at age" invalid={invalid.socialSecurityAge} tip={TIPS.claimAge}>
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
            <Field label="Pension per year" invalid={invalid.pensionAnnual} tip={TIPS.pension}>
              <Input value={text.pensionAnnual} onChangeText={set('pensionAnnual')} placeholder="$0" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
          </Card>
        </View>
      </View>

      {/* Without a projection there's no main column, so life events get their own row. */}
      {!(resolved.inputs && projection) && lifeEventsCard}

      {resolved.inputs && <MonteCarlo scenarioId={summary.scenario.id} inputs={resolved.inputs} dirty={dirty} />}
      {resolved.inputs && summary.scenarios.length > 1 && (
        <ScenarioCompare summary={summary} draft={draft} dirty={dirty} onSelect={onSelectScenario} />
      )}

      <View style={styles.columns}>
        <Accounts
          summary={summary}
          otherSavings={draft.otherSavings}
          onToggle={toggleAccount}
          disabled={save.isPending}
          otherSavingsField={
            <Field label="Other savings for retirement" invalid={invalid.otherSavings} tip={TIPS.otherSavings}>
              <Input value={text.otherSavings} onChangeText={set('otherSavings')} placeholder="$0 · e.g. cash set aside" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
          }
        />

        <Card
          title="Properties"
          tip={TIPS.properties}
          subtitle="Count a home or rental you’d sell to help pay for retirement. What you get from the sale joins your savings that year."
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
                      <Field label="Net rent per year" invalid={bad.rent} tip={TIPS.netRent}>
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
                <Field label="Value growth after inflation, %" invalid={invalid.propertyAppreciation} tip={TIPS.appreciation}>
                  <Input value={text.propertyAppreciation} onChangeText={set('propertyAppreciation')} placeholder={String(RETIREMENT_DEFAULTS.propertyAppreciation)} keyboardType="numbers-and-punctuation" inputMode="decimal" />
                </Field>
                <Field label="Selling costs, %" invalid={invalid.sellingCostPercent} tip={TIPS.sellingCosts}>
                  <Input value={text.sellingCostPercent} onChangeText={set('sellingCostPercent')} placeholder={String(RETIREMENT_DEFAULTS.sellingCostPercent)} keyboardType="decimal-pad" inputMode="decimal" />
                </Field>
              </Row>
              <ThemedText type="small" themeColor="textSecondary">
                Selling the home you live in? You’ll still need somewhere to live, so include rent or a smaller home’s
                costs in your retirement spending.
              </ThemedText>
            </>
          )}
        </Card>
      </View>

      {Platform.OS === 'web' && saveBar}
    </>
  );
}

/** Unsaved changes: save or throw them away. Sticks to the bottom of the window on the web. */
function SaveBar({
  dirty,
  saved,
  problem,
  error,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saved: boolean;
  /** Why it can't be saved yet. */
  problem: string | null;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  const message = error ?? (!dirty ? 'Saved.' : (problem ?? 'Unsaved changes. The numbers already show them.'));
  return (
    <ThemedView type="backgroundElement" style={[styles.saveBar, STICKY, { borderColor: dirty ? theme.tint : theme.border }]}>
      <ThemedText
        type="small"
        themeColor={error ? 'negative' : problem && dirty ? 'warning' : 'textSecondary'}
        style={styles.saveMessage}
        accessibilityLiveRegion="polite">
        {message}
      </ThemedText>
      {dirty && (
        <View style={styles.buttons}>
          <Button label="Discard" variant="secondary" size="small" onPress={onDiscard} disabled={saving} />
          <Button label="Save changes" size="small" disabled={!!problem} loading={saving} onPress={onSave} />
        </View>
      )}
    </ThemedView>
  );
}

/** react-native-web supports sticky positioning; native types don't know it. */
const STICKY = (Platform.OS === 'web' ? { position: 'sticky', bottom: Spacing.three, zIndex: 20 } : {}) as ViewStyle;

function Legend() {
  const viz = useVizColors();
  return (
    <View style={styles.legend}>
      <ThemedText type="small" themeColor="textSecondary">
        <ThemedText type="small" style={{ color: viz.series2 }}>
          ◆
        </ThemedText>{' '}
        A life event starts
      </ThemedText>
    </View>
  );
}

/** Spending at a few ages, to check the changes add up. */
function SpendingPath({ inputs }: { inputs: RetirementInputs }) {
  const start = Math.max(inputs.retirementAge, inputs.currentAge);
  const ages = [start, ...[75, 85].filter((a) => a > start && a < inputs.lifeExpectancy)];
  return (
    <ThemedText type="small" themeColor="textSecondary">
      With your life events and the slowdown, you’d spend{' '}
      {ages.map((a, i) => `${i === 0 ? 'about ' : ''}${formatWholeCurrency(Math.round(spendingAt(inputs, a)))} a year at ${a}`).join(', ')}.
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
        tip={TIPS.projected}
        value={p.atRetirement}
        caption={retired ? 'Counted toward retirement' : `From ${formatWholeCurrency(inputs.startingBalance)} today`}
      />
      <StatTile
        label={`Needed at ${inputs.retirementAge}`}
        tip={TIPS.needed}
        value={p.needed}
        caption={`To last to age ${inputs.lifeExpectancy}`}
      />
      {p.gap <= 0 ? (
        <StatTile
          label="Status"
          tip={TIPS.status}
          tone="positive"
          value="On track"
          caption={[
            `${formatWholeCurrency(-p.gap)} to spare`,
            p.depletionAge === null ? `lasts past ${inputs.lifeExpectancy}` : `runs short at ${p.depletionAge} before a later sale`,
          ].join(' · ')}
        />
      ) : (
        <StatTile
          label="Status"
          tip={TIPS.status}
          tone="negative"
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
  const fullAge = Math.ceil(fullRetirementAgeMonths(birthYear) / 12);
  const ages = [...new Set([62, fullAge, 70])];
  return (
    <View style={styles.missing}>
      <View style={styles.labelRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Pick when to start · your full retirement age is {formatFullRetirementAge(birthYear)}
        </ThemedText>
        <InfoTip title={TIPS.fullRetirementAge.title}>{TIPS.fullRetirementAge.body}</InfoTip>
      </View>
      <View style={styles.buttons}>
        {ages.map((age) => (
          <Button
            key={age}
            label={`${age === 62 ? 'Earliest' : age === 70 ? 'Latest' : 'Full'} · ${age} · ${formatWholeCurrency(monthly(age))}/mo`}
            variant={age === claimAge ? 'primary' : 'secondary'}
            size="small"
            onPress={() => onClaimAge(age)}
            accessibilityLabel={`Start Social Security at ${age}`}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {estimated ? (
          <>
            Estimated from your {formatWholeCurrency(income!)} income{married ? ' for you and your spouse' : ''}, working
            to {retirementAge}. For your exact figure, sign in at {statementLink} and type the monthly amount at full
            retirement age.
          </>
        ) : (
          <>
            Starting at {claimAge} pays {formatWholeCurrency(monthly(claimAge))} a month for life.
          </>
        )}
      </ThemedText>
    </View>
  );
}

function Accounts({
  summary,
  otherSavings,
  onToggle,
  disabled,
  otherSavingsField,
}: {
  summary: RetirementSummary;
  otherSavings: number | null;
  onToggle: (account: RetirementAccount, include: boolean) => void;
  disabled: boolean;
  otherSavingsField: ReactNode;
}) {
  const theme = useTheme();
  const total = retirementBalance(summary, { otherSavings });
  return (
    <Card
      title="Counted toward retirement"
      tip={TIPS.counted}
      subtitle="Your share of each investment account. Turn off any you’re saving for something else."
      style={styles.column}>
      {summary.accounts.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No investment accounts yet. Link your 401(k), IRA or brokerage on the Accounts tab.
        </ThemedText>
      )}
      {summary.accounts.length > 0 && (
        <View style={styles.labelRow}>
          <ThemedText type="small" themeColor="textSecondary">
            What tax-deferred, tax-free and taxable mean
          </ThemedText>
          <InfoTip title={TIPS.taxTreatment.title}>{TIPS.taxTreatment.body}</InfoTip>
        </View>
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
      {otherSavingsField}
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
  intro: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.one, rowGap: Spacing.half },
  missing: { gap: Spacing.two, alignItems: 'flex-start' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0 },
  main: { flexGrow: 3, flexBasis: 560, gap: Spacing.three },
  side: { gap: Spacing.three },
  property: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  shrink: { flex: 1, flexShrink: 1 },
  total: { paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  // Wide enough that on a phone the buttons wrap below rather than squeezing it.
  saveMessage: { flexGrow: 1, flexShrink: 1, flexBasis: 240 },
  legend: { flexDirection: 'row', gap: Spacing.three },
  saveBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
