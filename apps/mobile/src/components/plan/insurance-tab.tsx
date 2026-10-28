import {
  annualPremium,
  hasCashValue,
  insuranceTotals,
  isCashValueStale,
  isDisabilityPolicy,
  isLapsed,
  isLifePolicy,
  netCashValue,
  type InsurancePolicy,
} from '@meld/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { FREQUENCY_SUFFIX, POLICY_TYPE_LABELS } from '@/lib/insurance';
import type { useInsurancePolicies } from '@/lib/queries';

const GROUPS: { label: string; match: (p: InsurancePolicy) => boolean }[] = [
  { label: 'Life', match: (p) => isLifePolicy(p.type) },
  { label: 'Disability', match: (p) => isDisabilityPolicy(p.type) },
  { label: 'Other', match: (p) => p.type === 'other' },
];

const today = () => new Date().toLocaleDateString('en-CA');

/** Life and disability coverage, totals first. The Plan screen owns the query and the Add button. */
export function InsuranceTab({ policies }: { policies: ReturnType<typeof useInsurancePolicies> }) {
  if (policies.isPending) return <ThemedText themeColor="textSecondary">Loading…</ThemedText>;
  if (policies.isError) {
    return <ThemedText themeColor="negative">Couldn’t load policies: {policies.error.message}</ThemedText>;
  }
  if (policies.data.length === 0) {
    return (
      <Card title="No policies yet">
        <ThemedText type="small" themeColor="textSecondary">
          Add your life and disability insurance, including coverage through work, so Meld can include it in your
          financial picture. Upload a policy PDF or benefits summary to fill in the details automatically, or enter them
          by hand.
        </ThemedText>
      </Card>
    );
  }
  return (
    <>
      <Totals policies={policies.data} />
      {GROUPS.map(({ label, match }) => {
        const group = policies.data.filter(match);
        return group.length ? (
          <Card key={label} title={label}>
            {group.map((p) => (
              <PolicyRow key={p.id} policy={p} />
            ))}
          </Card>
        ) : null;
      })}
    </>
  );
}

function Totals({ policies }: { policies: InsurancePolicy[] }) {
  const t = insuranceTotals(policies, today());
  const hasLife = policies.some((p) => isLifePolicy(p.type));
  const hasStd = policies.some((p) => p.type === 'disability_short');
  const hasLtd = policies.some((p) => p.type === 'disability_long');
  const hasPermanent = policies.some((p) => hasCashValue(p.type));
  const tiles: [string, string][] = [
    ['Life insurance', hasLife ? formatWholeCurrency(t.lifeCoverage) : 'None'],
    ['Long-term disability', hasLtd ? `${formatWholeCurrency(t.longTermDisabilityMonthly)}/mo` : 'None'],
    ...(hasStd ? [['Short-term disability', `${formatWholeCurrency(t.shortTermDisabilityMonthly)}/mo`] as [string, string]] : []),
    ...(hasPermanent ? [['Cash surrender value', formatWholeCurrency(t.cashValue)] as [string, string]] : []),
    ['Premiums', `${formatWholeCurrency(t.annualPremiums)}/yr`],
  ];
  return (
    <Card>
      <View style={styles.tiles}>
        {tiles.map(([label, value]) => (
          <View key={label} style={styles.tile}>
            <ThemedText type="small" themeColor="textSecondary">
              {label}
            </ThemedText>
            <ThemedText type="subtitle" themeColor={value === 'None' ? 'textSecondary' : 'text'}>
              {value}
            </ThemedText>
          </View>
        ))}
      </View>
    </Card>
  );
}

function PolicyRow({ policy: p }: { policy: InsurancePolicy }) {
  const lapsed = isLapsed(p, today());
  const premium = annualPremium(p);
  const surrender = netCashValue(p);
  const details = [
    POLICY_TYPE_LABELS[p.type],
    p.employerProvided && 'Through work',
    p.insuredName,
    p.policyNumberMask && `••${p.policyNumberMask}`,
    p.type === 'life_term' && p.termEndDate && `${lapsed ? 'Ended' : 'Ends'} ${formatDate(p.termEndDate)}`,
    surrender !== null &&
      `${formatWholeCurrency(surrender)} surrender value${p.valuesAsOf ? ` as of ${formatDate(p.valuesAsOf)}` : ''}`,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/insurance/[id]', params: { id: p.id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.shrink}>
        <ThemedText numberOfLines={1}>{p.carrier}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {details.join(' · ')}
        </ThemedText>
        {lapsed && (
          <ThemedText type="small" themeColor="warning">
            Term has ended, so this isn’t counted in your coverage.
          </ThemedText>
        )}
        {isCashValueStale(p, today()) && (
          <ThemedText type="small" themeColor="warning">
            Cash values are over a year old. Update them from your latest annual statement.
          </ThemedText>
        )}
      </View>
      <View style={styles.amounts}>
        <ThemedText>
          {formatWholeCurrency(p.coverageAmount)}
          {isDisabilityPolicy(p.type) && p.coverageAmount !== null ? '/mo' : ''}
        </ThemedText>
        {p.premiumAmount !== null && p.premiumFrequency && (
          <ThemedText type="small" themeColor="textSecondary">
            {premium === 0 ? 'No cost to you' : `${formatCurrency(p.premiumAmount)}${FREQUENCY_SUFFIX[p.premiumFrequency]}`}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  tile: { minWidth: 150, flex: 1, gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  amounts: { alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
});
