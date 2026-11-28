import {
  formatInvestmentSubtype,
  retirementBalance,
  type RetirementAccount,
  type RetirementSummary,
  type TaxTreatment,
} from '@meld/shared';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { WithTip } from '@/components/info-tip';
import { TIPS } from '@/components/plan/retirement-tips';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatWholeCurrency } from '@/lib/format';

type AccountFilter = 'all' | 'included' | 'excluded';

const BUCKETS: { key: TaxTreatment; label: string }[] = [
  { key: 'tax_deferred', label: 'Tax-deferred' },
  { key: 'tax_free', label: 'Tax-free' },
  { key: 'taxable', label: 'Taxable' },
  { key: 'unknown', label: 'Other accounts' },
];

function formatSubtype(subtype: string | null): string | null {
  return formatInvestmentSubtype(subtype);
}

/** Spacious accounts manager: tax-mix bar, filter pills, tax-grouped switches, other savings, and 529 disclosure. */
export function RetirementAccounts({
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
  const viz = useVizColors();
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [showEducation, setShowEducation] = useState(false);

  const toggleable = summary.accounts.filter((a) => a.excludedReason !== 'education');
  const education = summary.accounts.filter((a) => a.excludedReason === 'education');
  const includedCount = toggleable.filter((a) => a.included).length;
  const excludedCount = toggleable.length - includedCount;
  const activeFilter =
    filter === 'excluded' && excludedCount === 0
      ? 'all'
      : filter === 'included' && includedCount === 0
        ? 'all'
        : filter;

  const total = retirementBalance(summary, { otherSavings });
  const eduTotal = education.reduce((sum, a) => sum + a.value, 0);

  const taxMix = [
    {
      key: 'tax_deferred',
      label: 'Tax-deferred',
      amount: toggleable.filter((a) => a.included && a.taxTreatment === 'tax_deferred').reduce((s, a) => s + a.value, 0),
      color: viz.series1,
    },
    {
      key: 'tax_free',
      label: 'Tax-free',
      amount: toggleable.filter((a) => a.included && a.taxTreatment === 'tax_free').reduce((s, a) => s + a.value, 0),
      color: viz.trend,
    },
    {
      key: 'taxable',
      label: 'Taxable',
      amount: toggleable.filter((a) => a.included && a.taxTreatment === 'taxable').reduce((s, a) => s + a.value, 0),
      color: viz.series2,
    },
    {
      key: 'unknown',
      label: 'Other',
      amount: toggleable.filter((a) => a.included && a.taxTreatment === 'unknown').reduce((s, a) => s + a.value, 0),
      color: viz.other,
    },
    {
      key: 'cash',
      label: 'Other savings',
      amount: Math.max(0, otherSavings ?? 0),
      color: viz.categorical[6]!,
    },
  ].filter((b) => b.amount > 0);

  const visibleGroups = BUCKETS.map((b) => {
    const allInBucket = toggleable.filter((a) => a.taxTreatment === b.key);
    const filtered = allInBucket.filter((a) =>
      activeFilter === 'included' ? a.included : activeFilter === 'excluded' ? !a.included : true,
    );
    const countedInBucket = allInBucket.filter((a) => a.included);
    const subtotal = countedInBucket.reduce((s, a) => s + a.value, 0);
    return { ...b, totalCount: allInBucket.length, countedCount: countedInBucket.length, subtotal, items: filtered };
  }).filter((g) => g.items.length > 0);

  return (
    <Card
      title="Counted toward retirement"
      tip={TIPS.counted}
      subtitle="Your share of each investment account. Turn off any you’re saving for something else.">
      {toggleable.length === 0 && education.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No investment accounts yet. Link your 401(k), IRA or brokerage on the Accounts tab.
        </ThemedText>
      )}

      {total > 0 && taxMix.length > 0 && (
        <View style={[styles.mixBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={styles.mixHeader}>
            <WithTip tip={TIPS.taxTreatment}>
              <ThemedText type="smallBold" style={styles.shrinkText}>
                Tax mix of counted savings
              </ThemedText>
            </WithTip>
            <ThemedText type="smallBold" style={styles.amount}>
              {formatWholeCurrency(total)}
            </ThemedText>
          </View>
          <View style={[styles.mixTrack, { backgroundColor: theme.backgroundSelected }]}>
            {taxMix.map((seg) => (
              <View
                key={seg.key}
                style={[styles.mixSeg, { flexGrow: seg.amount, backgroundColor: seg.color }]}
              />
            ))}
          </View>
          <View style={styles.legend}>
            {taxMix.map((seg) => {
              const pct = Math.round((seg.amount / total) * 100);
              return (
                <View key={seg.key} style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: seg.color }]} />
                  <ThemedText type="small" themeColor="textSecondary">
                    {seg.label} · {formatWholeCurrency(seg.amount)} ({pct}%)
                  </ThemedText>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {includedCount > 0 && excludedCount > 0 && (
        <View style={styles.filters}>
          <Chip label={`All (${toggleable.length})`} selected={activeFilter === 'all'} onPress={() => setFilter('all')} />
          <Chip
            label={`Counted (${includedCount})`}
            selected={activeFilter === 'included'}
            onPress={() => setFilter('included')}
          />
          <Chip
            label={`Excluded (${excludedCount})`}
            selected={activeFilter === 'excluded'}
            onPress={() => setFilter('excluded')}
          />
        </View>
      )}

      {visibleGroups.map((group) => (
        <View key={group.key} style={styles.group}>
          <View style={styles.groupHeader}>
            <ThemedText type="smallBold">
              {group.label}{' '}
              <ThemedText type="small" themeColor="textSecondary">
                · {group.countedCount} of {group.totalCount} counted
              </ThemedText>
            </ThemedText>
            <ThemedText type="smallBold" style={styles.amount}>
              {formatWholeCurrency(group.subtotal)}
            </ThemedText>
          </View>
          <View style={[styles.listBox, { borderColor: theme.border }]}>
            {group.items.map((a, idx) => {
              const meta = [a.institutionName, formatSubtype(a.subtype), !a.included ? 'Excluded' : null]
                .filter(Boolean)
                .join(' · ');
              return (
                <View
                  key={a.id}
                  style={[
                    styles.accountRow,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                    !a.included && styles.dimmed,
                  ]}>
                  <View style={styles.accountInfo}>
                    <ThemedText numberOfLines={2} themeColor={a.included ? 'text' : 'textSecondary'}>
                      {a.name}
                    </ThemedText>
                    {!!meta && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {meta}
                      </ThemedText>
                    )}
                  </View>
                  <View style={styles.accountRight}>
                    <ThemedText themeColor={a.included ? 'text' : 'textSecondary'} style={styles.amount}>
                      {formatWholeCurrency(a.value)}
                    </ThemedText>
                    <Switch
                      value={a.included}
                      disabled={disabled}
                      onValueChange={(include) => onToggle(a, include)}
                      accessibilityLabel={`Count ${a.name} toward retirement`}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <View style={[styles.otherSection, { borderTopColor: theme.border }]}>{otherSavingsField}</View>

      {education.length > 0 && (
        <View style={[styles.eduBox, { borderColor: theme.border }]}>
          <Pressable
            onPress={() => setShowEducation((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showEducation }}
            style={styles.eduHeader}>
            <View style={styles.shrink}>
              <ThemedText type="small" themeColor="textSecondary">
                {education.length} education {education.length === 1 ? 'account' : 'accounts'} excluded automatically ·{' '}
                {formatWholeCurrency(eduTotal)}
              </ThemedText>
            </View>
            <Icon name={showEducation ? 'chevronUp' : 'chevronDown'} size={16} themeColor="textSecondary" />
          </Pressable>
          {showEducation && (
            <View style={[styles.eduBody, { borderTopColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary">
                College savings (529) and custodial accounts belong to or are earmarked for someone else, so they’re never
                counted toward retirement.
              </ThemedText>
              {education.map((a) => (
                <View key={a.id} style={styles.eduRow}>
                  <View style={styles.shrink}>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {a.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {[a.institutionName, formatSubtype(a.subtype)].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.amount}>
                    {formatWholeCurrency(a.value)}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={[styles.totalRow, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" style={styles.shrink}>
          Total counted toward retirement
        </ThemedText>
        <ThemedText type="cardTitle" style={styles.amount}>
          {formatWholeCurrency(total)}
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  mixBox: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  mixHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  mixTrack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  mixSeg: { height: '100%', minWidth: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half },
  dot: { width: 8, height: 8, borderRadius: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  group: { gap: Spacing.two },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
  listBox: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  dimmed: { opacity: 0.72 },
  accountInfo: { flex: 1, flexShrink: 1, gap: 2 },
  accountRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amount: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  otherSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  eduBox: { borderWidth: 1, borderRadius: Spacing.three },
  eduHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  eduBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  eduRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shrink: { flex: 1, flexShrink: 1 },
  shrinkText: { flexShrink: 1 },
});
