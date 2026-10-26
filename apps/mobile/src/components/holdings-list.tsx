import type { Holding } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency } from '@/lib/format';

const quantityFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

export function HoldingsList({ holdings, showAccount }: { holdings: Holding[]; showAccount?: boolean }) {
  const theme = useTheme();
  if (!holdings.length) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No holdings reported for this account.
      </ThemedText>
    );
  }
  return (
    <View>
      {holdings.map((h, i) => {
        const gain = h.value !== null && h.costBasis !== null ? h.value - h.costBasis : null;
        const isCash = h.securityType === 'cash';
        return (
          <View
            key={h.id}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
            <View style={styles.shrink}>
              <ThemedText numberOfLines={1}>
                {h.ticker ? `${h.ticker} · ` : ''}
                {h.name ?? 'Unknown security'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {[
                  isCash ? 'Cash' : `${quantityFormat.format(h.quantity)} × ${formatCurrency(h.price)}`,
                  showAccount ? h.accountName : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </View>
            <View style={styles.right}>
              <ThemedText style={styles.numeric}>{formatCurrency(h.value)}</ThemedText>
              {gain !== null && !isCash && (
                <ThemedText type="small" themeColor={gain >= 0 ? 'positive' : 'negative'} style={styles.numeric}>
                  {gain >= 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(gain))}
                </ThemedText>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  shrink: { flexShrink: 1, flexGrow: 1 },
  right: { alignItems: 'flex-end' },
  numeric: { fontVariant: ['tabular-nums'] },
});
