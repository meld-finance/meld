import {
  childName,
  firstRetireAge,
  fullRetireAge,
  inYourAges,
  mortgagePayoffAge,
  partnerName,
  projectRetirement,
  PropertySale,
  resolveCoupleSocialSecurity,
  resolvePlan,
  RETIREMENT_DEFAULTS,
  RetirementPlan,
  retirementCashFlow,
  saleProceeds,
  SIMULATION_DEFAULTS,
  simulateRetirement,
  socialSecurityAtFullAge,
  SPENDING_DECLINE_AGE,
  type RetirementAccount,
  type RetirementInputs,
  type RetirementSummary,
} from '@meld/shared';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { RetirementCashFlow } from '@/components/charts/retirement-cashflow';
import {
  RetirementProjection,
  type HighlightedSpan,
  type ProjectionEventMarker,
} from '@/components/charts/retirement-projection';
import { RetirementTimeline, type TimelineEventInput, type TimelinePropertyInput } from '@/components/charts/retirement-timeline';
import { WithTip } from '@/components/info-tip';
import { InsightCallout } from '@/components/investments/common';
import {
  eventDraft,
  eventProblems,
  LifeEvents,
  resolvedSortAge,
  sameEvents,
  toEvent,
  type EventDraft,
  type EventSeed,
  type Suggestion,
} from '@/components/plan/life-events';
import { MonteCarlo } from '@/components/plan/monte-carlo';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { RetirementAccounts } from '@/components/plan/retirement-accounts';
import { RetirementLevers, type LeverPatch } from '@/components/plan/retirement-levers';
import { AgeStepper, SaveBar, SocialSecurity, SpendingPath, Summary } from '@/components/plan/retirement-parts';
import { RetirementProperties, type PropertyDraft } from '@/components/plan/retirement-properties';
import { TIPS } from '@/components/plan/retirement-tips';
import { ScenarioBar, ScenarioCompare } from '@/components/plan/scenarios';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { useRetirement, useSaveRetirementPlan } from '@/lib/queries';

/** The plan's numbers, typed in as text; accounts, properties and life events have their own controls. */
type NumberField = Exclude<keyof RetirementPlan, 'excludedAccountIds' | 'properties' | 'spendingChanges'>;
const FIELDS: NumberField[] = [
  'retirementAge',
  'lifeExpectancy',
  'annualContribution',
  'partnerRetirementAge',
  'partnerLifeExpectancy',
  'partnerAnnualContribution',
  'expectedReturn',
  'annualSpending',
  'spendingDeclinePercent',
  'socialSecurityAnnual',
  'socialSecurityAge',
  'partnerSocialSecurityAnnual',
  'partnerSocialSecurityAge',
  'pensionAnnual',
  'partnerPensionAnnual',
  'otherSavings',
  'propertyAppreciation',
  'sellingCostPercent',
];

type WorkspaceSection = 'assumptions' | 'events' | 'accounts' | 'properties' | 'stress' | 'compare';
type ChartMode = 'balance' | 'cashflow';

const MORTGAGE_LABEL = 'Mortgage paid off';
/** The age kids are assumed to leave home; the user changes it per child. */
const LEAVE_HOME_AGE = 18;

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
const MONTHLY = new Set<NumberField>(['socialSecurityAnnual', 'partnerSocialSecurityAnnual']);
const toText = (f: NumberField, v: number | null) => (v !== null && MONTHLY.has(f) ? str(Math.round((v / 12) * 100) / 100) : str(v));

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
  const theme = useTheme();
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
            open: false,
          },
        ];
      }),
    ),
  );
  const [events, setEvents] = useState<EventDraft[]>(() =>
    summary.plan.spendingChanges.map((c) =>
      eventDraft(c, false, resolvedSortAge(c, summary.defaults.children, summary.defaults.birthYear, summary.defaults.partner)),
    ),
  );
  const [saved, setSaved] = useState(false);
  const [lastTry, setLastTry] = useState<{ label: string; previous: Partial<Record<NumberField, string>> } | null>(null);
  const [section, setSection] = useState<WorkspaceSection>('assumptions');
  const [chartMode, setChartMode] = useState<ChartMode>('balance');
  const [activeAge, setActiveAge] = useState<number | null>(null);
  const [highlightedSpan, setHighlightedSpan] = useState<HighlightedSpan | null>(null);

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
  const eventChecks = events.map((d) => ({ key: d.key, event: toEvent(d), bad: Object.values(eventProblems(toEvent(d))).some(Boolean) }));
  const validEvents = eventChecks.filter((c) => !c.bad).map((c) => c.event);
  const unfinished = validEvents.length < draftEvents.length;
  const invalidPropIds = summary.properties
    .filter((p) => {
      const b = invalidProperty(p.id);
      return b.sellAge || b.rent;
    })
    .map((p) => p.id);
  const valid = !Object.values(invalid).some(Boolean) && invalidPropIds.length === 0 && !unfinished;

  // Live: the tiles and chart follow what's typed, falling back to the saved plan for anything invalid.
  const draft: RetirementPlan = {
    ...summary.plan,
    ...Object.fromEntries(FIELDS.map((f) => [f, invalid[f] ? summary.plan[f] : values[f]])),
    properties: validProperties,
    spendingChanges: validEvents,
  };
  const resolved = resolvePlan(draft, summary);
  const projection = resolved.inputs && projectRetirement(resolved.inputs);
  const cashFlow = resolved.inputs && retirementCashFlow(resolved.inputs);

  // Debounced live Monte Carlo rate for the headline KPI tile.
  const simKey = useDebouncedValue(resolved.inputs ? JSON.stringify(resolved.inputs) : '', 250);
  const liveSuccessRate = useMemo(() => {
    if (!simKey) return null;
    const parsed = JSON.parse(simKey) as RetirementInputs;
    return simulateRetirement(parsed, SIMULATION_DEFAULTS).successRate;
  }, [simKey]);

  const dirty =
    FIELDS.some((f) => values[f] !== summary.plan[f]) ||
    !sameSales(draftProperties, summary.plan.properties) ||
    !sameEvents(draftEvents, summary.plan.spendingChanges);

  const d = summary.defaults;
  const income = d.annualIncome;
  const yourIncome = d.yourIncome ?? null;
  const partnerMeta = d.partner ?? null;
  const hasPartner = !!(partnerMeta && partnerMeta.birthYear !== null && partnerMeta.currentAge !== null);
  const pName = partnerName(partnerMeta);
  const coupleSS =
    hasPartner && resolved.inputs && resolved.inputs.partner
      ? resolveCoupleSocialSecurity({
          married: d.married,
          yourBirthYear: d.birthYear!,
          yourIncome,
          yourRetireAge: resolved.inputs.retirementAge,
          yourOverrideAnnual: !invalid.socialSecurityAnnual ? values.socialSecurityAnnual : summary.plan.socialSecurityAnnual,
          yourClaimAge: resolved.inputs.socialSecurityAge,
          partnerBirthYear: partnerMeta!.birthYear!,
          partnerIncome: partnerMeta!.annualIncome,
          partnerRetireAge: resolved.inputs.partner.retirementAge,
          partnerOverrideAnnual: !invalid.partnerSocialSecurityAnnual
            ? values.partnerSocialSecurityAnnual
            : summary.plan.partnerSocialSecurityAnnual,
          partnerClaimAge: resolved.inputs.partner.socialSecurityAge,
        })
      : null;
  const ssEstimate =
    !hasPartner && resolved.inputs && income
      ? socialSecurityAtFullAge({ socialSecurityAnnual: null }, d, resolved.inputs.retirementAge).annual
      : null;

  function set(field: NumberField) {
    return (value: string) => {
      setSaved(false);
      setLastTry(null);
      setText((t) => ({ ...t, [field]: value }));
    };
  }

  function applyLever(patch: LeverPatch, label: string) {
    const previous: Partial<Record<NumberField, string>> = {};
    const updates: Partial<Record<NumberField, string>> = {};
    for (const [k, v] of Object.entries(patch) as [keyof LeverPatch, number | null | undefined][]) {
      if (v === undefined) continue;
      previous[k] = text[k];
      updates[k] = toText(k, v);
    }
    if (!Object.keys(updates).length) return;
    setSaved(false);
    setText((cur) => ({ ...cur, ...updates }));
    setLastTry({ label, previous });
  }

  function undoLever() {
    if (!lastTry) return;
    const { previous } = lastTry;
    setSaved(false);
    setText((cur) => ({ ...cur, ...previous }));
    setLastTry(null);
  }

  function stepAge(field: NumberField, fallback: number, min: number, max: number, delta: number) {
    const cur = values[field];
    const base = cur !== null && Number.isFinite(cur) ? cur : fallback;
    const next = Math.min(max, Math.max(min, Math.round(base + delta)));
    set(field)(String(next));
  }

  function setProperty(id: string, change: Partial<PropertyDraft>) {
    setSaved(false);
    setProperties((all) => {
      const current = all[id]!;
      // Turning a property on suggests selling it at retirement and opens it for review.
      const sellAge =
        change.on && !current.sellAge && resolved.inputs ? String(resolved.inputs.retirementAge) : (change.sellAge ?? current.sellAge);
      const open = change.open !== undefined ? change.open : change.on ? true : current.open;
      return { ...all, [id]: { ...current, ...change, sellAge, open } };
    });
  }

  function setEvent(key: number, change: Partial<EventDraft>) {
    // Opening or closing a row isn't an edit.
    if (Object.keys(change).some((k) => k !== 'open' && k !== 'sortAge')) setSaved(false);
    setEvents((all) => all.map((e) => (e.key === key ? { ...e, ...change } : e)));
  }

  function addEvents(list: EventSeed[]) {
    setSaved(false);
    // A single new event opens for editing; a batch (every child leaving home) stays tidy.
    setEvents((all) => [
      ...all,
      ...list.map((e) =>
        eventDraft(
          e,
          list.length === 1,
          list.length === 1
            ? Infinity
            : resolvedSortAge({ startAge: e.startAge ?? NaN, childId: e.childId ?? null }, d.children, d.birthYear, d.partner),
        ),
      ),
    ]);
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
          setLastTry(null);
          setEvents((all) =>
            all.map((e) => ({
              ...e,
              open: false,
              sortAge: resolvedSortAge(toEvent(e), d.children, d.birthYear, d.partner),
            })),
          );
          setProperties((all) =>
            Object.fromEntries(Object.entries(all).map(([id, p]) => [id, { ...p, open: false }])),
          );
        },
      },
    );
  }

  function toggleAccount(account: RetirementAccount, include: boolean) {
    const others = summary.plan.excludedAccountIds.filter((id) => id !== account.id);
    save.mutate({ ...summary.plan, excludedAccountIds: include ? others : [...others, account.id] });
  }

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

  // Valid life events converted to your ages while preserving each draft's key for timeline interaction.
  const timelineEvents: TimelineEventInput[] =
    d.birthYear === null
      ? []
      : eventChecks.flatMap((c) => {
          if (c.bad) return [];
          const [mine] = inYourAges([c.event], d.children, d.birthYear!, d.partner);
          return mine ? [{ ...mine, key: c.key }] : [];
        });

  const chartEvents: ProjectionEventMarker[] = timelineEvents;

  const appreciation = (!invalid.propertyAppreciation ? values.propertyAppreciation : null) ?? RETIREMENT_DEFAULTS.propertyAppreciation;
  const sellingCost = (!invalid.sellingCostPercent ? values.sellingCostPercent : null) ?? RETIREMENT_DEFAULTS.sellingCostPercent;

  const timelineProperties: TimelinePropertyInput[] =
    d.currentAge === null
      ? []
      : validProperties.flatMap((sale) => {
          const p = summary.properties.find((x) => x.id === sale.assetId);
          if (!p) return [];
          const mortgage = summary.mortgages.find((m) => m.id === sale.mortgageAccountId) ?? null;
          const age = Math.max(sale.sellAge, d.currentAge!);
          const proceeds = saleProceeds(p, mortgage, age - d.currentAge!, appreciation, sellingCost);
          return [{ assetId: p.id, name: p.name, sellAge: age, proceeds, netRentAnnual: sale.netRentAnnual ?? 0 }];
        });

  const assumptionsError =
    invalid.retirementAge ||
    invalid.lifeExpectancy ||
    invalid.annualContribution ||
    invalid.partnerRetirementAge ||
    invalid.partnerLifeExpectancy ||
    invalid.partnerAnnualContribution ||
    invalid.expectedReturn ||
    invalid.annualSpending ||
    invalid.spendingDeclinePercent ||
    invalid.socialSecurityAnnual ||
    invalid.socialSecurityAge ||
    invalid.partnerSocialSecurityAnnual ||
    invalid.partnerSocialSecurityAge ||
    invalid.pensionAnnual ||
    invalid.partnerPensionAnnual;
  const accountsError = invalid.otherSavings;
  const propertiesError = invalidPropIds.length > 0 || invalid.propertyAppreciation || invalid.sellingCostPercent;

  function jumpToFirstIssue() {
    if (assumptionsError) {
      setSection('assumptions');
    } else if (unfinished) {
      setSection('events');
      const firstBad = eventChecks.find((c) => c.bad);
      if (firstBad) setEvent(firstBad.key, { open: true });
    } else if (accountsError) {
      setSection('accounts');
    } else if (propertiesError) {
      setSection('properties');
      if (invalidPropIds[0]) setProperty(invalidPropIds[0], { open: true });
    }
  }

  const toggleableAccounts = summary.accounts.filter((a) => a.excludedReason !== 'education');
  const includedAccounts = toggleableAccounts.filter((a) => a.included).length;

  const sectionOptions: { id: WorkspaceSection; label: string; badge?: string; hasError?: boolean }[] = [
    { id: 'assumptions', label: 'Assumptions', hasError: assumptionsError },
    { id: 'events', label: 'Life events', badge: events.length ? String(events.length) : undefined, hasError: unfinished },
    {
      id: 'accounts',
      label: 'Accounts',
      badge: toggleableAccounts.length ? `${includedAccounts}/${toggleableAccounts.length}` : undefined,
      hasError: accountsError,
    },
    ...(summary.properties.length > 0
      ? [
          {
            id: 'properties' as const,
            label: 'Properties',
            badge: `${validProperties.length}/${summary.properties.length}`,
            hasError: propertiesError,
          },
        ]
      : []),
    ...(resolved.inputs ? [{ id: 'stress' as const, label: 'Stress test' }] : []),
    ...(resolved.inputs && summary.scenarios.length > 1
      ? [{ id: 'compare' as const, label: 'Compare', badge: String(summary.scenarios.length) }]
      : []),
  ];

  const activeSection: WorkspaceSection = sectionOptions.some((o) => o.id === section) ? section : 'assumptions';

  const effectiveContribution = !invalid.annualContribution ? values.annualContribution : summary.plan.annualContribution;
  const effectivePartnerContribution = !invalid.partnerAnnualContribution
    ? values.partnerAnnualContribution
    : summary.plan.partnerAnnualContribution;
  const combinedContribution = (effectiveContribution ?? 0) + (hasPartner ? (effectivePartnerContribution ?? 0) : 0);
  const effectiveSpending =
    (!invalid.annualSpending ? values.annualSpending : summary.plan.annualSpending) ?? d.annualSpending;
  const effectivePension = !invalid.pensionAnnual ? values.pensionAnnual : summary.plan.pensionAnnual;
  const effectivePartnerPension = !invalid.partnerPensionAnnual
    ? values.partnerPensionAnnual
    : summary.plan.partnerPensionAnnual;
  const retireFallback = Math.max(RETIREMENT_DEFAULTS.retirementAge, d.currentAge ?? RETIREMENT_DEFAULTS.retirementAge);
  const partnerRetireFallback = hasPartner
    ? Math.max(RETIREMENT_DEFAULTS.retirementAge, partnerMeta!.currentAge!)
    : RETIREMENT_DEFAULTS.retirementAge;
  const staggered = !!(
    resolved.inputs?.partner && resolved.inputs.retirementAge !== resolved.inputs.partner.retirementAgeInYours
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
      onJumpIssue={!valid ? jumpToFirstIssue : undefined}
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
        <ThemedText type="small" themeColor="textSecondary">
          · Projections rest on the assumptions you set, and are for planning, not professional financial advice.
        </ThemedText>
      </View>

      {resolved.inputs && projection ? (
        <Summary
          inputs={resolved.inputs}
          projection={projection}
          successRate={liveSuccessRate}
          onPressStress={() => setSection('stress')}
        />
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

      {resolved.inputs && projection && cashFlow && (
        <Card
          title={chartMode === 'balance' ? 'Projected savings' : 'Yearly cash flow'}
          tip={TIPS.projected}
          subtitle={
            chartMode === 'balance'
              ? staggered
                ? `Growing ${resolved.inputs.expectedReturn}% a year after inflation, bridging from ${firstRetireAge(resolved.inputs)} to ${fullRetireAge(resolved.inputs)}, then drawn down. Tap or hover for any year.`
                : `Growing ${resolved.inputs.expectedReturn}% a year after inflation, then drawn down from age ${resolved.inputs.retirementAge}. Tap or hover for any year.`
              : staggered
                ? 'What you save before retirement, bridge paychecks, and how spending is covered afterward. Tap or hover for any year.'
                : 'What you save before retirement, and how spending is covered afterward. Tap or hover for any year.'
          }
          action={
            <Segmented
              size="small"
              options={[
                { value: 'balance', label: 'Balance' },
                { value: 'cashflow', label: 'Cash flow' },
              ]}
              value={chartMode}
              onChange={setChartMode}
            />
          }>
          {chartMode === 'balance' ? (
            <RetirementProjection
              points={projection.points}
              retirementAge={resolved.inputs.retirementAge}
              socialSecurityAge={resolved.inputs.socialSecurityAnnual > 0 ? resolved.inputs.socialSecurityAge : null}
              partner={resolved.inputs.partner ?? null}
              sales={projection.sales}
              events={chartEvents}
              cashFlow={cashFlow}
              activeAge={activeAge}
              onActiveAgeChange={setActiveAge}
              highlightedSpan={highlightedSpan}
            />
          ) : (
            <RetirementCashFlow
              rows={cashFlow}
              retirementAge={resolved.inputs.retirementAge}
              partner={resolved.inputs.partner ?? null}
              sales={projection.sales}
              events={chartEvents}
              activeAge={activeAge}
              onActiveAgeChange={setActiveAge}
              highlightedSpan={highlightedSpan}
            />
          )}
          <RetirementTimeline
            inputs={resolved.inputs}
            events={timelineEvents}
            properties={timelineProperties}
            activeAge={activeAge}
            onHoverAge={setActiveAge}
            onHighlight={setHighlightedSpan}
            onSelectEvent={(key) => {
              setSection('events');
              setEvents((all) => all.map((e) => (e.key === key ? { ...e, open: true } : e)));
            }}
            onSelectProperty={(assetId) => {
              setSection('properties');
              setProperties((all) => ({ ...all, [assetId]: { ...all[assetId]!, open: true } }));
            }}
            onSelectAssumptions={() => setSection('assumptions')}
            onAddEvent={() => {
              setSection('events');
              addEvents([{}]);
            }}
          />
        </Card>
      )}

      {resolved.inputs && projection && (
        <RetirementLevers
          inputs={resolved.inputs}
          plan={{
            socialSecurityAnnual: draft.socialSecurityAnnual,
            partnerSocialSecurityAnnual: draft.partnerSocialSecurityAnnual,
            partnerRetirementAge: draft.partnerRetirementAge,
            partnerSocialSecurityAge: draft.partnerSocialSecurityAge,
          }}
          defaults={d}
          appliedTry={lastTry?.label ?? null}
          onTry={applyLever}
          onUndoTry={undoLever}
        />
      )}

      {resolved.inputs && projection && (
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
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.workspaceTabs}>
        {sectionOptions.map((opt) => {
          const selected = opt.id === activeSection;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setSection(opt.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={({ hovered, pressed }) => [
                styles.workspaceTab,
                {
                  backgroundColor: selected ? theme.tint : hovered ? theme.backgroundSelected : theme.backgroundElement,
                  borderColor: selected ? theme.tint : theme.border,
                },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: selected ? '#ffffff' : theme.text }}>
                {opt.label}
              </ThemedText>
              {opt.badge && (
                <View
                  style={[
                    styles.tabBadge,
                    { backgroundColor: selected ? 'rgba(255,255,255,0.22)' : theme.backgroundSelected },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{
                      color: selected ? '#ffffff' : theme.textSecondary,
                      fontSize: 12,
                      lineHeight: 16,
                      fontVariant: ['tabular-nums'],
                    }}>
                    {opt.badge}
                  </ThemedText>
                </View>
              )}
              {opt.hasError && (
                <View
                  style={[
                    styles.errorDot,
                    { backgroundColor: selected ? '#ffffff' : theme.negative },
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {activeSection === 'assumptions' && (
        <View style={styles.columns}>
          <View style={[styles.column, styles.side]}>
            <Card title="The basics" subtitle="Leave a field empty to use the suggestion in it.">
              {hasPartner ? (
                <>
                  <ThemedText type="smallBold">You</ThemedText>
                  <Row>
                    <Field label="Retire at age" invalid={invalid.retirementAge} tip={TIPS.retirementAge}>
                      <AgeStepper
                        value={text.retirementAge}
                        onChangeText={set('retirementAge')}
                        onStep={(delta) => stepAge('retirementAge', retireFallback, 18, 100, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.retirementAge)}
                        accessibilityLabel="Retire at age"
                      />
                    </Field>
                    <Field label="Plan to age" invalid={invalid.lifeExpectancy} tip={TIPS.planToAge}>
                      <AgeStepper
                        value={text.lifeExpectancy}
                        onChangeText={set('lifeExpectancy')}
                        onStep={(delta) => stepAge('lifeExpectancy', RETIREMENT_DEFAULTS.lifeExpectancy, 50, 120, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.lifeExpectancy)}
                        accessibilityLabel="Plan to age"
                      />
                    </Field>
                  </Row>
                  <Row>
                    <Field label="Your saving per year" invalid={invalid.annualContribution} tip={TIPS.contribution}>
                      <Input
                        value={text.annualContribution}
                        onChangeText={set('annualContribution')}
                        placeholder={yourIncome ? `$0 · 15% is ${formatCompactCurrency(yourIncome * 0.15)}` : '$0'}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                      />
                      {effectiveContribution !== null && effectiveContribution > 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatWholeCurrency(Math.round(effectiveContribution / 12))}/mo
                          {yourIncome ? ` · ${Math.round((effectiveContribution / yourIncome) * 100)}% of your income` : ''}
                        </ThemedText>
                      )}
                    </Field>
                    <Field label="Return after inflation, %" invalid={invalid.expectedReturn} tip={TIPS.expectedReturn}>
                      <Input
                        value={text.expectedReturn}
                        onChangeText={set('expectedReturn')}
                        placeholder={String(RETIREMENT_DEFAULTS.expectedReturn)}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                      />
                    </Field>
                  </Row>

                  <View style={[styles.sectionDivider, { borderTopColor: theme.border }]}>
                    <ThemedText type="smallBold">{pName}</ThemedText>
                    <Row>
                      <Field label={`${pName} retires at age`} invalid={invalid.partnerRetirementAge} tip={TIPS.retirementAge}>
                        <AgeStepper
                          value={text.partnerRetirementAge}
                          onChangeText={set('partnerRetirementAge')}
                          onStep={(delta) => stepAge('partnerRetirementAge', partnerRetireFallback, 18, 100, delta)}
                          placeholder={String(RETIREMENT_DEFAULTS.retirementAge)}
                          accessibilityLabel={`${pName} retires at age`}
                        />
                      </Field>
                      <Field label={`${pName} plans to age`} invalid={invalid.partnerLifeExpectancy} tip={TIPS.planToAge}>
                        <AgeStepper
                          value={text.partnerLifeExpectancy}
                          onChangeText={set('partnerLifeExpectancy')}
                          onStep={(delta) => stepAge('partnerLifeExpectancy', RETIREMENT_DEFAULTS.lifeExpectancy, 50, 120, delta)}
                          placeholder={String(RETIREMENT_DEFAULTS.lifeExpectancy)}
                          accessibilityLabel={`${pName} plans to age`}
                        />
                      </Field>
                    </Row>
                    <Field label={`${pName}’s saving per year`} invalid={invalid.partnerAnnualContribution} tip={TIPS.contribution}>
                      <Input
                        value={text.partnerAnnualContribution}
                        onChangeText={set('partnerAnnualContribution')}
                        placeholder={
                          partnerMeta!.annualIncome
                            ? `$0 · 15% is ${formatCompactCurrency(partnerMeta!.annualIncome * 0.15)}`
                            : '$0'
                        }
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                      />
                      {effectivePartnerContribution !== null && effectivePartnerContribution > 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatWholeCurrency(Math.round(effectivePartnerContribution / 12))}/mo
                          {partnerMeta!.annualIncome
                            ? ` · ${Math.round((effectivePartnerContribution / partnerMeta!.annualIncome) * 100)}% of ${pName}’s income`
                            : ''}
                        </ThemedText>
                      )}
                    </Field>
                  </View>

                  {combinedContribution > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Combined saving while both work: {formatWholeCurrency(Math.round(combinedContribution / 12))}/mo
                      {income ? ` · ${Math.round((combinedContribution / income) * 100)}% of household income` : ''}
                    </ThemedText>
                  )}

                  {staggered &&
                    resolved.inputs?.partner &&
                    (() => {
                      const rp = resolved.inputs!.partner!;
                      const firstR = firstRetireAge(resolved.inputs!);
                      const fullR = fullRetireAge(resolved.inputs!);
                      const youFirst = resolved.inputs!.retirementAge < rp.retirementAgeInYours;
                      const workingName = youFirst ? pName : 'You';
                      const workingGross = youFirst ? partnerMeta!.annualIncome : yourIncome;
                      const workingNet = youFirst ? rp.bridgeIncomeAnnual : (resolved.inputs!.bridgeIncomeAnnual ?? 0);
                      const shift = partnerMeta!.birthYear! - d.birthYear!;
                      return (
                        <View
                          style={[
                            styles.bridgeNote,
                            { backgroundColor: theme.background, borderColor: theme.border },
                          ]}>
                          <View style={styles.bridgeHead}>
                            <WithTip tip={TIPS.bridgeYears}>
                              <ThemedText type="smallBold">Bridge years</ThemedText>
                            </WithTip>
                            <ThemedText type="small" themeColor="textSecondary">
                              Your ages {firstR}–{fullR} ({pName} {firstR - shift}–{fullR - shift})
                            </ThemedText>
                          </View>
                          {workingGross === null ? (
                            <View style={styles.missing}>
                              <ThemedText type="small" themeColor="textSecondary">
                                {workingName} {youFirst ? 'keeps' : 'keep'} working while{' '}
                                {youFirst ? 'you’re' : `${pName} is`} retired. Add{' '}
                                {youFirst ? `${pName}’s` : 'your'} income on your profile so Meld counts{' '}
                                {youFirst ? 'their' : 'your'} paycheck during those years.
                              </ThemedText>
                              <Button label="Add income" variant="secondary" size="small" onPress={onShowProfile} />
                            </View>
                          ) : workingNet > 0 ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {workingName} {youFirst ? 'keeps' : 'keep'} working: counts{' '}
                              {formatWholeCurrency(workingNet)}/yr estimated after-tax pay toward spending before
                              tapping savings.
                            </ThemedText>
                          ) : (
                            <ThemedText type="small" themeColor="textSecondary">
                              {workingName} {youFirst ? 'has' : 'have'} $0 income on your profile, so household spending
                              draws from savings during these years.
                            </ThemedText>
                          )}
                        </View>
                      );
                    })()}
                </>
              ) : (
                <>
                  <Row>
                    <Field label="Retire at age" invalid={invalid.retirementAge} tip={TIPS.retirementAge}>
                      <AgeStepper
                        value={text.retirementAge}
                        onChangeText={set('retirementAge')}
                        onStep={(delta) => stepAge('retirementAge', retireFallback, 18, 100, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.retirementAge)}
                        accessibilityLabel="Retire at age"
                      />
                    </Field>
                    <Field label="Plan to age" invalid={invalid.lifeExpectancy} tip={TIPS.planToAge}>
                      <AgeStepper
                        value={text.lifeExpectancy}
                        onChangeText={set('lifeExpectancy')}
                        onStep={(delta) => stepAge('lifeExpectancy', RETIREMENT_DEFAULTS.lifeExpectancy, 50, 120, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.lifeExpectancy)}
                        accessibilityLabel="Plan to age"
                      />
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
                      {effectiveContribution !== null && effectiveContribution > 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatWholeCurrency(Math.round(effectiveContribution / 12))}/mo
                          {income ? ` · ${Math.round((effectiveContribution / income) * 100)}% of income` : ''}
                        </ThemedText>
                      )}
                    </Field>
                    <Field label="Return after inflation, %" invalid={invalid.expectedReturn} tip={TIPS.expectedReturn}>
                      <Input
                        value={text.expectedReturn}
                        onChangeText={set('expectedReturn')}
                        placeholder={String(RETIREMENT_DEFAULTS.expectedReturn)}
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                      />
                    </Field>
                  </Row>
                  {(partnerMeta && partnerMeta.birthYear === null) || (d.married && !partnerMeta) ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {partnerMeta && partnerMeta.birthYear === null
                        ? `Add ${pName}’s birth year `
                        : 'Planning with a partner? Add them '}
                      <ThemedText
                        type="small"
                        themeColor="tint"
                        accessibilityRole="link"
                        onPress={onShowProfile}>
                        on your profile
                      </ThemedText>{' '}
                      for staggered retirement and separate Social Security.
                    </ThemedText>
                  ) : null}
                </>
              )}
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
                  {effectiveSpending !== null && effectiveSpending > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatWholeCurrency(Math.round(effectiveSpending / 12))}/mo
                      {values.annualSpending === null && d.annualSpending !== null ? ' · from last 12 months' : ''}
                    </ThemedText>
                  )}
                </Field>
                <Field
                  label={`Slows after ${SPENDING_DECLINE_AGE}, % a year`}
                  invalid={invalid.spendingDeclinePercent}
                  tip={TIPS.spendingDecline}>
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
                Expect a change, like a paid-off mortgage or kids leaving home?{' '}
                <ThemedText
                  type="small"
                  themeColor="tint"
                  accessibilityRole="link"
                  onPress={() => setSection('events')}>
                  Add it under Life events
                </ThemedText>
                .
              </ThemedText>
            </Card>
          </View>

          <View style={[styles.column, styles.side]}>
            <Card title="Income in retirement" subtitle="Money that comes in without selling investments.">
              {hasPartner && resolved.inputs && resolved.inputs.partner && coupleSS ? (
                <>
                  <ThemedText type="smallBold">Your Social Security</ThemedText>
                  <Row>
                    <Field label="Your Social Security / mo" invalid={invalid.socialSecurityAnnual} tip={TIPS.socialSecurity}>
                      <Input
                        value={text.socialSecurityAnnual}
                        onChangeText={set('socialSecurityAnnual')}
                        placeholder={
                          coupleSS.yours.estimated
                            ? `${formatWholeCurrency(coupleSS.yours.fullAnnual / 12)} · estimated`
                            : '$ · from your statement'
                        }
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                      />
                    </Field>
                    <Field label="Start at age" invalid={invalid.socialSecurityAge} tip={TIPS.claimAge}>
                      <AgeStepper
                        value={text.socialSecurityAge}
                        onChangeText={set('socialSecurityAge')}
                        onStep={(delta) => stepAge('socialSecurityAge', RETIREMENT_DEFAULTS.socialSecurityAge, 62, 70, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.socialSecurityAge)}
                        accessibilityLabel="Your Social Security start age"
                        maxLength={2}
                      />
                    </Field>
                  </Row>
                  <SocialSecurity
                    birthYear={d.birthYear!}
                    claimAge={resolved.inputs.socialSecurityAge}
                    fullAnnual={{
                      annual: coupleSS.yours.ownFullAnnual,
                      spousalExcess: coupleSS.yours.spousalExcessAnnual,
                      estimated: coupleSS.yours.estimated,
                    }}
                    income={yourIncome}
                    married={d.married}
                    retirementAge={resolved.inputs.retirementAge}
                    otherName={pName}
                    hasPartner
                    onClaimAge={(age) => set('socialSecurityAge')(String(age))}
                    onShowProfile={onShowProfile}
                  />

                  <View style={[styles.sectionDivider, { borderTopColor: theme.border }]}>
                    <ThemedText type="smallBold">{pName}’s Social Security</ThemedText>
                    <Row>
                      <Field
                        label={`${pName}’s Social Security / mo`}
                        invalid={invalid.partnerSocialSecurityAnnual}
                        tip={TIPS.socialSecurity}>
                        <Input
                          value={text.partnerSocialSecurityAnnual}
                          onChangeText={set('partnerSocialSecurityAnnual')}
                          placeholder={
                            coupleSS.partner.estimated
                              ? `${formatWholeCurrency(coupleSS.partner.fullAnnual / 12)} · estimated`
                              : `$ · from ${pName}’s statement`
                          }
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                        />
                      </Field>
                      <Field label="Start at age" invalid={invalid.partnerSocialSecurityAge} tip={TIPS.claimAge}>
                        <AgeStepper
                          value={text.partnerSocialSecurityAge}
                          onChangeText={set('partnerSocialSecurityAge')}
                          onStep={(delta) =>
                            stepAge('partnerSocialSecurityAge', RETIREMENT_DEFAULTS.socialSecurityAge, 62, 70, delta)
                          }
                          placeholder={String(RETIREMENT_DEFAULTS.socialSecurityAge)}
                          accessibilityLabel={`${pName}’s Social Security start age`}
                          maxLength={2}
                        />
                      </Field>
                    </Row>
                    <SocialSecurity
                      birthYear={partnerMeta!.birthYear!}
                      claimAge={resolved.inputs.partner.socialSecurityAge}
                      fullAnnual={{
                        annual: coupleSS.partner.ownFullAnnual,
                        spousalExcess: coupleSS.partner.spousalExcessAnnual,
                        estimated: coupleSS.partner.estimated,
                      }}
                      income={partnerMeta!.annualIncome}
                      married={d.married}
                      retirementAge={resolved.inputs.partner.retirementAge}
                      personLabel={`${pName}’s`}
                      otherName="you"
                      hasPartner
                      onClaimAge={(age) => set('partnerSocialSecurityAge')(String(age))}
                      onShowProfile={onShowProfile}
                    />
                  </View>

                  {resolved.inputs.socialSecurityAnnual > 0 && resolved.inputs.partner.socialSecurityAnnual > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Combined when both are claiming:{' '}
                      {formatWholeCurrency(
                        Math.round(
                          (resolved.inputs.socialSecurityAnnual + resolved.inputs.partner.socialSecurityAnnual) / 12,
                        ),
                      )}
                      /mo (
                      {formatWholeCurrency(
                        resolved.inputs.socialSecurityAnnual + resolved.inputs.partner.socialSecurityAnnual,
                      )}
                      /yr)
                    </ThemedText>
                  )}

                  <View style={[styles.sectionDivider, { borderTopColor: theme.border }]}>
                    <Row>
                      <Field label="Your pension / yr" invalid={invalid.pensionAnnual} tip={TIPS.pension}>
                        <Input
                          value={text.pensionAnnual}
                          onChangeText={set('pensionAnnual')}
                          placeholder="$0"
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                        />
                        {effectivePension !== null && effectivePension > 0 && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {formatWholeCurrency(Math.round(effectivePension / 12))}/mo
                          </ThemedText>
                        )}
                      </Field>
                      <Field label={`${pName}’s pension / yr`} invalid={invalid.partnerPensionAnnual} tip={TIPS.pension}>
                        <Input
                          value={text.partnerPensionAnnual}
                          onChangeText={set('partnerPensionAnnual')}
                          placeholder="$0"
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                        />
                        {effectivePartnerPension !== null && effectivePartnerPension > 0 && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {formatWholeCurrency(Math.round(effectivePartnerPension / 12))}/mo
                          </ThemedText>
                        )}
                      </Field>
                    </Row>
                  </View>
                </>
              ) : (
                <>
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
                      <AgeStepper
                        value={text.socialSecurityAge}
                        onChangeText={set('socialSecurityAge')}
                        onStep={(delta) => stepAge('socialSecurityAge', RETIREMENT_DEFAULTS.socialSecurityAge, 62, 70, delta)}
                        placeholder={String(RETIREMENT_DEFAULTS.socialSecurityAge)}
                        accessibilityLabel="Social Security start age"
                        maxLength={2}
                      />
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
                    <Input
                      value={text.pensionAnnual}
                      onChangeText={set('pensionAnnual')}
                      placeholder="$0"
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                    />
                    {effectivePension !== null && effectivePension > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatWholeCurrency(Math.round(effectivePension / 12))}/mo
                      </ThemedText>
                    )}
                  </Field>
                </>
              )}
            </Card>
          </View>
        </View>
      )}

      {activeSection === 'events' && (
        <LifeEvents
          drafts={events}
          inputs={resolved.inputs}
          kids={d.children}
          birthYear={d.birthYear}
          partner={d.partner}
          suggestions={suggestions}
          onAdd={addEvents}
          onChange={setEvent}
          onRemove={removeEvent}
          onShowProfile={onShowProfile}
        />
      )}

      {activeSection === 'accounts' && (
        <RetirementAccounts
          summary={summary}
          otherSavings={draft.otherSavings}
          onToggle={toggleAccount}
          disabled={save.isPending}
          otherSavingsField={
            <Field label="Other savings for retirement" invalid={invalid.otherSavings} tip={TIPS.otherSavings}>
              <Input
                value={text.otherSavings}
                onChangeText={set('otherSavings')}
                placeholder="$0 · e.g. cash set aside"
                keyboardType="decimal-pad"
                inputMode="decimal"
              />
            </Field>
          }
        />
      )}

      {activeSection === 'properties' && (
        <RetirementProperties
          summary={summary}
          properties={properties}
          invalidProperty={invalidProperty}
          appreciationText={text.propertyAppreciation}
          sellingCostText={text.sellingCostPercent}
          invalidAppreciation={invalid.propertyAppreciation}
          invalidSellingCost={invalid.sellingCostPercent}
          appreciation={appreciation}
          sellingCost={sellingCost}
          birthYear={d.birthYear}
          currentAge={d.currentAge}
          retirementAge={resolved.inputs?.retirementAge ?? retireFallback}
          onChangeProperty={setProperty}
          onChangeAppreciation={set('propertyAppreciation')}
          onChangeSellingCost={set('sellingCostPercent')}
        />
      )}

      {activeSection === 'stress' && resolved.inputs && (
        <MonteCarlo scenarioId={summary.scenario.id} inputs={resolved.inputs} dirty={dirty} />
      )}

      {activeSection === 'compare' && resolved.inputs && summary.scenarios.length > 1 && (
        <ScenarioCompare summary={summary} draft={draft} dirty={dirty} onSelect={onSelectScenario} />
      )}

      {Platform.OS === 'web' && saveBar}
    </>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.one, rowGap: Spacing.half },
  missing: { gap: Spacing.two, alignItems: 'flex-start' },
  workspaceTabs: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 2 },
  workspaceTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  tabBadge: { paddingHorizontal: Spacing.one + Spacing.half, paddingVertical: 1, borderRadius: Spacing.three },
  errorDot: { width: 7, height: 7, borderRadius: 4 },
  pressed: { opacity: 0.75 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0 },
  side: { gap: Spacing.three },
  sectionDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.three },
  bridgeNote: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.two + Spacing.half, gap: Spacing.one + Spacing.half },
  bridgeHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
