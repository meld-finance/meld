import {
  retirementLevers,
  SIMULATION_DEFAULTS,
  socialSecurityResolver,
  type RetirementInputs,
  type RetirementLevers as LeversResult,
  type RetirementPlan,
  type RetirementSummary,
  type RetirementTarget,
} from '@meld/shared';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon, type IconName } from '@/components/icon';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

export type LeverPatch = Partial<
  Pick<
    RetirementPlan,
    | 'annualContribution'
    | 'retirementAge'
    | 'annualSpending'
    | 'socialSecurityAge'
    | 'lifeExpectancy'
    | 'partnerLifeExpectancy'
  >
>;

export type LeverPlanContext = Pick<
  RetirementPlan,
  'socialSecurityAnnual' | 'partnerSocialSecurityAnnual' | 'partnerRetirementAge' | 'partnerSocialSecurityAge'
>;

type Props = {
  inputs: RetirementInputs;
  plan: LeverPlanContext;
  defaults: RetirementSummary['defaults'];
  appliedTry: string | null;
  onTry: (patch: LeverPatch, label: string) => void;
  onUndoTry: () => void;
};

type GoalOption = 'base' | '80' | '85' | '90' | '95';

const GOAL_OPTIONS: { value: GoalOption; label: string }[] = [
  { value: 'base', label: 'Base' },
  { value: '80', label: '80%' },
  { value: '85', label: '85%' },
  { value: '90', label: '90%' },
  { value: '95', label: '95%' },
];

type LeverItem = {
  key: string;
  icon: IconName;
  accent: Accent;
  label: string;
  headline: string;
  detail: string;
  patch?: LeverPatch;
  tryLabel?: string;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

function buildLeverItems(
  levers: LeversResult,
  parsedInputs: RetirementInputs,
  planLifeExpectancy: number,
  targetAge: number,
  partnerShift: number | null,
): LeverItem[] {
  const agePatch: LeverPatch =
    targetAge === planLifeExpectancy
      ? {}
      : parsedInputs.partner && partnerShift !== null && targetAge < planLifeExpectancy
        ? {
            lifeExpectancy: Math.min(parsedInputs.yourLifeExpectancy ?? planLifeExpectancy, targetAge),
            partnerLifeExpectancy: Math.max(
              50,
              Math.min(120, Math.min(parsedInputs.partner.lifeExpectancy, targetAge - partnerShift)),
            ),
          }
        : { lifeExpectancy: targetAge };
  const items: LeverItem[] = [];

  if (levers.status === 'short') {
    if (levers.saving) {
      const l = levers.saving;
      items.push({
        key: 'saving',
        icon: 'wallet',
        accent: 'blue',
        label: 'Save more',
        headline: `+${formatWholeCurrency(l.monthlyDelta)}/mo`,
        detail: `+${formatWholeCurrency(l.annualDelta)}/yr · to ${formatWholeCurrency(l.targetAnnual)}/yr`,
        patch: { ...agePatch, annualContribution: l.targetAnnual },
        tryLabel: `Save ${formatWholeCurrency(l.monthlyDelta)}/mo more`,
      });
    }
    if (levers.retirementAge) {
      const l = levers.retirementAge;
      items.push({
        key: 'retirementAge',
        icon: 'calendar',
        accent: 'purple',
        label: 'Work longer',
        headline: `Age ${l.targetAge}`,
        detail: `+${plural(l.yearsDelta, 'year')} from age ${parsedInputs.retirementAge}`,
        patch: { ...agePatch, retirementAge: l.targetAge },
        tryLabel: `Retire at age ${l.targetAge}`,
      });
    }
    if (levers.spending) {
      const l = levers.spending;
      items.push({
        key: 'spending',
        icon: 'receipt',
        accent: 'orange',
        label: 'Spend less',
        headline: `−${formatWholeCurrency(Math.abs(l.monthlyDelta))}/mo`,
        detail: `−${formatWholeCurrency(Math.abs(l.annualDelta))}/yr · to ${formatWholeCurrency(l.targetAnnual)}/yr`,
        patch: { ...agePatch, annualSpending: l.targetAnnual },
        tryLabel: `Spend ${formatWholeCurrency(Math.abs(l.monthlyDelta))}/mo less`,
      });
    }
    if (levers.socialSecurity) {
      const l = levers.socialSecurity;
      items.push({
        key: 'socialSecurity',
        icon: 'shield',
        accent: 'teal',
        label: 'Claim Social Security later',
        headline: `Age ${l.targetClaimAge}`,
        detail: `Wait ${plural(l.yearsDelta, 'year')} · +${formatWholeCurrency(Math.round(l.annualBenefitDelta / 12))}/mo for life`,
        patch: { ...agePatch, socialSecurityAge: l.targetClaimAge },
        tryLabel: `Claim Social Security at ${l.targetClaimAge}`,
      });
    }
    return items;
  }

  if (levers.status === 'ahead') {
    if (levers.spending) {
      const l = levers.spending;
      items.push({
        key: 'spending',
        icon: 'sparkles',
        accent: 'green',
        label: 'Spend more',
        headline: `+${formatWholeCurrency(l.monthlyDelta)}/mo`,
        detail: `+${formatWholeCurrency(l.annualDelta)}/yr · up to ${formatWholeCurrency(l.targetAnnual)}/yr`,
        patch: { ...agePatch, annualSpending: l.targetAnnual },
        tryLabel: `Spend ${formatWholeCurrency(l.monthlyDelta)}/mo more`,
      });
    }
    if (levers.retirementAge) {
      const l = levers.retirementAge;
      items.push({
        key: 'retirementAge',
        icon: 'calendar',
        accent: 'purple',
        label: 'Retire earlier',
        headline: `Age ${l.targetAge}`,
        detail: `${plural(Math.abs(l.yearsDelta), 'year')} earlier than ${parsedInputs.retirementAge}`,
        patch: { ...agePatch, retirementAge: l.targetAge },
        tryLabel: `Retire at age ${l.targetAge}`,
      });
    }
    if (levers.saving) {
      const l = levers.saving;
      items.push({
        key: 'saving',
        icon: 'wallet',
        accent: 'blue',
        label: 'Save less',
        headline: `−${formatWholeCurrency(Math.abs(l.monthlyDelta))}/mo`,
        detail:
          l.targetAnnual === 0
            ? 'Down to $0/yr · current savings already cover it'
            : `−${formatWholeCurrency(Math.abs(l.annualDelta))}/yr · down to ${formatWholeCurrency(l.targetAnnual)}/yr`,
        patch: { ...agePatch, annualContribution: l.targetAnnual },
        tryLabel: `Save ${formatWholeCurrency(Math.abs(l.monthlyDelta))}/mo less`,
      });
    }
    if (levers.longevity) {
      const l = levers.longevity;
      items.push({
        key: 'longevity',
        icon: 'shield',
        accent: 'teal',
        label: 'Lasts longer',
        headline: l.capped ? 'Age 120+' : `Age ${l.maxAge}`,
        detail: l.capped ? 'Still on target past age 120' : `+${plural(l.yearsExtra, 'year')} past age ${levers.targetAge}`,
        patch: l.maxAge > planLifeExpectancy ? { lifeExpectancy: l.maxAge } : undefined,
        tryLabel: `Plan to age ${l.maxAge}`,
      });
    }
  }

  return items;
}

function buildHeaderCopy(
  levers: LeversResult,
  parsedInputs: RetirementInputs,
  goal: GoalOption,
): { title: string; subtitle: string } {
  if (goal !== 'base') {
    const curPct = Math.round((levers.currentSuccessRate ?? 0) * 100);
    const targetPct = Number(goal);
    if (levers.status === 'short') {
      return {
        title: 'Ways to reach your target',
        subtitle: `Currently ${curPct}% chance of lasting to age ${levers.targetAge} (${SIMULATION_DEFAULTS.volatility}% volatility). Any one of these reaches ${targetPct}%:`,
      };
    }
    if (levers.status === 'ahead') {
      return {
        title: 'Room to spare',
        subtitle: `Currently ${curPct}% chance of lasting to age ${levers.targetAge} (${SIMULATION_DEFAULTS.volatility}% volatility). Any one of these keeps you at ${targetPct}% or better:`,
      };
    }
    return {
      title: 'Right on target',
      subtitle: `Right at ${curPct}% chance of lasting to age ${levers.targetAge}. Pick a higher target or later age to see what adds more cushion.`,
    };
  }

  if (levers.status === 'short') {
    return {
      title: 'Ways to close the gap',
      subtitle: `At a steady ${parsedInputs.expectedReturn}% return, savings ${
        levers.currentDepletionAge !== null
          ? `run short at ${levers.currentDepletionAge}`
          : `are short ${formatCompactCurrency(levers.currentGap)}`
      }. Any one of these lasts to age ${levers.targetAge}:`,
    };
  }
  if (levers.status === 'ahead') {
    return {
      title: 'Room to spare',
      subtitle: `At a steady ${parsedInputs.expectedReturn}% return, you have ${formatCompactCurrency(-levers.currentGap)} to spare at retirement. Any one of these still lasts to age ${levers.targetAge}:`,
    };
  }
  return {
    title: 'Right on target',
    subtitle: `At a steady ${parsedInputs.expectedReturn}% return, savings last right to age ${levers.targetAge}. Pick a confidence % to test market ups and downs.`,
  };
}

/**
 * Interactive single-lever coaching card: shows concrete adjustments to reach a base or confidence
 * target when short, or spending/retirement/saving/longevity cushion when ahead, with 1-click Try it.
 */
export function RetirementLevers({ inputs, plan, defaults, appliedTry, onTry, onUndoTry }: Props) {
  const theme = useTheme();
  const accents = useAccents();
  const [goal, setGoal] = useState<GoalOption>('80');
  const [ageOverride, setAgeOverride] = useState<{ base: number; value: number } | null>(null);

  const partnerShift =
    inputs.partner && defaults.birthYear !== null ? inputs.partner.birthYear - defaults.birthYear : null;
  const minTargetAge = Math.min(
    120,
    Math.max(
      50,
      inputs.retirementAge + 1,
      inputs.partner ? inputs.partner.retirementAgeInYours + 1 : 0,
      partnerShift !== null ? 50 + Math.max(0, partnerShift) : 50,
      inputs.currentAge + 1,
    ),
  );
  const targetAge = Math.min(
    120,
    Math.max(
      minTargetAge,
      ageOverride && ageOverride.base === inputs.lifeExpectancy ? ageOverride.value : inputs.lifeExpectancy,
    ),
  );

  // Follow the same 250ms debounce as the headline Monte Carlo tile so typing never stutters.
  const debouncedKey = useDebouncedValue(JSON.stringify({ inputs, plan }), 250);
  const { parsedInputs, levers } = useMemo(() => {
    const parsed = JSON.parse(debouncedKey) as { inputs: RetirementInputs; plan: LeverPlanContext };
    const effectiveTargetAge = Math.min(
      120,
      Math.max(
        parsed.inputs.retirementAge + 1,
        parsed.inputs.partner ? parsed.inputs.partner.retirementAgeInYours + 1 : 0,
        parsed.inputs.currentAge + 1,
        targetAge,
      ),
    );
    const target: RetirementTarget =
      goal === 'base' ? { kind: 'base' } : { kind: 'confidence', rate: Number(goal) / 100 };
    return {
      parsedInputs: parsed.inputs,
      levers: retirementLevers(parsed.inputs, {
        target,
        targetAge: effectiveTargetAge,
        context: {
          socialSecurityFor: socialSecurityResolver(parsed.plan, defaults),
          simulation: SIMULATION_DEFAULTS,
        },
      }),
    };
  }, [debouncedKey, goal, targetAge, defaults]);

  const { title, subtitle } = buildHeaderCopy(levers, parsedInputs, goal);
  const items = buildLeverItems(levers, parsedInputs, inputs.lifeExpectancy, levers.targetAge, partnerShift);

  function stepTargetAge(delta: number) {
    const next = Math.min(120, Math.max(minTargetAge, targetAge + delta));
    setAgeOverride(next === inputs.lifeExpectancy ? null : { base: inputs.lifeExpectancy, value: next });
  }

  return (
    <Card title={title} tip={TIPS.levers} subtitle={subtitle}>
      <View style={styles.controls}>
        <View style={styles.goalGroup}>
          <ThemedText type="smallBold">Target</ThemedText>
          <View style={styles.goalChips}>
            {GOAL_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={goal === opt.value}
                onPress={() => setGoal(opt.value)}
              />
            ))}
          </View>
        </View>
        <View style={styles.ageGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Last to age
          </ThemedText>
          <View style={styles.ageStepper}>
            <Pressable
              onPress={() => stepTargetAge(-1)}
              disabled={targetAge <= minTargetAge}
              accessibilityRole="button"
              accessibilityLabel="Decrease target age"
              style={({ hovered, pressed }) => [
                styles.stepBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: hovered && targetAge > minTargetAge ? theme.tint : theme.border,
                  opacity: targetAge <= minTargetAge ? 0.45 : pressed ? 0.75 : 1,
                },
              ]}>
              <ThemedText type="smallBold">−</ThemedText>
            </Pressable>
            <ThemedText type="smallBold" style={styles.ageValue}>
              {targetAge}
            </ThemedText>
            <Pressable
              onPress={() => stepTargetAge(1)}
              disabled={targetAge >= 120}
              accessibilityRole="button"
              accessibilityLabel="Increase target age"
              style={({ hovered, pressed }) => [
                styles.stepBtn,
                {
                  backgroundColor: theme.background,
                  borderColor: hovered && targetAge < 120 ? theme.tint : theme.border,
                  opacity: targetAge >= 120 ? 0.45 : pressed ? 0.75 : 1,
                },
              ]}>
              <ThemedText type="smallBold">+</ThemedText>
            </Pressable>
          </View>
          {targetAge !== inputs.lifeExpectancy && (
            <Pressable
              onPress={() => setAgeOverride(null)}
              accessibilityRole="button"
              accessibilityLabel="Reset target age to plan age"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="smallBold" themeColor="tint">
                Reset
              </ThemedText>
            </Pressable>
          )}
        </View>
      </View>

      {appliedTry !== null && (
        <View style={[styles.undoBanner, { backgroundColor: theme.background, borderColor: theme.tint }]}>
          <ThemedText type="small" style={styles.undoText}>
            Previewing: <ThemedText type="smallBold">{appliedTry}</ThemedText>
          </ThemedText>
          <Button label="Undo" variant="secondary" size="small" onPress={onUndoTry} />
        </View>
      )}

      {items.length > 0 ? (
        <>
          <View style={styles.grid}>
            {items.map((item) => {
              const color = accents[item.accent];
              return (
                <View
                  key={item.key}
                  style={[styles.tile, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <View style={styles.tileHeader}>
                    <View style={[styles.iconBadge, { backgroundColor: color.bg }]}>
                      <Icon name={item.icon} size={15} color={color.fg} />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tileLabel}>
                      {item.label}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.headline}>{item.headline}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.detail}>
                    {item.detail}
                  </ThemedText>
                  {item.patch && item.tryLabel && (
                    <View style={styles.tileFooter}>
                      <Button
                        label="Try it"
                        variant="secondary"
                        size="small"
                        onPress={() => onTry(item.patch!, item.tryLabel!)}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Each option reaches the target on its own — smaller changes combined work too. Trying one previews it until you save.
          </ThemedText>
        </>
      ) : levers.status === 'short' ? (
        <ThemedText type="small" themeColor="textSecondary">
          No single adjustment reaches this target on its own. Try combining changes across saving, retirement age and spending, or picking a lower target.
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  goalGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  goalChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    flexShrink: 1,
    maxWidth: '100%',
  },
  ageGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ageStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageValue: {
    minWidth: 28,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.7 },
  undoBanner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  undoText: { flexGrow: 1, flexShrink: 1, flexBasis: 200 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 200,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one + Spacing.half,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { flexShrink: 1 },
  headline: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  detail: { lineHeight: 19 },
  tileFooter: {
    marginTop: 'auto',
    paddingTop: Spacing.one,
    alignItems: 'flex-start',
  },
});
