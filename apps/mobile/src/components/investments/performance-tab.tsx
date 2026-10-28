import type { InvestmentPerformance, PerformancePeriod, PerformanceTotals } from '@meld/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { GrowthTrend, type GrowthPoint } from '@/components/charts/growth-trend';
import { InsightCallout, StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatWholeCurrency } from '@/lib/format';

/** Periods offered in the picker; calendar years only appear in the table. */
const PICKER = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];
/** More points than this are thinned for the chart. */
const MAX_POINTS = 160;

function formatReturn(r: number | null): string {
  if (r === null) return '—';
  const pct = r * 100;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%`;
}

function signedCurrency(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatWholeCurrency(Math.abs(n))}`;
}

const net = (t: PerformanceTotals) => t.contributions - t.withdrawals;

function periodPhrase(p: PerformancePeriod): string {
  const phrases: Record<string, string> = { '1m': 'the last month', '3m': 'the last 3 months', ytd: 'this year so far', '1y': 'the last year' };
  return phrases[p.key] ?? `since ${formatDate(p.start)}`;
}

/** The period's daily points as value vs. money put in, thinned evenly but always keeping the last day. */
function growthPoints(data: InvestmentPerformance, period: PerformancePeriod): GrowthPoint[] {
  const slice = data.points.filter((p) => p.date >= period.start && p.date <= period.end);
  let contributed = period.startValue;
  const points = slice.map((p, i) => {
    if (i > 0) contributed += p.flow;
    return { date: p.date, value: p.value, contributed };
  });
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  return points.filter((_, i) => (points.length - 1 - i) % step === 0);
}

/** Investment growth, with deposits and withdrawals kept apart from what markets earned. */
export function PerformanceTab({ data }: { data: InvestmentPerformance }) {
  const options = PICKER.filter((o) => data.periods.some((p) => p.key === o.value));
  const [key, setKey] = useState(options.find((o) => o.value === '1y')?.value ?? options.at(-1)?.value ?? 'all');
  const period = data.periods.find((p) => p.key === key);

  if (!period) {
    return (
      <Card title="No performance history yet">
        <ThemedText type="small" themeColor="textSecondary">
          Performance appears once your institutions report investment transactions, or after Meld has recorded balances for a few days.
        </ThemedText>
      </Card>
    );
  }

  const netIn = net(period);
  const rangeLabel = `${formatDate(period.start)} – ${formatDate(period.end)}`;

  return (
    <>
      <TabHeading
        title="Performance"
        subtitle="How your investments grew, with money you added or withdrew kept separate from market gains."
        actions={<Segmented size="small" options={options} value={key} onChange={setKey} />}
      />
      <TileRow>
        <StatTile
          label="Investment gain"
          value={signedCurrency(period.gain)}
          caption="Market moves, dividends and interest"
        />
        <StatTile
          label="Growth rate"
          value={formatReturn(period.return)}
          caption={period.annualized !== null ? `${formatReturn(period.annualized)} a year` : 'Time-weighted, not annualized'}
        />
        <StatTile
          label="Net contributions"
          value={signedCurrency(netIn)}
          caption={`${formatWholeCurrency(period.contributions)} in · ${formatWholeCurrency(period.withdrawals)} out`}
        />
        <StatTile label="Portfolio value" value={period.endValue} caption={`From ${formatWholeCurrency(period.startValue)}`} />
      </TileRow>

      <Card title="Growth vs. money put in" subtitle={rangeLabel}>
        <GrowthTrend points={growthPoints(data, period)} />
      </Card>

      <View style={styles.columns}>
        <PeriodTable periods={data.periods} selected={key} style={styles.half} />
        <AccountTable period={period} style={styles.half} />
      </View>

      <DataNotes data={data} />

      <InsightCallout
        icon="info"
        body={`Over ${periodPhrase(period)}, markets ${
          period.gain >= 0 ? 'added' : 'took away'
        } ${formatWholeCurrency(Math.abs(period.gain))} and you ${netIn >= 0 ? 'added' : 'withdrew'} a net ${formatWholeCurrency(
          Math.abs(netIn),
        )}, a time-weighted return of ${formatReturn(period.return)}.`}
        question={`My investments returned ${formatReturn(period.return)} (time-weighted) from ${period.start} to ${period.end}, a gain of ${formatWholeCurrency(
          period.gain,
        )} with ${formatWholeCurrency(netIn)} of net contributions. How does that compare with a typical benchmark for my allocation?`}
      />
    </>
  );
}

function PeriodTable({ periods, selected, style }: { periods: PerformancePeriod[]; selected: string; style?: object }) {
  const theme = useTheme();
  return (
    <Card title="Returns by period" subtitle="Annualized for a year or more" style={style}>
      <View>
        <Row header cells={['Gain', 'Net added', 'Return', 'Per year']} label="" />
        {periods.map((p) => (
          <Row
            key={p.key}
            label={
              p.key === 'all'
                ? `Since ${formatDate(p.start)}`
                : /^\d{4}$/.test(p.key) && p.start !== `${Number(p.key) - 1}-12-31`
                  ? `${p.label} (from ${formatDate(p.start)})`
                  : p.label
            }
            highlight={p.key === selected ? theme.backgroundSelected : undefined}
            border={theme.border}
            cells={[signedCurrency(p.gain), signedCurrency(net(p)), formatReturn(p.return), formatReturn(p.annualized)]}
            tones={[p.gain, null, p.return, p.annualized]}
          />
        ))}
      </View>
    </Card>
  );
}

function AccountTable({ period, style }: { period: PerformancePeriod; style?: object }) {
  const theme = useTheme();
  return (
    <Card title="By account" subtitle={period.label === 'All' ? `Since ${formatDate(period.start)}` : period.label} style={style}>
      <View>
        <Row header cells={['Value', 'Net added', 'Gain', 'Return']} label="" />
        {period.byAccount.map((a) => (
          <Row
            key={a.accountId}
            label={a.accountName}
            border={theme.border}
            cells={[formatWholeCurrency(a.endValue), signedCurrency(net(a)), signedCurrency(a.gain), formatReturn(a.return)]}
            tones={[null, null, a.gain, a.return]}
          />
        ))}
      </View>
    </Card>
  );
}

function Row({
  label,
  cells,
  tones,
  header,
  highlight,
  border,
}: {
  label: string;
  cells: string[];
  /** Signed numbers color their cell green or red; null leaves it plain. */
  tones?: (number | null)[];
  header?: boolean;
  highlight?: string;
  border?: string;
}) {
  return (
    <View
      style={[
        styles.row,
        border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
        highlight && { backgroundColor: highlight },
      ]}>
      <ThemedText type="small" style={styles.name} numberOfLines={1}>
        {label}
      </ThemedText>
      {cells.map((c, i) => {
        const tone = tones?.[i];
        return (
          <ThemedText
            key={i}
            type="small"
            themeColor={header ? 'textSecondary' : tone == null || tone === 0 ? 'text' : tone > 0 ? 'positive' : 'negative'}
            style={styles.num}>
            {c}
          </ThemedText>
        );
      })}
    </View>
  );
}

/** Where the numbers are estimates, and why. */
function DataNotes({ data }: { data: InvestmentPerformance }) {
  const notes = [
    data.estimatedBefore &&
      `Values before ${formatDate(data.estimatedBefore)} are estimated by replaying your investment transactions against daily market prices; from then on they're the balances Meld recorded.`,
    data.approximated.length > 0 &&
      `No market price history for ${data.approximated.join(', ')}; earlier prices come from their own transactions, or today's price where there are none.`,
    data.limitedHistory.length > 0 &&
      `Little or no transaction history for ${data.limitedHistory
        .map((a) => (a.since ? `${a.accountName} (from ${formatDate(a.since)})` : a.accountName))
        .join(', ')}. Before that, these accounts are assumed to have had no trades or deposits, so their contributions may be understated.`,
  ].filter((n): n is string => !!n);
  if (!notes.length) return null;
  return (
    <View style={styles.notes}>
      {notes.map((n) => (
        <ThemedText key={n} type="small" themeColor="textSecondary">
          {n}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  half: { flexGrow: 1, flexBasis: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one },
  name: { flex: 1, minWidth: 80 },
  num: { width: 84, textAlign: 'right', fontVariant: ['tabular-nums'] },
  notes: { gap: Spacing.one },
});
