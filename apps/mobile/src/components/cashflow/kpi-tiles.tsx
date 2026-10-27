import type { CashflowPeriod } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatPercent, percentChange, type Period } from '@/lib/cashflow';
import { formatWholeCurrency } from '@/lib/format';

type Kpi = {
  label: string;
  value: number;
  previous: number;
  icon: IconName;
  accent: Accent;
  /** Spending going down is the good direction. */
  lowerIsBetter?: boolean;
};

export function KpiTiles({ period, p }: { period: CashflowPeriod; p: Period }) {
  const net = period.income - period.spending;
  const previousNet = period.previousIncome - period.previousSpending;
  const kpis: Kpi[] = [
    { label: 'Total Spending', value: period.spending, previous: period.previousSpending, icon: 'card', accent: 'blue', lowerIsBetter: true },
    { label: 'Total Income', value: period.income, previous: period.previousIncome, icon: 'wallet', accent: 'green' },
    { label: 'Net Cash Flow', value: net, previous: previousNet, icon: 'barChart', accent: 'purple' },
  ];
  return (
    <View style={styles.row}>
      {kpis.map((k) => (
        <KpiTile key={k.label} kpi={k} comparison={p.comparison} />
      ))}
    </View>
  );
}

function KpiTile({ kpi, comparison }: { kpi: Kpi; comparison: string }) {
  const theme = useTheme();
  const accent = useAccents()[kpi.accent];
  const pct = percentChange(kpi.value, kpi.previous);
  // A percentage off a zero or negative base is meaningless; show the dollar change instead.
  const delta = kpi.value - kpi.previous;
  const up = delta >= 0;
  const good = kpi.lowerIsBetter ? !up : up;

  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.badge, { backgroundColor: accent.bg }]}>
        <Icon name={kpi.icon} size={24} color={accent.fg} />
      </View>
      <View style={styles.text}>
        <ThemedText type="small">{kpi.label}</ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {formatWholeCurrency(kpi.value)}
        </ThemedText>
        {kpi.previous === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No data for {comparison}
          </ThemedText>
        ) : (
          <>
            <View style={styles.change}>
              <Icon name={up ? 'arrowUp' : 'arrowDown'} size={16} themeColor={good ? 'positive' : 'negative'} strokeWidth={2.25} />
              <ThemedText type="smallBold" themeColor={good ? 'positive' : 'negative'}>
                {pct === null ? formatWholeCurrency(Math.abs(delta)) : formatPercent(pct)}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
              vs. {comparison}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 220,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
  },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  text: { flexShrink: 1, gap: Spacing.one },
  value: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.4 },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  caption: { fontSize: 13 },
});
