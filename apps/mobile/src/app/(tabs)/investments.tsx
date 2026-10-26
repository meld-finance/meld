import type { Holding, TaxTreatment } from '@meld/shared';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { RankedBars, type RankedRow } from '@/components/charts/ranked-bars';
import { HoldingsList } from '@/components/holdings-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatCurrency } from '@/lib/format';
import { useInvestments } from '@/lib/queries';

const SECURITY_LABELS: Record<string, string> = {
  cash: 'Cash',
  equity: 'Stocks',
  etf: 'ETFs',
  'mutual fund': 'Mutual funds',
  'fixed income': 'Bonds',
  derivative: 'Options',
  cryptocurrency: 'Crypto',
  loan: 'Loans',
};

const TAX_LABELS: Record<TaxTreatment, string> = {
  taxable: 'Taxable',
  tax_deferred: 'Tax-deferred',
  tax_free: 'Tax-free',
  unknown: 'Unclassified',
};

function sumBy(holdings: Holding[], keyOf: (h: Holding) => string, labelOf: (key: string) => string): RankedRow[] {
  const totals = new Map<string, number>();
  for (const h of holdings) totals.set(keyOf(h), (totals.get(keyOf(h)) ?? 0) + (h.value ?? 0));
  return [...totals].map(([key, amount]) => ({ key, label: labelOf(key), amount }));
}

export default function InvestmentsScreen() {
  const investments = useInvestments();
  const data = investments.data;

  return (
    <Screen
      title="Investments"
      refreshControl={<RefreshControl refreshing={investments.isRefetching} onRefresh={() => void investments.refetch()} />}>
      {investments.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : investments.isError ? (
        <ThemedText themeColor="negative">Couldn’t load investments: {investments.error.message}</ThemedText>
      ) : !data!.holdings.length ? (
        <Card title="No holdings yet">
          <ThemedText type="small" themeColor="textSecondary">
            Link a brokerage or retirement account to see holdings here. Accounts linked before investments were
            enabled may need to be removed and linked again.
          </ThemedText>
        </Card>
      ) : (
        <>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              Total invested
            </ThemedText>
            <ThemedText type="title">{formatCurrency(data!.totalValue)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {data!.holdings.length} holdings · values as reported by your institutions
            </ThemedText>
          </Card>

          <View style={styles.columns}>
            <Card title="By asset type" style={styles.column}>
              <RankedBars
                rows={sumBy(data!.holdings, (h) => h.securityType ?? 'other', (k) => SECURITY_LABELS[k] ?? 'Other')}
                showShare
              />
            </Card>
            <Card
              title="By tax treatment"
              subtitle="Tax-deferred: 401k, IRA · Tax-free: Roth, HSA, 529"
              style={styles.column}>
              <RankedBars
                rows={sumBy(data!.holdings, (h) => h.taxTreatment, (k) => TAX_LABELS[k as TaxTreatment])}
                showShare
              />
            </Card>
          </View>

          <Card title="Holdings" subtitle="Gain/loss is value minus cost basis, where your institution reports it.">
            <HoldingsList holdings={data!.holdings} showAccount />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 320 },
});
