import { lookThrough, type AssetClass, type InvestmentsSummary } from '@meld/shared';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Donut } from '@/components/charts/donut';
import { InsightCallout, StatTile, TileRow } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { ASSET_CLASS_SLOTS, assetClassRows, changeAgainst, formatShare, overviewInsight, UNCLASSIFIED } from '@/lib/investments';

/** Accounts listed by name; the rest are summed into one row. */
const MAX_ACCOUNTS = 6;

export function OverviewTab({ data, onShowExposure }: { data: InvestmentsSummary; onShowExposure: () => void }) {
  const theme = useTheme();
  const viz = useVizColors();
  const e = lookThrough(data.holdings);
  const total = data.totalValue;
  const stocks = e.stocks;
  const bonds = e.bonds;
  const rest = total - stocks - bonds;
  const rows = assetClassRows(e);
  const colorOf = (key: string) => (key === UNCLASSIFIED ? viz.other : viz.categorical[ASSET_CLASS_SLOTS[key as AssetClass]]!);
  const insight = overviewInsight(e);
  const change = data.change;
  const otherAccounts = data.accounts.slice(MAX_ACCOUNTS);
  const otherTotal = otherAccounts.reduce((sum, a) => sum + a.value, 0);

  return (
    <>
      <TileRow>
        <StatTile
          label="Total invested"
          value={total}
          change={
            change && change.current > 0
              ? // The change compares account balances, which can differ a little from the sum of holdings.
                { previous: total * (change.previous / change.current), against: changeAgainst(change.since) }
              : undefined
          }
          caption={`${data.holdings.length} holdings`}
        />
        <StatTile label="Stocks" value={stocks} caption={`${formatShare(stocks, total)} of portfolio`} />
        <StatTile label="Bonds" value={bonds} caption={`${formatShare(bonds, total)} of portfolio`} />
        <StatTile
          label={e.unclassified >= 0.5 ? 'Cash, other & not looked up' : 'Cash & other'}
          value={rest}
          caption={`${formatShare(rest, total)} of portfolio`}
        />
      </TileRow>

      <View style={styles.columns}>
        <Card title="Asset allocation" subtitle="Looking through funds to what they hold" style={styles.column}>
          <View style={styles.allocation}>
            <Donut parts={rows.map((r) => ({ key: r.key, amount: r.amount, color: colorOf(r.key) }))} size={168} stroke={28}>
              <ThemedText style={styles.donutTotal}>{formatCompactCurrency(total)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.donutCaption}>
                Total invested
              </ThemedText>
            </Donut>
            <View style={styles.legend}>
              {rows.map((r) => (
                <View key={r.key} style={styles.legendRow}>
                  <View style={[styles.dot, { backgroundColor: colorOf(r.key) }]} />
                  <ThemedText type="small" style={styles.legendLabel} numberOfLines={1}>
                    {r.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.pct}>
                    {formatShare(r.amount, total)}
                  </ThemedText>
                  <ThemedText type="smallBold" style={styles.amount}>
                    {formatWholeCurrency(r.amount)}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>
          <Pressable accessibilityRole="link" onPress={onShowExposure} style={styles.footerLink}>
            <ThemedText type="small" themeColor="tint">
              View detailed breakdown →
            </ThemedText>
          </Pressable>
        </Card>

        <Card title="Your accounts" style={styles.column}>
          <View style={styles.accounts}>
            {data.accounts.slice(0, MAX_ACCOUNTS).map((a, i) => (
              <Pressable
                key={a.id}
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.id } })}
                style={({ hovered }) => [styles.accountRow, hovered && { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.ring, { borderColor: viz.categorical[i % viz.categorical.length] }]} />
                <View style={styles.legendLabel}>
                  <ThemedText type="small" numberOfLines={1}>
                    {a.name}
                  </ThemedText>
                  {a.institutionName && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.institution}>
                      {a.institutionName}
                    </ThemedText>
                  )}
                </View>
                <ThemedText type="smallBold" style={styles.amount}>
                  {formatWholeCurrency(a.value)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.pct}>
                  {formatShare(a.value, total)}
                </ThemedText>
              </Pressable>
            ))}
            {otherAccounts.length > 0 && (
              <View style={styles.accountRow}>
                <View style={[styles.ring, { borderColor: viz.other }]} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.legendLabel}>
                  {otherAccounts.length} other {otherAccounts.length === 1 ? 'account' : 'accounts'}
                </ThemedText>
                <ThemedText type="smallBold" style={styles.amount}>
                  {formatWholeCurrency(otherTotal)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.pct}>
                  {formatShare(otherTotal, total)}
                </ThemedText>
              </View>
            )}
          </View>
          <Link href="/accounts" style={styles.footerLink}>
            <ThemedText type="small" themeColor="tint">
              View all accounts →
            </ThemedText>
          </Link>
        </Card>
      </View>

      {insight && (
        <InsightCallout title={insight.title} body={insight.body} question={insight.question} icon="pie" accent="green" />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 420 },
  allocation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  donutTotal: { fontSize: 20, lineHeight: 26, fontWeight: 700 },
  donutCaption: { fontSize: 12, lineHeight: 16 },
  legend: { flexGrow: 1, flexBasis: 240, gap: Spacing.two },
  accounts: { gap: Spacing.one },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.one,
    borderRadius: Spacing.two,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  ring: { width: 14, height: 14, borderRadius: 7, borderWidth: 4 },
  legendLabel: { flex: 1, minWidth: 0 },
  institution: { fontSize: 12, lineHeight: 16 },
  pct: { width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] },
  amount: { minWidth: 92, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footerLink: { alignSelf: 'center', marginTop: 'auto' },
});
