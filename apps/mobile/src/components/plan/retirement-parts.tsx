import {
  claimingFactor,
  formatFullRetirementAge,
  fullRetirementAgeMonths,
  SIMULATION_DEFAULTS,
  spendingAt,
  type RetirementInputs,
  type RetirementProjection as Projection,
} from '@meld/shared';
import { Linking, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { WithTip } from '@/components/info-tip';
import { StatTile, TileRow } from '@/components/investments/common';
import { Input } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

const SSA_ACCOUNT_URL = 'https://www.ssa.gov/myaccount/';

export function AgeStepper({
  value,
  onChangeText,
  onStep,
  placeholder,
  accessibilityLabel,
  maxLength = 3,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onStep: (delta: number) => void;
  placeholder: string;
  accessibilityLabel: string;
  maxLength?: number;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepperRow}>
      <Pressable
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${accessibilityLabel}`}
        style={({ hovered, pressed }) => [
          styles.stepBtn,
          { backgroundColor: theme.background, borderColor: hovered ? theme.tint : theme.border },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold">−</ThemedText>
      </Pressable>
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel}
        style={styles.stepperInput}
      />
      <Pressable
        onPress={() => onStep(1)}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${accessibilityLabel}`}
        style={({ hovered, pressed }) => [
          styles.stepBtn,
          { backgroundColor: theme.background, borderColor: hovered ? theme.tint : theme.border },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold">+</ThemedText>
      </Pressable>
    </View>
  );
}

/** Unsaved changes: save or throw them away. Sticks to the bottom of the window on the web. */
export function SaveBar({
  dirty,
  saved,
  problem,
  error,
  saving,
  onSave,
  onDiscard,
  onJumpIssue,
}: {
  dirty: boolean;
  saved: boolean;
  /** Why it can't be saved yet. */
  problem: string | null;
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onJumpIssue?: () => void;
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
          {problem && onJumpIssue && (
            <Button label="Show issue" variant="secondary" size="small" onPress={onJumpIssue} />
          )}
          <Button label="Discard" variant="secondary" size="small" onPress={onDiscard} disabled={saving} />
          <Button label="Save changes" size="small" disabled={!!problem} loading={saving} onPress={onSave} />
        </View>
      )}
    </ThemedView>
  );
}

/** react-native-web supports sticky positioning; native types don't know it. */
const STICKY = (Platform.OS === 'web' ? { position: 'sticky', bottom: Spacing.three, zIndex: 20 } : {}) as ViewStyle;

/** Spending at key milestone ages, as scannable pills. */
export function SpendingPath({ inputs }: { inputs: RetirementInputs }) {
  const theme = useTheme();
  const start = Math.max(inputs.retirementAge, inputs.currentAge);
  const ages = [start, ...[75, 85].filter((a) => a > start && a < inputs.lifeExpectancy)];
  return (
    <View style={styles.pathWrap}>
      <ThemedText type="small" themeColor="textSecondary">
        Projected spending with life events and slowdown:
      </ThemedText>
      <View style={styles.pathPills}>
        {ages.map((a) => (
          <View key={a} style={[styles.pathPill, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Age {a}:{' '}
              <ThemedText type="smallBold">{formatWholeCurrency(Math.round(spendingAt(inputs, a)))}/yr</ThemedText>
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Summary({
  inputs,
  projection: p,
  successRate,
  onPressStress,
}: {
  inputs: RetirementInputs;
  projection: Projection;
  successRate: number | null;
  onPressStress: () => void;
}) {
  const retired = inputs.retirementAge <= inputs.currentAge;
  const saleTotal = p.sales.reduce((sum, s) => sum + s.proceeds, 0);
  const successPct = successRate !== null ? Math.round(successRate * 100) : null;
  const successTone =
    successRate === null ? undefined : successRate >= 0.8 ? 'positive' : successRate >= 0.6 ? 'warning' : 'negative';

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
      {successPct !== null && (
        <StatTile
          label="Chance of success"
          tip={TIPS.monteCarlo}
          tone={successTone}
          value={`${successPct}%`}
          caption={`Of ${SIMULATION_DEFAULTS.trials.toLocaleString()} market runs · Stress test →`}
          onPress={onPressStress}
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
export function SocialSecurity({
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
      <WithTip tip={TIPS.fullRetirementAge}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.shrinkText}>
          Pick when to start · your full retirement age is {formatFullRetirementAge(birthYear)}
        </ThemedText>
      </WithTip>
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

const styles = StyleSheet.create({
  missing: { gap: Spacing.two, alignItems: 'flex-start' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  pressed: { opacity: 0.75 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperInput: { flex: 1, textAlign: 'center', minWidth: 52 },
  pathWrap: { gap: Spacing.one + Spacing.half },
  pathPills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pathPill: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  shrinkText: { flexShrink: 1 },
  // Wide enough that on a phone the buttons wrap below rather than squeezing it.
  saveMessage: { flexGrow: 1, flexShrink: 1, flexBasis: 240 },
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
