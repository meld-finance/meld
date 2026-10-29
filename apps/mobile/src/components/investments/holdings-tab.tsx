import { positionsBySecurity, type Holding, type InvestmentsSummary } from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { InsightCallout, TabHeading } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatWholeCurrency } from '@/lib/format';
import { formatShare, gainPercent, holdingCategory } from '@/lib/investments';
import { useContentWidth } from '@/lib/chat-panel';

const ALL = 'all';
/** Below this window width the table drops to security, value and gain. */
const TABLE_MIN_WIDTH = 900;

function matches(h: Holding, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [h.ticker, h.name, h.accountName, h.profile?.category].some((s) => s?.toLowerCase().includes(q));
}

export function HoldingsTab({ data }: { data: InvestmentsSummary }) {
  const theme = useTheme();
  const wide = useContentWidth() >= TABLE_MIN_WIDTH;
  const [account, setAccount] = useState(ALL);
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = data.holdings.filter((h) => (account === ALL || h.accountId === account) && matches(h, search));

  const positions = positionsBySecurity(data.holdings);
  const topCount = Math.min(5, positions.length);
  const top = positions.slice(0, topCount).reduce((s, p) => s + p.value, 0);

  return (
    <>
      <TabHeading
        title="Your holdings"
        subtitle="Your individual positions. Filter by account, or search for a security."
        actions={
          <>
            <Dropdown
              accessibilityLabel="Account"
              value={account}
              onChange={setAccount}
              options={[{ value: ALL, label: 'All accounts' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
            <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <Icon name="search" size={16} themeColor="textSecondary" />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search holdings…"
                placeholderTextColor={theme.textSecondary}
                value={search}
                onChangeText={setSearch}
                clearButtonMode="while-editing"
              />
            </View>
          </>
        }
      />

      <Card>
        <View style={[styles.row, styles.headerRow]}>
          <Header label="Security" style={styles.security} />
          <Header label="Value" style={styles.num} />
          {wide && <Header label="% of portfolio" style={styles.num} />}
          <Header label="Gain / loss" style={styles.num} />
          {wide && <Header label="Category" style={styles.text} />}
          {wide && <Header label="Account" style={styles.text} />}
        </View>
        {shown.map((h) => {
          const gain = gainPercent(h);
          return (
            <View
              key={h.id}
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                hovered === h.id && styles.raised,
              ]}>
              <View style={[styles.security, styles.securityCell]}>
                <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="smallBold" themeColor="tint" style={styles.badgeText}>
                    {(h.ticker ?? h.name ?? '?').replace(/^CUR:/, '$')[0]}
                  </ThemedText>
                </View>
                <View style={styles.shrink}>
                  <ThemedText type="small" numberOfLines={1}>
                    {h.ticker ? <ThemedText type="smallBold">{h.ticker} · </ThemedText> : null}
                    {h.name ?? 'Unknown security'}
                  </ThemedText>
                  {!wide && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {holdingCategory(h)} · {h.accountName}
                    </ThemedText>
                  )}
                </View>
              </View>
              <ThemedText type="smallBold" style={styles.num}>
                {formatWholeCurrency(h.value)}
              </ThemedText>
              {wide && (
                <ThemedText type="small" style={styles.num}>
                  {formatShare(h.value ?? 0, data.totalValue)}
                </ThemedText>
              )}
              <ThemedText type="small" themeColor={gain === null ? 'textSecondary' : gain >= 0 ? 'positive' : 'negative'} style={styles.num}>
                {gain === null ? '—' : `${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}%`}
              </ThemedText>
              {wide && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.text} numberOfLines={1}>
                  {holdingCategory(h)}
                </ThemedText>
              )}
              {wide && (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`View account ${h.accountName}`}
                  onPress={() => router.push({ pathname: '/account/[id]', params: { id: h.accountId } })}
                  onHoverIn={() => setHovered(h.id)}
                  onHoverOut={() => setHovered((id) => (id === h.id ? null : id))}
                  style={styles.text}>
                  <ThemedText
                    type="small"
                    themeColor={hovered === h.id ? 'tint' : 'textSecondary'}
                    numberOfLines={1}
                    style={hovered === h.id && styles.underline}>
                    {h.accountName}
                  </ThemedText>
                  {hovered === h.id && (
                    <View
                      pointerEvents="none"
                      style={[styles.tooltip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                      <ThemedText type="small">{h.accountName}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Click for account details
                      </ThemedText>
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
        {!shown.length && (
          <ThemedText type="small" themeColor="textSecondary">
            No holdings match.
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          Gain/loss is value against cost basis, where your institution reports it.
        </ThemedText>
      </Card>

      {topCount > 0 && (
        <InsightCallout
          title="Ask Meld"
          body={`Your top ${topCount} holdings make up ${formatShare(top, data.totalValue)} of your portfolio. Want to know whether that’s a concentration risk?`}
          question={`My top ${topCount} holdings make up ${formatShare(top, data.totalValue)} of my portfolio. Is that a concentration risk, and what would you change?`}
          action="Ask about it"
        />
      )}
    </>
  );
}

function Header({ label, style }: { label: string; style: object }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={style} numberOfLines={1}>
      {label}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    minWidth: 220,
  },
  searchInput: { flex: 1, paddingVertical: Spacing.one + Spacing.half, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two + Spacing.half },
  headerRow: { paddingTop: 0 },
  security: { flex: 3, minWidth: 0 },
  securityCell: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  shrink: { flexShrink: 1 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 13, lineHeight: 16 },
  num: { width: 104, textAlign: 'right', fontVariant: ['tabular-nums'] },
  text: { flex: 1.2, minWidth: 0 },
  raised: { zIndex: 1 },
  underline: { textDecorationLine: 'underline' },
  tooltip: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: Spacing.one,
    minWidth: 200,
    maxWidth: 320,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
