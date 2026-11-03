import type { BondPosition } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { InsightCallout } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatWholeCurrency } from '@/lib/format';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const years = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)} yrs`;

/** Bond funds and bonds: the price change since you bought next to what they pay now. */
export function BondsCard({ positions }: { positions: BondPosition[] }) {
  const theme = useTheme();
  const annualized = positions.some((p) => p.paidDays !== null && p.paidDays < 365);
  const shortest = Math.min(...positions.map((p) => p.paidDays ?? 365));
  const down = positions.filter((p) => p.priceChange !== null && p.priceChange < -0.02 && p.kind === 'fund');
  const worst = down.sort((a, b) => a.priceChange! - b.priceChange!)[0];

  return (
    <>
      <Card
        title="Bonds: price vs. what they pay"
        subtitle="When rates rise, bond prices fall, but the payouts you reinvest and any new money earn the higher rate.">
        <View>
          {positions.map((p, i) => (
            <View
              key={p.securityId}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
              <View style={styles.heading}>
                <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
                  {[p.ticker, p.name].filter(Boolean).join(' · ') || 'Bond'}
                </ThemedText>
                <ThemedText type="smallBold" style={styles.numeric}>
                  {formatWholeCurrency(p.value)}
                </ThemedText>
              </View>
              {p.priceChange !== null && (
                <ThemedText type="small" themeColor={p.priceChange < 0 ? 'negative' : 'textSecondary'}>
                  {p.priceChange < 0 ? 'Down' : 'Up'} {pct(Math.abs(p.priceChange))} vs. {formatWholeCurrency(p.costBasis)} paid
                </ThemedText>
              )}
              <View style={styles.metrics}>
                {p.paidYield !== null && <Metric label="Paying now" value={pct(p.paidYield)} />}
                {p.yieldOnCost !== null && <Metric label="On what you paid" value={pct(p.yieldOnCost)} />}
                {p.marketYield !== null && <Metric label={p.kind === 'bond' ? 'Yield to maturity' : 'SEC yield (est.)'} value={pct(p.marketYield)} />}
                {p.duration !== null && <Metric label="Duration (est.)" value={years(p.duration)} />}
              </View>
              <Explanation p={p} />
            </View>
          ))}
        </View>
        {annualized && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            Payouts are annualized from as little as {Math.max(1, Math.round(shortest / 30))} months of history. SEC yield and duration are AI
            estimates from published fund data and may be out of date.
          </ThemedText>
        )}
      </Card>
      {worst && (
        <InsightCallout
          icon="info"
          body={`${worst.ticker ?? worst.name} is down ${pct(-worst.priceChange!)} from what you paid${
            worst.paidYield !== null ? ` but pays ${pct(worst.paidYield)} on today’s value` : ''
          }. Ask whether to hold, sell for a tax loss, or switch to shorter bonds.`}
          question={`My bond fund ${worst.ticker ?? worst.name} is down ${pct(-worst.priceChange!)} from my cost basis${
            worst.paidYield !== null ? ` and pays ${pct(worst.paidYield)} on today’s value` : ''
          }${worst.duration !== null ? `, with a duration of about ${years(worst.duration)}` : ''}. Should I hold it, harvest the loss, or move to shorter-duration bonds?`}
        />
      )}
    </>
  );
}

function Explanation({ p }: { p: BondPosition }) {
  let text: string | null = null;
  if (p.kind === 'bond' && p.maturityDate && p.parValue !== null) {
    const gap = p.parValue - p.value;
    text = `Matures ${formatDate(p.maturityDate)}: you get ${formatWholeCurrency(p.parValue)} back${
      Math.abs(gap) >= 1 ? `, ${formatWholeCurrency(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than today’s value` : ''
    }. Held to maturity, today’s price doesn’t matter.`;
  } else if (p.kind === 'bond' && p.maturityDate) {
    text = `Matures ${formatDate(p.maturityDate)}, when it pays back its face value.`;
  } else if (p.yearsToCost !== null) {
    const rate = p.paidYield ?? p.marketYield!;
    text = `With payouts reinvested at ${pct(rate)}, it would grow back to what you paid in about ${years(p.yearsToCost)} if rates and prices hold.`;
  }
  return text ? (
    <ThemedText type="small" themeColor="textSecondary">
      {text}
    </ThemedText>
  ) : null;
}

function Metric({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.metricLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.numeric}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: Spacing.three, gap: Spacing.one },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  name: { flex: 1 },
  numeric: { fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginVertical: Spacing.one },
  metric: { borderWidth: 1, borderRadius: Spacing.two, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
  metricLabel: { fontSize: 12, lineHeight: 16 },
  footnote: { fontSize: 12, lineHeight: 16 },
});
