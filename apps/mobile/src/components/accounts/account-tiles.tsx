import type { BalanceSnapshot, NetWorthSummary } from '@meld/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Change, percentChange } from '@/components/accounts/change';
import type { AccountFilter } from '@/components/accounts/groups';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';

type ByType = NetWorthSummary['byType'][number]['type'];
type Tile = { label: string; types: ByType[] | 'netWorth'; icon: IconName; accent: Accent; filter: AccountFilter };

const total = (byType: NetWorthSummary['byType'], types: ByType[]) =>
  byType.filter((t) => types.includes(t.type)).reduce((sum, t) => sum + t.total, 0);

/** Headline balances with their change since `comparison`; tapping one filters the list below. */
export function AccountTiles({
  summary,
  comparison,
  onSelect,
}: {
  summary: NetWorthSummary;
  comparison: BalanceSnapshot | null | undefined;
  onSelect: (filter: AccountFilter) => void;
}) {
  const tiles: Tile[] = [
    { label: 'Net worth', types: 'netWorth', icon: 'bank', accent: 'blue', filter: 'all' },
    { label: 'Cash & checking', types: ['depository'], icon: 'card', accent: 'green', filter: 'banking' },
    { label: 'Investments', types: ['investment'], icon: 'chart', accent: 'purple', filter: 'investments' },
    { label: 'Insurance (cash value)', types: ['insurance'], icon: 'shield', accent: 'teal', filter: 'insurance' },
  ];
  return (
    <View style={styles.row}>
      {tiles.map((t) => {
        const now = t.types === 'netWorth' ? summary.netWorth : total(summary.byType, t.types);
        const then =
          comparison && (t.types === 'netWorth' ? comparison.netWorth : total(comparison.byType, t.types));
        return (
          <AccountTile key={t.label} tile={t} value={now} percent={percentChange(now, then)} onPress={() => onSelect(t.filter)} />
        );
      })}
    </View>
  );
}

function AccountTile({ tile, value, percent, onPress }: { tile: Tile; value: number; percent: number | null; onPress: () => void }) {
  const theme = useTheme();
  const accent = useAccents()[tile.accent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Show these accounts"
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.badge, { backgroundColor: accent.bg }]}>
        <Icon name={tile.icon} size={20} color={accent.fg} />
      </View>
      <View style={styles.text}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {tile.label}
        </ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {formatWholeCurrency(value)}
        </ThemedText>
        {percent !== null && (
          <View>
            <Change percent={percent} style={styles.change} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
              vs. last month
            </ThemedText>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 170,
    minWidth: 150,
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    gap: Spacing.three,
  },
  badge: { width: 40, height: 40, borderRadius: Spacing.two + Spacing.one, alignItems: 'center', justifyContent: 'center' },
  text: { gap: Spacing.one },
  value: { fontSize: 24, lineHeight: 30, fontWeight: 700, letterSpacing: -0.3 },
  change: { justifyContent: 'flex-start' },
  caption: { fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.75 },
});
