import { insuranceTotals, type Account, type InsurancePolicy, type NetWorthSummary } from '@meld/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';

type Tile = { label: string; value: string; caption: string; icon: IconName; accent: Accent; href: Href };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function buildTiles(summary: NetWorthSummary, accounts: Account[], policies: InsurancePolicy[] | undefined): Tile[] {
  const total = (...types: NetWorthSummary['byType'][number]['type'][]) =>
    summary.byType.filter((t) => types.includes(t.type)).reduce((sum, t) => sum + t.total, 0);
  const count = (...types: Account['type'][]) => accounts.filter((a) => types.includes(a.type)).length;

  const tiles: Tile[] = [
    {
      label: 'Bank Accounts',
      value: formatWholeCurrency(total('depository')),
      caption: plural(count('depository'), 'account'),
      icon: 'bank',
      accent: 'blue',
      href: '/accounts',
    },
    {
      label: 'Cards',
      value: formatWholeCurrency(total('credit')),
      caption: plural(count('credit'), 'card'),
      icon: 'card',
      accent: 'green',
      href: '/accounts',
    },
    {
      label: 'Investments',
      value: formatWholeCurrency(total('investment')),
      caption: plural(count('investment'), 'account'),
      icon: 'chart',
      accent: 'purple',
      href: '/investments',
    },
    {
      label: 'Mortgages & Loans',
      value: formatWholeCurrency(total('mortgage', 'loan')),
      caption: plural(count('mortgage', 'loan'), 'loan'),
      icon: 'home',
      accent: 'orange',
      href: '/accounts',
    },
  ];

  if (policies) {
    const today = new Date().toLocaleDateString('en-CA');
    const totals = insuranceTotals(policies, today);
    const disabilityMonthly = totals.longTermDisabilityMonthly || totals.shortTermDisabilityMonthly;
    const kinds = [totals.lifeCoverage && 'Life', disabilityMonthly && 'Disability'].filter(Boolean).join(' + ');
    tiles.push({
      label: 'Insurance',
      // Life coverage is the headline; a disability-only household sees its monthly benefit instead.
      value: totals.lifeCoverage
        ? formatWholeCurrency(totals.lifeCoverage)
        : disabilityMonthly
          ? `${formatWholeCurrency(disabilityMonthly)}/mo`
          : '—',
      caption:
        [kinds, totals.cashValue && `${formatWholeCurrency(totals.cashValue)} cash value`].filter(Boolean).join(' · ') ||
        (policies.length ? plural(policies.length, 'policy', 'policies') : 'Add a policy'),
      icon: 'shield',
      accent: 'teal',
      href: '/plan',
    });
  }

  const property = total('manual');
  if (property) {
    tiles.push({
      label: 'Property & Other',
      value: formatWholeCurrency(property),
      caption: 'Manual assets',
      icon: 'wallet',
      accent: 'blue',
      href: '/accounts',
    });
  }
  return tiles;
}

export function SummaryTiles(props: {
  summary: NetWorthSummary;
  accounts: Account[];
  policies: InsurancePolicy[] | undefined;
}) {
  return (
    <View style={styles.row}>
      {buildTiles(props.summary, props.accounts, props.policies).map((t) => (
        <SummaryTile key={t.label} tile={t} />
      ))}
    </View>
  );
}

function SummaryTile({ tile }: { tile: Tile }) {
  const theme = useTheme();
  const accent = useAccents()[tile.accent];
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(tile.href)}
      style={({ hovered, pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.badge, { backgroundColor: accent.bg }]}>
        <Icon name={tile.icon} size={20} color={accent.fg} />
      </View>
      <View style={styles.text}>
        <ThemedText type="small" numberOfLines={1}>
          {tile.label}
        </ThemedText>
        <ThemedText style={styles.value} numberOfLines={1}>
          {tile.value}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.caption} numberOfLines={1}>
          {tile.caption}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    gap: Spacing.three,
  },
  badge: { width: 40, height: 40, borderRadius: Spacing.two + Spacing.one, alignItems: 'center', justifyContent: 'center' },
  text: { gap: Spacing.one },
  value: { fontSize: 22, lineHeight: 28, fontWeight: 700, letterSpacing: -0.3 },
  caption: { fontSize: 13 },
  pressed: { opacity: 0.75 },
});
