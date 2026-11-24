import {
  childName,
  inYourAges,
  SpendingChange,
  type Child,
  type LifeEventKind,
  type RetirementInputs,
} from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon, type IconName } from '@/components/icon';
import { InfoTip } from '@/components/info-tip';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';

/** One life event, as typed. `amount` is unsigned (per month when `monthly`); `less` makes it negative. */
export type EventDraft = {
  /** Keeps rows stable while editing. */
  key: number;
  kind: LifeEventKind;
  label: string;
  childId: string | null;
  startAge: string;
  endAge: string;
  amount: string;
  less: boolean;
  monthly: boolean;
  /** Showing its form rather than its summary. */
  open: boolean;
  /** Display-order snapshot (in your ages) so editing an open event never jumps mid-keystroke. */
  sortAge?: number;
};

/** An event to start from; `less` points a blank amount down. */
export type EventSeed = Partial<SpendingChange> & { less?: boolean };

/** A one-tap event to add; ages and amounts may be left for the user. */
export type Suggestion = { id: string; caption: string; events: EventSeed[] };

const KINDS: { kind: LifeEventKind; label: string; icon: IconName; accent: Accent }[] = [
  { kind: 'spending', label: 'Spending', icon: 'receipt', accent: 'orange' },
  { kind: 'income', label: 'Income', icon: 'wallet', accent: 'green' },
  { kind: 'saving', label: 'Saving', icon: 'bank', accent: 'blue' },
  { kind: 'once', label: 'One-time', icon: 'flag', accent: 'purple' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<LifeEventKind, (typeof KINDS)[number]>;

const KIND_TIPS = {
  spending: TIPS.spendingEvent,
  income: TIPS.incomeEvent,
  saving: TIPS.savingEvent,
  once: TIPS.onceEvent,
} as const;

/** The two directions an amount can go, in each kind's words. */
const DIRECTIONS: Record<LifeEventKind, [more: string, less: string]> = {
  spending: ['Spend more', 'Spend less'],
  income: ['More income', 'Less income'],
  saving: ['Save more', 'Save less'],
  once: ['Money in', 'Money out'],
};

const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (s: string) => (s.trim() ? Number(s.replace(/[$,%\s]/g, '')) : null);
const cents = (v: number) => Math.round(v * 100) / 100;

/** Resolves a draft's start age into your age for chronological sorting without changing array order. */
export function resolvedSortAge(e: Pick<SpendingChange, 'startAge' | 'childId'>, children: Child[], birthYear: number | null): number {
  if (!Number.isFinite(e.startAge)) return Infinity;
  if (e.childId === null || birthYear === null) return e.startAge;
  const child = children.find((k) => k.id === e.childId);
  return child ? e.startAge + (child.birthYear - birthYear) : e.startAge;
}

let nextKey = 0;
export function eventDraft(c: EventSeed, open = false, sortAge?: number): EventDraft {
  const kind = c.kind ?? 'spending';
  const monthly = kind !== 'once' && (c.monthly ?? false);
  const amount = c.annualChange === undefined ? null : Math.abs(monthly ? cents(c.annualChange / 12) : c.annualChange);
  return {
    key: nextKey++,
    kind,
    label: c.label ?? '',
    childId: c.childId ?? null,
    startAge: str(c.startAge),
    endAge: str(c.endAge),
    amount: str(amount),
    less: c.less ?? (c.annualChange ?? 0) < 0,
    monthly,
    open,
    sortAge: sortAge ?? (open ? Infinity : (c.startAge ?? Infinity)),
  };
}

/** The event a draft describes; NaN where a number is missing or unreadable. */
export function toEvent(d: EventDraft): SpendingChange {
  const once = d.kind === 'once';
  const amount = Math.abs(num(d.amount) ?? NaN);
  return {
    label: d.label.trim(),
    kind: d.kind,
    childId: d.childId,
    startAge: num(d.startAge) ?? NaN,
    endAge: once ? null : num(d.endAge),
    annualChange: (d.less ? -1 : 1) * amount * (d.monthly && !once ? 12 : 1),
    monthly: d.monthly && !once,
  };
}

export type EventProblems = { label: boolean; startAge: boolean; endAge: boolean; annualChange: boolean };

export function eventProblems(e: SpendingChange): EventProblems {
  return {
    label: !SpendingChange.shape.label.safeParse(e.label).success,
    startAge: !SpendingChange.shape.startAge.safeParse(e.startAge).success,
    endAge: !SpendingChange.shape.endAge.safeParse(e.endAge).success || (e.endAge !== null && e.endAge <= e.startAge),
    annualChange: !Number.isFinite(e.annualChange),
  };
}

/** Order-sensitive, as the list is shown in the order it was made. */
export const sameEvents = (a: SpendingChange[], b: SpendingChange[]) => {
  const key = (list: SpendingChange[]) =>
    JSON.stringify(list.map((c) => [c.label, c.kind ?? 'spending', c.childId, c.startAge, c.endAge, c.annualChange, c.monthly]));
  return key(a) === key(b);
};

/** Everyday events anyone might plan for, beyond the ones Meld can see coming. */
export function commonEvents(inputs: RetirementInputs | null, children: Child[], birthYear: number | null): Suggestion[] {
  const retire = inputs?.retirementAge ?? 65;
  const now = inputs?.currentAge ?? 0;
  const out: Suggestion[] = [];
  if (birthYear !== null) {
    for (const k of children) {
      const yourAge = 18 + k.birthYear - birthYear;
      if (yourAge + 4 <= now) continue;
      const working = yourAge < retire;
      out.push({
        id: `college-${k.id}`,
        caption: `College for ${childName(children, k.id)}`,
        events: [
          working
            ? { label: `College for ${childName(children, k.id)}`, kind: 'saving', childId: k.id, startAge: 18, endAge: 22, annualChange: -25_000 }
            : { label: `College for ${childName(children, k.id)}`, kind: 'spending', childId: k.id, startAge: 18, endAge: 22, annualChange: 25_000 },
        ],
      });
    }
  }
  if (retire < 65 && retire >= now) {
    out.push({
      id: 'health',
      caption: 'Health insurance until Medicare',
      events: [{ label: 'Health insurance until Medicare', kind: 'spending', startAge: retire, endAge: 65, annualChange: 12_000 }],
    });
  }
  out.push(
    {
      id: 'travel',
      caption: 'Travel early in retirement',
      events: [{ label: 'Travel', kind: 'spending', startAge: retire, endAge: retire + 10, annualChange: 10_000 }],
    },
    {
      id: 'part-time',
      caption: 'Part-time work in retirement',
      events: [{ label: 'Part-time work', kind: 'income', startAge: retire, endAge: retire + 5, annualChange: 24_000 }],
    },
  );
  if (retire > 50 && now < retire) {
    out.push({
      id: 'catch-up',
      caption: 'Catch-up contributions at 50',
      events: [{ label: 'Catch-up contributions', kind: 'saving', startAge: Math.max(50, now), endAge: null, annualChange: 7_500 }],
    });
  }
  out.push(
    { id: 'inheritance', caption: 'Inheritance', events: [{ label: 'Inheritance', kind: 'once' }] },
    { id: 'purchase', caption: 'Big purchase', events: [{ label: 'Big purchase', kind: 'once', less: true }] },
    { id: 'care', caption: 'Care late in life', events: [{ label: 'Care late in life', kind: 'spending', startAge: 85, endAge: 88, annualChange: 60_000 }] },
  );
  return out;
}

/** The plan's life events: chronological display, kind filters, scannable pills, and quick-add ideas. */
export function LifeEvents({
  drafts,
  inputs,
  kids: children,
  birthYear,
  suggestions,
  onAdd,
  onChange,
  onRemove,
  onShowProfile,
}: {
  drafts: EventDraft[];
  inputs: RetirementInputs | null;
  kids: Child[];
  birthYear: number | null;
  suggestions: Suggestion[];
  onAdd: (events: EventSeed[]) => void;
  onChange: (key: number, change: Partial<EventDraft>) => void;
  onRemove: (key: number) => void;
  onShowProfile: () => void;
}) {
  const theme = useTheme();
  const [cardWidth, setCardWidth] = useState(0);
  const [kindFilter, setKindFilter] = useState<'all' | LifeEventKind>('all');
  const [quickOpen, setQuickOpen] = useState(drafts.length < 4);
  const narrow = cardWidth > 0 && cardWidth < 560;

  const labels = new Set(drafts.map((d) => d.label.trim()));
  const common = commonEvents(inputs, children, birthYear).filter((s) => !s.events.every((e) => labels.has(e.label ?? '')));
  const totalSuggestions = suggestions.length + common.length;

  const activeFilter =
    kindFilter !== 'all' && !drafts.some((d) => d.kind === kindFilter) ? 'all' : kindFilter;

  const displayed = [...drafts]
    .filter((d) => activeFilter === 'all' || d.kind === activeFilter)
    .sort((a, b) => (a.sortAge ?? Infinity) - (b.sortAge ?? Infinity) || a.key - b.key);

  const showQuickAdd = drafts.length < 4 || quickOpen;

  return (
    <Card
      title="Life events"
      tip={TIPS.lifeEvents}
      subtitle="Changes you can see coming. Each one shows up in the projection as soon as you add it."
      action={<Button label="Add your own" variant="secondary" size="small" onPress={() => onAdd([{}])} />}>
      <View onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)} style={styles.cardInner}>
      {drafts.length >= 4 && (
        <View style={styles.chips}>
          <Chip label={`All (${drafts.length})`} selected={activeFilter === 'all'} onPress={() => setKindFilter('all')} />
          {KINDS.map((k) => {
            const count = drafts.filter((d) => d.kind === k.kind).length;
            if (count === 0) return null;
            return (
              <Chip
                key={k.kind}
                label={`${k.label} (${count})`}
                selected={activeFilter === k.kind}
                onPress={() => setKindFilter(k.kind)}
              />
            );
          })}
        </View>
      )}

      {drafts.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No life events yet. Start from an idea below, or tap “Add your own”.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {displayed.map((d) => (
            <EventRow
              key={d.key}
              draft={d}
              narrow={narrow}
              inputs={inputs}
              kids={children}
              birthYear={birthYear}
              onChange={(change) => onChange(d.key, change)}
              onRemove={() => onRemove(d.key)}
            />
          ))}
        </View>
      )}

      <View style={[styles.add, { borderTopColor: theme.border }]}>
        {drafts.length >= 4 && totalSuggestions > 0 && (
          <Pressable
            onPress={() => setQuickOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showQuickAdd }}
            style={styles.quickHeader}>
            <ThemedText type="smallBold">
              Quick-add ideas ({totalSuggestions})
            </ThemedText>
            <Icon name={showQuickAdd ? 'chevronUp' : 'chevronDown'} size={16} themeColor="textSecondary" />
          </Pressable>
        )}

        {showQuickAdd && (
          <>
            {suggestions.length > 0 && (
              <SuggestionGroup title="From your accounts and profile" suggestions={suggestions} onAdd={onAdd} />
            )}
            <SuggestionGroup title="Common events" suggestions={common} onAdd={onAdd} />
            {children.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                Have kids?{' '}
                <ThemedText type="small" themeColor="tint" onPress={onShowProfile} accessibilityRole="link">
                  Add them to your profile
                </ThemedText>{' '}
                to time events by their ages.
              </ThemedText>
            )}
          </>
        )}
      </View>
      </View>
    </Card>
  );
}

function SuggestionGroup({
  title,
  suggestions,
  onAdd,
}: {
  title: string;
  suggestions: Suggestion[];
  onAdd: (events: EventSeed[]) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.group}>
      <ThemedText type="small" themeColor="textSecondary">
        {title}
      </ThemedText>
      <View style={styles.chips}>
        {suggestions.map((s) => (
          <Chip key={s.id} label={`+ ${s.caption}`} onPress={() => onAdd(s.events)} />
        ))}
      </View>
    </View>
  );
}

function formatImpactPill(e: SpendingChange): string {
  const amt = formatWholeCurrency(Math.abs(e.monthly ? e.annualChange / 12 : e.annualChange));
  const sign = e.annualChange < 0 ? '−' : '+';
  if (e.kind === 'once') return `${sign}${amt} once`;
  return `${sign}${amt}/${e.monthly ? 'mo' : 'yr'}`;
}

function formatTimingLine(e: SpendingChange, children: Child[], birthYear: number | null): string {
  const child = e.childId === null ? null : children.find((k) => k.id === e.childId);
  if (child) {
    const startYear = child.birthYear + e.startAge;
    const yourStart = birthYear === null ? null : startYear - birthYear;
    const childPrefix = `${childName(children, child.id)} is ${e.startAge}`;
    if (e.kind === 'once') {
      return `When ${childPrefix} (${yourStart !== null ? `you’re ${yourStart}, ` : ''}${startYear})`;
    }
    const span = e.endAge === null ? `${childPrefix}+` : `${childName(children, child.id)} ${e.startAge}–${e.endAge}`;
    return yourStart !== null
      ? `When ${span} (you’re ${yourStart}${e.endAge !== null ? `–${child.birthYear + e.endAge - birthYear!}` : ''}, ${startYear})`
      : `When ${span} (${startYear})`;
  }
  const calStart = birthYear === null ? null : birthYear + e.startAge;
  if (e.kind === 'once') return calStart !== null ? `At age ${e.startAge} (${calStart})` : `At age ${e.startAge}`;
  if (e.endAge === null) return calStart !== null ? `Age ${e.startAge}+ (${calStart})` : `Age ${e.startAge}+`;
  return calStart !== null
    ? `Ages ${e.startAge}–${e.endAge} (${calStart}–${birthYear! + e.endAge})`
    : `Ages ${e.startAge}–${e.endAge}`;
}

function EventRow({
  draft: d,
  narrow,
  inputs,
  kids: children,
  birthYear,
  onChange,
  onRemove,
}: {
  draft: EventDraft;
  narrow: boolean;
  inputs: RetirementInputs | null;
  kids: Child[];
  birthYear: number | null;
  onChange: (change: Partial<EventDraft>) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const accent = useAccents()[KIND[d.kind].accent];
  const event = toEvent(d);
  const bad = eventProblems(event);
  const flag = {
    label: bad.label && !!d.label.trim(),
    startAge: bad.startAge && !!d.startAge.trim(),
    endAge: bad.endAge,
    annualChange: bad.annualChange && !!d.amount.trim(),
  };
  const complete = !Object.values(bad).some(Boolean);
  const open = d.open || !complete;
  const lostChild = d.childId !== null && !children.some((k) => k.id === d.childId);
  const [more, less] = DIRECTIONS[d.kind];
  const once = d.kind === 'once';

  function toggleOpen(nextOpen: boolean) {
    onChange(nextOpen ? { open: true } : { open: false, sortAge: resolvedSortAge(event, children, birthYear) });
  }

  function setMonthly(monthly: boolean) {
    if (monthly === d.monthly) return;
    const amount = num(d.amount);
    onChange({
      monthly,
      amount: amount === null || !Number.isFinite(amount) ? d.amount : String(cents(monthly ? amount / 12 : amount * 12)),
    });
  }

  function setKind(kind: LifeEventKind) {
    onChange(kind === 'once' ? { kind, monthly: false, endAge: '' } : { kind });
  }

  const impactPill = complete && (
    <View style={[styles.impactPill, { backgroundColor: accent.bg }]}>
      <ThemedText type="smallBold" style={{ color: accent.fg, fontSize: 12, lineHeight: 16 }}>
        {formatImpactPill(event)}
      </ThemedText>
    </View>
  );

  return (
    <View style={[styles.event, { borderColor: open ? theme.border : 'transparent' }]}>
      <View style={styles.eventHead}>
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={KIND[d.kind].icon} size={18} color={accent.fg} />
        </View>
        <Pressable
          style={styles.shrink}
          onPress={() => complete && toggleOpen(!d.open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${d.label || 'New event'}: ${complete ? 'edit' : 'unfinished'}`}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {d.label.trim() || 'New event'}
          </ThemedText>
          <ThemedText type="small" themeColor={complete ? 'textSecondary' : 'warning'}>
            {complete ? formatTimingLine(event, children, birthYear) : 'Unfinished: fill in the fields below'}
          </ThemedText>
          {narrow && impactPill && <View style={styles.narrowPillWrap}>{impactPill}</View>}
          {complete && inputs && <Effect event={event} inputs={inputs} kids={children} birthYear={birthYear} />}
        </Pressable>
        {!narrow && impactPill}
        <View style={styles.eventActions}>
          {complete && (
            <Pressable
              onPress={() => toggleOpen(!d.open)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={d.open ? `Done editing ${d.label}` : `Edit ${d.label}`}
              style={({ hovered }) => [styles.iconButton, hovered && { backgroundColor: theme.backgroundSelected }]}>
              <Icon name={d.open ? 'chevronUp' : 'chevronDown'} size={18} themeColor="textSecondary" />
            </Pressable>
          )}
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${d.label || 'event'}`}
            style={({ hovered }) => [styles.iconButton, hovered && { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="close" size={18} themeColor="textSecondary" />
          </Pressable>
        </View>
      </View>

      {lostChild && (
        <ThemedText type="small" themeColor="negative">
          This child is no longer on your profile, so the event is left out.
        </ThemedText>
      )}

      {open && (
        <View style={[styles.form, !narrow && styles.indent]}>
          <Field label="What happens" invalid={flag.label}>
            <Input value={d.label} onChangeText={(label) => onChange({ label })} placeholder="e.g. Kids leave home" maxLength={60} />
          </Field>
          <View style={styles.group}>
            <View style={styles.labelRow}>
              <ThemedText type="small" themeColor="textSecondary">
                What it changes
              </ThemedText>
              <InfoTip title={KIND_TIPS[d.kind].title}>{KIND_TIPS[d.kind].body}</InfoTip>
            </View>
            <View style={styles.chips}>
              {KINDS.map((k) => (
                <Chip key={k.kind} label={k.label} selected={d.kind === k.kind} onPress={() => setKind(k.kind)} />
              ))}
            </View>
          </View>
          {(children.length > 0 || d.childId !== null) && (
            <View style={styles.group}>
              <View style={styles.labelRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  Ages are
                </ThemedText>
                <InfoTip title={TIPS.childAges.title}>{TIPS.childAges.body}</InfoTip>
              </View>
              <View style={styles.chips}>
                <Chip label="Yours" selected={d.childId === null} onPress={() => onChange({ childId: null })} />
                {children.map((k) => (
                  <Chip key={k.id} label={`${childName(children, k.id)}’s`} selected={d.childId === k.id} onPress={() => onChange({ childId: k.id })} />
                ))}
              </View>
            </View>
          )}
          <View style={styles.chips}>
            <Chip label={more} selected={!d.less} onPress={() => onChange({ less: false })} />
            <Chip label={less} selected={d.less} onPress={() => onChange({ less: true })} />
            {!once && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <Chip label="Per month" selected={d.monthly} onPress={() => setMonthly(true)} />
                <Chip label="Per year" selected={!d.monthly} onPress={() => setMonthly(false)} />
              </>
            )}
          </View>
          <Row>
            <Field label={once ? 'Amount' : d.monthly ? 'Amount per month' : 'Amount per year'} invalid={flag.annualChange}>
              <Input value={d.amount} onChangeText={(amount) => onChange({ amount })} placeholder="$" keyboardType="decimal-pad" inputMode="decimal" />
            </Field>
            <Field label={once ? 'At age' : 'From age'} invalid={flag.startAge}>
              <Input value={d.startAge} onChangeText={(startAge) => onChange({ startAge })} placeholder="Age" keyboardType="number-pad" inputMode="numeric" maxLength={3} />
            </Field>
            {!once && (
              <Field label="Until age" invalid={flag.endAge}>
                <Input value={d.endAge} onChangeText={(endAge) => onChange({ endAge })} placeholder="Leave empty: for good" keyboardType="number-pad" inputMode="numeric" maxLength={3} />
              </Field>
            )}
          </Row>
          {flag.endAge && (
            <ThemedText type="small" themeColor="negative">
              “Until age” is when it stops, so it needs to be after the start.
            </ThemedText>
          )}
          {complete && (
            <View style={styles.buttons}>
              <Button label="Done" variant="secondary" size="small" onPress={() => toggleOpen(false)} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** "at 52 (2031)", or "when Maya is 18 (you’re 52, in 2031)". */
function when(age: number, childId: string | null, children: Child[], birthYear: number | null) {
  const child = childId === null ? null : children.find((k) => k.id === childId);
  if (!child) return birthYear === null ? `at ${age}` : `at ${age} (${birthYear + age})`;
  const year = child.birthYear + age;
  return `when ${childName(children, child.id)} is ${age}${birthYear === null ? '' : ` (you’re ${year - birthYear}, in ${year})`}`;
}

/** The event in a sentence, e.g. "Spend $1,500 less a month at 52 (2031), for good". */
export function describe(e: SpendingChange, children: Child[], birthYear: number | null) {
  const amount = formatWholeCurrency(Math.abs(e.monthly ? e.annualChange / 12 : e.annualChange));
  const less = e.annualChange < 0;
  if (e.kind === 'once') return `${amount} ${less ? 'out of' : 'into'} savings ${when(e.startAge, e.childId, children, birthYear)}`;
  const per = e.monthly ? 'a month' : 'a year';
  const what = {
    spending: `Spend ${amount} ${less ? 'less' : 'more'} ${per}`,
    income: `${amount} ${per} ${less ? 'less' : 'more'} income`,
    saving: `Save ${amount} ${less ? 'less' : 'more'} ${per}`,
  }[e.kind ?? 'spending'];
  const until = e.endAge === null ? ', for good' : `, until ${e.endAge}`;
  return `${what} from ${when(e.startAge, e.childId, children, birthYear).replace(/^at /, '')}${until}`;
}

/** A note when an event falls where it can't change the projection. */
function Effect({
  event,
  inputs,
  kids: children,
  birthYear,
}: {
  event: SpendingChange;
  inputs: RetirementInputs;
  kids: Child[];
  birthYear: number | null;
}) {
  if (birthYear === null) return null;
  const [mine] = inYourAges([event], children, birthYear);
  if (!mine) return null;
  const retire = inputs.retirementAge;
  const end = mine.endAge ?? Infinity;
  let note: string | null = null;
  if (mine.kind === 'spending' && end <= retire) {
    note = 'This is all before you retire, so it doesn’t change the projection. If it means saving less, make it a saving change.';
  } else if (mine.kind === 'saving' && mine.startAge >= retire) {
    note = 'This starts after you retire, when you’re no longer saving, so it has no effect.';
  } else if (end <= inputs.currentAge || mine.startAge > inputs.lifeExpectancy) {
    note = 'This falls outside your plan’s years, so it has no effect.';
  }
  return note ? (
    <ThemedText type="small" themeColor="warning">
      {note}
    </ThemedText>
  ) : null;
}

const styles = StyleSheet.create({
  cardInner: { gap: Spacing.three },
  list: { gap: Spacing.one },
  add: { gap: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  quickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  group: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  shrink: { flex: 1, flexShrink: 1, gap: Spacing.half },
  event: { gap: Spacing.three, padding: Spacing.three, marginHorizontal: -Spacing.three, borderRadius: Spacing.three, borderWidth: 1 },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  eventActions: { flexDirection: 'row', gap: Spacing.one },
  impactPill: { paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: Spacing.three },
  narrowPillWrap: { flexDirection: 'row', marginTop: 2 },
  iconButton: { padding: Spacing.one, borderRadius: Spacing.two },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  form: { gap: Spacing.three },
  indent: { paddingLeft: 36 + Spacing.three },
  divider: { width: 1, alignSelf: 'stretch', marginHorizontal: Spacing.one },
});
