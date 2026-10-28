import { lookThrough, normalizeWeights, positionsBySecurity, type Holding, type InvestmentsSummary, type Sector } from '@meld/shared';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { ExposureBars, TabHeading } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { UnderlineTabs } from '@/components/underline-tabs';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatWholeCurrency } from '@/lib/format';
import {
  BOND_TYPE_LABELS,
  exposureRows,
  formatShare,
  REGION_LABELS,
  SECTOR_LABELS,
  UNCLASSIFIED,
  type ExposureRow,
} from '@/lib/investments';

type ExposureView = 'sectors' | 'geography' | 'bonds' | 'concentration';
const ALL = 'all';
/** Positions listed by name on the Concentration view. */
const TOP_POSITIONS = 10;

const securityName = (h: Holding) => (h.ticker ? `${h.ticker} · ${h.name ?? ''}` : (h.name ?? 'Unknown security'));
const isFund = (h: Holding) => h.securityType === 'etf' || h.securityType === 'mutual fund';

type Breakdown = {
  title: string;
  note: string;
  rows: ExposureRow[];
  total: number;
  insight: string;
  explore: string[];
};

function breakdownFor(view: ExposureView, holdings: Holding[], scope: string): Breakdown {
  const e = lookThrough(holdings);
  const notLookedUp = e.unclassified >= 0.5 ? ` ${formatWholeCurrency(e.unclassified)} in holdings not yet looked up isn’t included.` : '';

  if (view === 'sectors') {
    const rows = exposureRows(e.sectors, SECTOR_LABELS, { total: e.stocks, known: e.sectorsKnown, label: 'Unknown sector' });
    const top = rows.find((r) => r.key !== UNCLASSIFIED);
    let insight = 'There are no stocks here to break down by sector.';
    if (top) {
      // The holdings that put the most money into the top sector.
      const contributors = positionsBySecurity(holdings)
        .map((p) => {
          const h = p.holdings[0]!;
          const classes = h.profile ? normalizeWeights(h.profile.assetClasses) : {};
          const sector = h.profile ? (normalizeWeights(h.profile.sectors)[top.key as Sector] ?? 0) : 0;
          return { h, amount: p.value * ((classes.us_stocks ?? 0) + (classes.intl_stocks ?? 0)) * sector };
        })
        .filter((c) => c.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      const names = contributors.slice(0, 2).map((c) => c.h.name ?? c.h.ticker);
      const viaFunds = contributors.some((c) => isFund(c.h));
      insight = `${top.label} is your largest sector exposure at ${formatShare(top.amount, e.stocks)} of ${scope === ALL ? 'your stocks' : 'this account’s stocks'}${
        names.length ? `, mostly from ${names.join(' and ')}` : ''
      }.${viaFunds ? ' That includes companies held inside your funds.' : ''}`;
    }
    return {
      title: 'Sector exposure',
      note: `Share of ${formatWholeCurrency(e.stocks)} in stocks, including stocks held inside funds.${notLookedUp}`,
      rows,
      total: e.stocks,
      insight,
      explore: top
        ? [`What are my biggest companies in ${top.label.toLowerCase()}, including inside my funds?`, 'How does my sector mix compare with the overall market?']
        : ['Should I own more stocks?'],
    };
  }

  if (view === 'geography') {
    const rows = exposureRows(e.regions, REGION_LABELS, { total: e.stocks, known: e.regionsKnown, label: 'Unknown region' });
    const us = e.regions.united_states ?? 0;
    return {
      title: 'Geographic exposure',
      note: `Where the companies behind ${formatWholeCurrency(e.stocks)} in stocks are based.${notLookedUp}`,
      rows,
      total: e.stocks,
      insight: e.stocks
        ? `${formatShare(us, e.stocks)} of your stock exposure is in US companies and ${formatShare(e.regionsKnown - us, e.stocks)} outside the US.`
        : 'There are no stocks here to break down by region.',
      explore: ['Do I have enough international exposure?', 'How much of my portfolio is in emerging markets?'],
    };
  }

  if (view === 'bonds') {
    const rows = exposureRows(e.bondTypes, BOND_TYPE_LABELS, { total: e.bonds, known: e.bondTypesKnown, label: 'Unknown bond type' });
    const top = rows.find((r) => r.key !== UNCLASSIFIED);
    return {
      title: 'Bond exposure',
      note: `Your ${formatWholeCurrency(e.bonds)} in bonds by issuer, including bonds inside funds.${notLookedUp}`,
      rows,
      total: e.bonds,
      insight: !e.bonds
        ? `You don’t hold bonds ${scope === ALL ? 'in your portfolio' : 'in this account'}.`
        : `Bonds are ${formatShare(e.bonds, e.total)} of ${scope === ALL ? 'your portfolio' : 'this account'}${top ? `, mostly ${top.label.toLowerCase()} (${formatShare(top.amount, e.bonds)})` : ''}.`,
      explore: ['Is my bond allocation right for my age?', 'Should I hold bonds in taxable or retirement accounts?'],
    };
  }

  const positions = positionsBySecurity(holdings);
  const top = positions.slice(0, TOP_POSITIONS);
  const rest = positions.slice(TOP_POSITIONS).reduce((s, p) => s + p.value, 0);
  const rows: ExposureRow[] = top.map((p) => ({ key: p.securityId, label: securityName(p.holdings[0]!), amount: p.value }));
  if (rest >= 0.5) rows.push({ key: UNCLASSIFIED, label: `${positions.length - TOP_POSITIONS} other holdings`, amount: rest });
  const top5 = positions.slice(0, 5).reduce((s, p) => s + p.value, 0);
  return {
    title: 'Largest positions',
    note: 'Each security across all the accounts that hold it.',
    rows,
    total: e.total,
    insight: positions.length
      ? `Your top ${Math.min(5, positions.length)} holdings make up ${formatShare(top5, e.total)} of ${scope === ALL ? 'your portfolio' : 'this account'}; the largest, ${securityName(positions[0]!.holdings[0]!)}, is ${formatShare(positions[0]!.value, e.total)}.`
      : 'No holdings here.',
    explore: ['Is my portfolio too concentrated in any single holding?', 'How much single-stock risk do I have?'],
  };
}

export function ExposureTab({ data }: { data: InvestmentsSummary }) {
  const viz = useVizColors();
  const [view, setView] = useState<ExposureView>('sectors');
  const [account, setAccount] = useState(ALL);
  const holdings = account === ALL ? data.holdings : data.holdings.filter((h) => h.accountId === account);
  const b = breakdownFor(view, holdings, account);
  const colorOf = (r: ExposureRow, i: number) =>
    r.key === UNCLASSIFIED ? viz.other : view === 'concentration' ? viz.series1 : (viz.categorical[i] ?? viz.other);

  return (
    <>
      <TabHeading
        title="What are you exposed to?"
        subtitle="Your portfolio by sector, region and bond type — including what’s inside your funds. Fund make-up is an AI estimate from published allocations."
      />
      <UnderlineTabs
        value={view}
        onChange={setView}
        options={[
          { value: 'sectors', label: 'Sectors' },
          { value: 'geography', label: 'Geography' },
          { value: 'bonds', label: 'Bonds' },
          { value: 'concentration', label: 'Concentration' },
        ]}
      />
      <View style={styles.split}>
        <Card
          title={b.title}
          subtitle={b.note}
          style={styles.main}
          action={
            <Dropdown
              accessibilityLabel="Account"
              value={account}
              onChange={setAccount}
              options={[{ value: ALL, label: 'Total portfolio' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
          }>
          {b.rows.length ? (
            <ExposureBars rows={b.rows} total={b.total} colorOf={colorOf} />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing to show here yet.
            </ThemedText>
          )}
        </Card>
        <View style={styles.side}>
          <AiInsight text={b.insight} topic={b.title.toLowerCase()} />
          <ExploreDeeper questions={b.explore} />
        </View>
      </View>
    </>
  );
}

function AiInsight({ text, topic }: { text: string; topic: string }) {
  const theme = useTheme();
  const accent = useAccents().blue;
  const chat = useStartChat();
  const [question, setQuestion] = useState('');
  const ask = () => chat.start(`About my ${topic} (${text}): ${question}`, () => setQuestion(''));
  return (
    <Card style={{ backgroundColor: accent.bg }}>
      <View style={styles.insightHeading}>
        <Icon name="sparkles" size={20} color={accent.fg} />
        <ThemedText type="smallBold" style={{ color: accent.fg }}>
          AI Insight
        </ThemedText>
      </View>
      <ThemedText type="small">{text}</ThemedText>
      <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Icon name="message" size={16} themeColor="textSecondary" />
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Ask a follow-up…"
          placeholderTextColor={theme.textSecondary}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => question.trim() && ask()}
          returnKeyType="send"
        />
        {chat.isPending && <ActivityIndicator size="small" color={accent.fg} />}
      </View>
      {chat.error && (
        <ThemedText type="small" themeColor="negative">
          {chat.error.message}
        </ThemedText>
      )}
    </Card>
  );
}

function ExploreDeeper({ questions }: { questions: string[] }) {
  const theme = useTheme();
  const chat = useStartChat();
  return (
    <Card title="Explore deeper">
      {questions.map((q) => (
        <Pressable
          key={q}
          accessibilityRole="button"
          disabled={chat.isPending}
          onPress={() => chat.start(q)}
          style={({ hovered, pressed }) => [styles.explore, hovered && { backgroundColor: theme.backgroundSelected }, pressed && styles.pressed]}>
          <ThemedText type="small" themeColor="tint" style={styles.exploreText}>
            {q}
          </ThemedText>
          <Icon name="arrowRight" size={16} themeColor="tint" />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  main: { flexGrow: 3, flexBasis: 520, zIndex: 1 },
  side: { flexGrow: 1, flexBasis: 300, gap: Spacing.three },
  insightHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  input: { flex: 1, paddingVertical: Spacing.two + Spacing.half, fontSize: 14 },
  explore: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderRadius: Spacing.two },
  exploreText: { flex: 1 },
  pressed: { opacity: 0.7 },
});
