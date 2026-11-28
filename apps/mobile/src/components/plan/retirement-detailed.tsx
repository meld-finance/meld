import {
  is457bSubtype,
  rmdStartAge,
  stateName,
  US_STATES,
  type ContributionSplit,
  type RetirementPlan,
  type RetirementProjection,
  type RetirementSummary,
  type RothConversionBracket,
  type WithdrawalOrder,
} from '@meld/shared';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Dropdown } from '@/components/dropdown';
import { WithTip } from '@/components/info-tip';
import { StatTile, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';

const ORDER_OPTIONS: { value: WithdrawalOrder; label: string; desc: string }[] = [
  {
    value: 'taxable_first',
    label: 'Taxable first',
    desc: 'Spend brokerage cash first, then pre-tax (401(k)/IRA), saving tax-free Roth for last.',
  },
  {
    value: 'bracket_fill',
    label: 'Fill low tax bracket',
    desc: 'Draw pre-tax up to the 12% bracket (or conversion ceiling) first, then taxable, then Roth.',
  },
  {
    value: 'pretax_first',
    label: 'Pre-tax first',
    desc: 'Spend traditional 401(k)/IRA accounts first to shrink future required withdrawals (RMDs).',
  },
  {
    value: 'pro_rata',
    label: 'Proportional',
    desc: 'Draw evenly across pre-tax, Roth, and taxable accounts in proportion to their balances.',
  },
];

const CONVERSION_OPTIONS: { value: RothConversionBracket | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 12, label: 'Up to 12%' },
  { value: 22, label: 'Up to 22%' },
  { value: 24, label: 'Up to 24%' },
];

const STATE_OPTIONS = [
  { value: '', label: 'Same as Profile' },
  ...US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })),
];

export type DetailedSettingsDraft = {
  withdrawalOrder: WithdrawalOrder;
  rothConversionBracket: RothConversionBracket | null;
  contributionSplit: ContributionSplit | null;
  includeCatchUps: boolean;
  retirementState: string | null;
  taxableBasisText: string;
  rothBasisText: string;
  penaltyFreeEarlyAccess: boolean;
};

/** Detailed mode settings: drawdown strategy, Roth conversions, contribution mix, and early-access rules. */
export function RetirementDetailedSettings({
  draft,
  summary,
  projection,
  firstRetireAge,
  invalidTaxableBasis,
  invalidRothBasis,
  onChange,
  onShowProfile,
}: {
  draft: DetailedSettingsDraft;
  summary: RetirementSummary;
  projection: RetirementProjection | null;
  firstRetireAge: number;
  invalidTaxableBasis: boolean;
  invalidRothBasis: boolean;
  onChange: (patch: Partial<DetailedSettingsDraft>) => void;
  onShowProfile: () => void;
}) {
  const theme = useTheme();
  const d = summary.defaults;
  const included = summary.accounts.filter((a) => a.included);
  const pretax457b = included
    .filter((a) => a.taxTreatment === 'tax_deferred' && is457bSubtype(a.subtype))
    .reduce((s, a) => s + a.value, 0);
  const effectiveState = draft.retirementState ?? d.state;
  const startRmd = d.birthYear !== null ? rmdStartAge(d.birthYear) : 75;
  const split = draft.contributionSplit;

  const setSplitField = (key: keyof ContributionSplit, raw: string) => {
    const val = raw.trim() ? Number(raw.replace(/[^0-9.]/g, '')) : 0;
    const clamped = Number.isFinite(val) ? Math.min(100, Math.max(0, Math.round(val))) : 0;
    const base = split ?? { pretax: 70, roth: 20, taxable: 10 };
    onChange({ contributionSplit: { ...base, [key]: clamped } });
  };
  const splitTotal = split ? split.pretax + split.roth + split.taxable : null;

  return (
    <View style={styles.wrap}>
      {projection?.taxSummary && (
        <Card
          title="Estimated taxes in retirement"
          tip={TIPS.estimatedTaxes}
          subtitle={`Based on ${d.filingStatus ? d.filingStatus.replace(/_/g, ' ') : 'single'} brackets${
            effectiveState ? ` and ${stateName(effectiveState) ?? effectiveState} state tax` : ' (federal only)'
          }, with RMDs starting at age ${startRmd}.`}>
          <TileRow>
            <StatTile
              label="Lifetime est. taxes"
              value={projection.taxSummary.lifetimeTax}
              caption={`~${Math.round(projection.taxSummary.effectiveTaxRate * 100)}% of total retirement outflows`}
            />
            <StatTile
              label={`Total RMDs (age ${startRmd}+)`}
              value={projection.taxSummary.lifetimeRmd}
              caption="Required withdrawals from pre-tax accounts"
            />
            {projection.taxSummary.lifetimeRothConversions > 0 && (
              <StatTile
                label="Roth conversions"
                value={projection.taxSummary.lifetimeRothConversions}
                caption={`Filling up to the ${draft.rothConversionBracket}% bracket`}
              />
            )}
            {projection.taxSummary.lifetimeEarlyPenalty > 0 && (
              <StatTile
                label="Early penalties (<59½)"
                tone="warning"
                value={projection.taxSummary.lifetimeEarlyPenalty}
                caption="10% IRS penalty on early pre-tax draws"
              />
            )}
          </TileRow>
        </Card>
      )}

      <View style={styles.columns}>
        <View style={[styles.column, styles.side]}>
          <Card
            title="Withdrawal order & Roth conversions"
            tip={TIPS.withdrawalOrder}
            subtitle="Choose which account bucket you draw from first once retired.">
            <View style={styles.orderList}>
              {ORDER_OPTIONS.map((opt) => {
                const selected = draft.withdrawalOrder === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => onChange({ withdrawalOrder: opt.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={({ hovered, pressed }) => [
                      styles.orderOption,
                      {
                        backgroundColor: selected ? theme.background : theme.backgroundElement,
                        borderColor: selected ? theme.tint : hovered ? theme.textSecondary : theme.border,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.orderHead}>
                      <View
                        style={[
                          styles.radio,
                          { borderColor: selected ? theme.tint : theme.border },
                        ]}>
                        {selected && <View style={[styles.radioDot, { backgroundColor: theme.tint }]} />}
                      </View>
                      <ThemedText type="smallBold">{opt.label}</ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.orderDesc}>
                      {opt.desc}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.divider, { borderTopColor: theme.border }]}>
              <WithTip tip={TIPS.rothConversions}>
                <ThemedText type="smallBold">Annual Roth conversions in retirement</ThemedText>
              </WithTip>
              <ThemedText type="small" themeColor="textSecondary">
                Optionally convert pre-tax savings into Roth during lower-income retirement years to shrink future
                age-{startRmd} RMDs.
              </ThemedText>
              <View style={styles.chips}>
                {CONVERSION_OPTIONS.map((opt) => (
                  <Chip
                    key={String(opt.value)}
                    label={opt.label}
                    selected={draft.rothConversionBracket === opt.value}
                    onPress={() => onChange({ rothConversionBracket: opt.value })}
                  />
                ))}
              </View>
            </View>
          </Card>
        </View>

        <View style={[styles.column, styles.side]}>
          <Card
            title="Future contributions"
            tip={TIPS.contributionSplit}
            subtitle="How your ongoing retirement savings divide across tax buckets while working.">
            <View style={styles.chips}>
              <Chip
                label="Match my accounts"
                selected={split === null}
                onPress={() => onChange({ contributionSplit: null })}
              />
              <Chip
                label="70 / 20 / 10"
                selected={split?.pretax === 70 && split?.roth === 20 && split?.taxable === 10}
                onPress={() => onChange({ contributionSplit: { pretax: 70, roth: 20, taxable: 10 } })}
              />
              <Chip
                label="50 / 40 / 10"
                selected={split?.pretax === 50 && split?.roth === 40 && split?.taxable === 10}
                onPress={() => onChange({ contributionSplit: { pretax: 50, roth: 40, taxable: 10 } })}
              />
            </View>

            {split !== null ? (
              <>
                <Row>
                  <Field label="Pre-tax %">
                    <Input
                      value={String(split.pretax)}
                      onChangeText={(v) => setSplitField('pretax', v)}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      accessibilityLabel="Pre-tax contribution percent"
                    />
                  </Field>
                  <Field label="Roth %">
                    <Input
                      value={String(split.roth)}
                      onChangeText={(v) => setSplitField('roth', v)}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      accessibilityLabel="Roth contribution percent"
                    />
                  </Field>
                  <Field label="Taxable %">
                    <Input
                      value={String(split.taxable)}
                      onChangeText={(v) => setSplitField('taxable', v)}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      accessibilityLabel="Taxable contribution percent"
                    />
                  </Field>
                </Row>
                {splitTotal !== null && splitTotal !== 100 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Total is {splitTotal}% — Meld scales these proportionally to 100%.
                  </ThemedText>
                )}
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Splitting new contributions automatically in the same proportions as your current retirement accounts.
              </ThemedText>
            )}

            <View style={[styles.switchRow, { borderTopColor: theme.border }]}>
              <View style={styles.switchText}>
                <WithTip tip={TIPS.catchUps}>
                  <ThemedText type="smallBold">Include age 50+ catch-up limits</ThemedText>
                </WithTip>
                <ThemedText type="small" themeColor="textSecondary">
                  Adds +$8,000/yr at age 50+ and +$11,250/yr at ages 60–63 while working.
                </ThemedText>
              </View>
              <Switch
                value={draft.includeCatchUps}
                onValueChange={(v) => onChange({ includeCatchUps: v })}
                accessibilityLabel="Include age 50+ catch-up contributions"
              />
            </View>
          </Card>

          <Card
            title="Tax location & early access"
            subtitle="Optional overrides—leave blank to use what Meld detects from your accounts and Profile.">
            <Field label="Retirement tax state" tip={TIPS.retirementState}>
              <Dropdown
                accessibilityLabel="Retirement tax state"
                value={draft.retirementState ?? ''}
                onChange={(v) => onChange({ retirementState: v || null })}
                options={STATE_OPTIONS}
              />
              {!d.state && !draft.retirementState && (
                <ThemedText type="small" themeColor="textSecondary">
                  No state set on your{' '}
                  <ThemedText type="small" themeColor="tint" accessibilityRole="link" onPress={onShowProfile}>
                    Profile
                  </ThemedText>{' '}
                  yet — estimating federal tax only.
                </ThemedText>
              )}
            </Field>

            <Row>
              <Field label="Taxable cost basis, %" invalid={invalidTaxableBasis} tip={TIPS.taxableBasis}>
                <Input
                  value={draft.taxableBasisText}
                  onChangeText={(v) => onChange({ taxableBasisText: v })}
                  placeholder={
                    d.taxableBasisPercent !== null
                      ? `${Math.round(d.taxableBasisPercent)}% · from holdings`
                      : '50% · default'
                  }
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Past Roth contributions" invalid={invalidRothBasis} tip={TIPS.earlyAccess}>
                <Input
                  value={draft.rothBasisText}
                  onChangeText={(v) => onChange({ rothBasisText: v })}
                  placeholder="$0 · penalty-free before 59½"
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
              </Field>
            </Row>

            <View style={[styles.switchRow, { borderTopColor: theme.border }]}>
              <View style={styles.switchText}>
                <WithTip tip={TIPS.earlyAccess}>
                  <ThemedText type="smallBold">Penalty-free pre-tax access before 59½</ThemedText>
                </WithTip>
                <ThemedText type="small" themeColor="textSecondary">
                  {pretax457b > 0
                    ? `Your ${formatWholeCurrency(pretax457b)} 457(b) is already penalty-free after leaving work. Turn this on if you also plan to use Rule of 55 or 72(t).`
                    : firstRetireAge < 60
                      ? 'Turn on if you plan to use the Rule of 55 or 72(t) scheduled withdrawals; otherwise Meld adds the 10% IRS early penalty before age 60.'
                      : 'Applies only if retiring before age 60 (Rule of 55 or 72(t) scheduled withdrawals).'}
                </ThemedText>
              </View>
              <Switch
                value={draft.penaltyFreeEarlyAccess}
                onValueChange={(v) => onChange({ penaltyFreeEarlyAccess: v })}
                accessibilityLabel="Penalty-free early access before 59 and a half"
              />
            </View>
          </Card>
        </View>
      </View>
    </View>
  );
}

/** Order-independent comparison of Detailed settings against the saved plan. */
export function sameDetailedSettings(
  draft: {
    planningMode: RetirementPlan['planningMode'];
    withdrawalOrder: WithdrawalOrder;
    rothConversionBracket: RothConversionBracket | null;
    contributionSplit: ContributionSplit | null;
    includeCatchUps: boolean;
    retirementState: string | null;
    taxableBasisPercent: number | null;
    rothContributionBasis: number | null;
    penaltyFreeEarlyAccess: boolean;
  },
  saved: RetirementPlan,
): boolean {
  return (
    draft.planningMode === saved.planningMode &&
    draft.withdrawalOrder === saved.withdrawalOrder &&
    draft.rothConversionBracket === saved.rothConversionBracket &&
    draft.includeCatchUps === saved.includeCatchUps &&
    draft.retirementState === saved.retirementState &&
    draft.taxableBasisPercent === saved.taxableBasisPercent &&
    draft.rothContributionBasis === saved.rothContributionBasis &&
    draft.penaltyFreeEarlyAccess === saved.penaltyFreeEarlyAccess &&
    JSON.stringify(draft.contributionSplit) === JSON.stringify(saved.contributionSplit)
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, alignItems: 'flex-start' },
  column: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0 },
  side: { gap: Spacing.three },
  orderList: { gap: Spacing.two },
  orderOption: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.two + Spacing.half,
    gap: 4,
  },
  orderHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  orderDesc: { paddingLeft: 24 },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  switchText: { flex: 1, flexShrink: 1, gap: 2 },
  pressed: { opacity: 0.78 },
});
