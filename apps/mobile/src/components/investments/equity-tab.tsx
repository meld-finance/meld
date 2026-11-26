import type { EquityGrant, EquityTimelineBucket, EquityVest } from '@meld/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Segmented } from '@/components/cashflow/segmented';
import { Input, parseAmount } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { InsightCallout, StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { useConfirmEquityVest, useEquity } from '@/lib/queries';

type TimelineMode = 'quarterly' | 'yearly';
type ValueMode = 'gross' | 'net';

const PLOT_HEIGHT = 220;
const BAR_MAX = 40;
const GAP = 2;

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= max)!;
  return step * mag;
}

function formatShares(shares: number): string {
  return Number.isInteger(shares) ? shares.toLocaleString('en-US') : shares.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function EquityTab() {
  const equity = useEquity();
  const data = equity.data;

  const heading = (
    <TabHeading
      title="Your equity"
      subtitle="Restricted stock units (RSUs) and vesting schedules. Unvested RSUs stay out of net worth until shares vest."
      actions={<Button label="Add grant" size="small" onPress={() => router.push('/equity/new')} />}
    />
  );

  if (equity.isPending) {
    return (
      <>
        {heading}
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </>
    );
  }

  if (equity.isError) {
    return (
      <>
        {heading}
        <ThemedText themeColor="negative">Couldn’t load equity grants: {equity.error.message}</ThemedText>
      </>
    );
  }

  if (!data || data.grants.length === 0) {
    return (
      <>
        {heading}
        <Card title="No RSU grants yet">
          <ThemedText type="small" themeColor="textSecondary">
            Track your unvested RSU grants and vesting calendar here without inflating today’s net worth. Meld prices public
            tickers automatically, estimates supplemental tax withholding gaps in Plan → Tax, and lets you include unvested
            employer stock in Concentration.
          </ThemedText>
          <View style={styles.emptyActions}>
            <Button label="Add RSU grant" size="small" onPress={() => router.push('/equity/new')} />
          </View>
        </Card>
      </>
    );
  }

  const pendingVests = data.grants.flatMap((g) => g.vests.filter((v) => v.needsConfirmation).map((v) => ({ grant: g, vest: v })));
  const activeGrants = data.grants.filter((g) => g.status !== 'forfeited');

  return (
    <>
      {heading}

      <TileRow>
        <StatTile
          label="Unvested value"
          value={data.totalUnvestedGross}
          caption={
            data.unpricedGrants > 0
              ? `Est. ${formatWholeCurrency(data.totalUnvestedNet)} net · ${data.unpricedGrants} unpriced`
              : `Est. ${formatWholeCurrency(data.totalUnvestedNet)} after withholding`
          }
          tip={{
            title: 'Unvested RSUs',
            body: 'Market value of scheduled unvested RSUs. Excluded from net worth until shares vest.',
          }}
        />
        <StatTile
          label="Vesting next 12 mo"
          value={data.next12MonthsGross}
          caption={`Est. ${formatWholeCurrency(data.next12MonthsNet)} net`}
        />
        <StatTile
          label="Next vest"
          value={
            data.nextVest
              ? data.nextVest.grossValue !== null
                ? data.nextVest.grossValue
                : `${formatShares(data.nextVest.shares)} sh`
              : '—'
          }
          caption={
            data.nextVest
              ? `${formatDate(data.nextVest.vestDate)} · ${data.nextVest.ticker ?? data.nextVest.employer} (${formatShares(data.nextVest.shares)} sh)`
              : 'No scheduled vests'
          }
        />
        <StatTile
          label="Vested this year"
          value={data.ytdVestedGross}
          caption={
            data.remainingThisYearGross > 0
              ? `+${formatWholeCurrency(data.remainingThisYearGross)} scheduled later this year`
              : 'Gross W-2 RSU income YTD'
          }
        />
      </TileRow>

      {pendingVests.length > 0 && <ConfirmVestsCard items={pendingVests} />}

      {(data.quarterlyTimeline.length > 0 || data.yearlyTimeline.length > 0) && (
        <VestingScheduleCard quarterly={data.quarterlyTimeline} yearly={data.yearlyTimeline} grants={activeGrants} />
      )}

      <GrantsCard grants={data.grants} />

      <InsightCallout
        title="Want to plan around your RSUs?"
        body="Ask Meld about supplemental tax withholding gaps, sell-on-vest diversification, or how your income drops at your vesting cliff."
        question="How should I plan for my upcoming RSU vests, tax withholding, and employer stock concentration?"
      />
    </>
  );
}

function ConfirmVestsCard({ items }: { items: { grant: EquityGrant; vest: EquityVest }[] }) {
  const theme = useTheme();
  const accent = useAccents().orange;
  const confirm = useConfirmEquityVest();
  const [drafts, setDrafts] = useState<Record<string, { price: string; tax: string }>>({});

  const getDraft = (v: EquityVest) => ({
    price: drafts[v.id]?.price ?? (v.price !== null ? String(Math.round(v.price * 100) / 100) : ''),
    tax: drafts[v.id]?.tax ?? (v.estimatedWithholding !== null ? String(Math.round(v.estimatedWithholding * 100) / 100) : ''),
  });

  const setDraft = (id: string, patch: Partial<{ price: string; tax: string }>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } as { price: string; tax: string } }));
  };

  const submitVest = (v: EquityVest, status: 'vested' | 'forfeited') => {
    const d = getDraft(v);
    const price = status === 'vested' ? parseAmount(d.price) : null;
    const tax = status === 'vested' ? parseAmount(d.tax) : null;
    if (status === 'vested' && (price === undefined || tax === undefined)) return;
    confirm.mutate({
      vestId: v.id,
      input: {
        status,
        vestPrice: price && price > 0 ? price : null,
        sharesWithheld: null,
        taxWithheld: tax ?? null,
      },
    });
  };

  return (
    <Card
      title="Confirm recent vests"
      subtitle="These vest dates have passed. Confirm the vest-date price and tax withheld to keep Plan → Tax accurate."
      style={{ borderColor: accent.fg }}>
      {confirm.error && (
        <ThemedText type="small" themeColor="negative">
          {confirm.error.message}
        </ThemedText>
      )}
      {items.map(({ grant, vest }, idx) => {
        const d = getDraft(vest);
        const priceNum = parseAmount(d.price);
        const taxNum = parseAmount(d.tax);
        const invalid = priceNum === undefined || taxNum === undefined || (priceNum !== null && priceNum <= 0);
        return (
          <View
            key={vest.id}
            style={[styles.confirmRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: Spacing.three }]}>
            <View style={styles.confirmMeta}>
              <ThemedText type="smallBold">
                {grant.employer} · {grant.name}
                {grant.ticker ? ` (${grant.ticker})` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDate(vest.vestDate)} · {formatShares(vest.shares)} shares
              </ThemedText>
            </View>
            <View style={styles.confirmInputs}>
              <View style={styles.miniField}>
                <ThemedText type="small" themeColor="textSecondary">
                  Price / sh
                </ThemedText>
                <Input
                  value={d.price}
                  onChangeText={(price) => setDraft(vest.id, { price })}
                  placeholder="$"
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={styles.miniInput}
                />
              </View>
              <View style={styles.miniField}>
                <ThemedText type="small" themeColor="textSecondary">
                  Tax withheld
                </ThemedText>
                <Input
                  value={d.tax}
                  onChangeText={(tax) => setDraft(vest.id, { tax })}
                  placeholder="$"
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={styles.miniInput}
                />
              </View>
              <View style={styles.confirmButtons}>
                <Button
                  label="Confirm"
                  size="small"
                  disabled={invalid || confirm.isPending}
                  onPress={() => submitVest(vest, 'vested')}
                />
                <Button
                  label="Forfeit"
                  variant="secondary"
                  size="small"
                  disabled={confirm.isPending}
                  onPress={() => submitVest(vest, 'forfeited')}
                />
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function VestingScheduleCard({
  quarterly,
  yearly,
  grants,
}: {
  quarterly: EquityTimelineBucket[];
  yearly: EquityTimelineBucket[];
  grants: EquityGrant[];
}) {
  const viz = useVizColors();
  const [period, setPeriod] = useState<TimelineMode>('quarterly');
  const [valueMode, setValueMode] = useState<ValueMode>('gross');
  const [active, setActive] = useState<number | null>(null);

  const buckets = period === 'quarterly' ? quarterly : yearly;
  const colorMap = new Map(grants.map((g, i) => [g.id, viz.categorical[i % viz.categorical.length]!]));

  const amountOf = (b: { totalGross: number; totalNet: number }) => (valueMode === 'gross' ? b.totalGross : b.totalNet);
  const sliceAmount = (s: { gross: number; net: number }) => (valueMode === 'gross' ? s.gross : s.net);

  const scale = niceMax(Math.max(...buckets.map(amountOf), 0));
  const ticks = [scale, scale / 2, 0].map((t) => (t ? formatCompactCurrency(t) : '$0'));

  const defaultIdx = Math.max(0, buckets.findIndex((b) => amountOf(b) > 0));
  const safeIdx = active !== null && active < buckets.length ? active : defaultIdx;
  const shown = buckets[safeIdx];
  const labelStride = period === 'quarterly' && buckets.length > 8 ? Math.ceil(buckets.length / 6) : 1;

  return (
    <Card
      title="Vesting schedule"
      subtitle="Projected RSU value over time by grant. Empty bars highlight when grants finish vesting."
      action={
        <View style={styles.chartActions}>
          <Segmented
            size="small"
            value={period}
            onChange={(next) => {
              setPeriod(next);
              setActive(null);
            }}
            options={[
              { value: 'quarterly', label: 'Quarterly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
          />
          <Segmented
            size="small"
            value={valueMode}
            onChange={setValueMode}
            options={[
              { value: 'gross', label: 'Gross' },
              { value: 'net', label: 'Est. net' },
            ]}
          />
        </View>
      }>
      {shown && (
        <ThemedText type="small" themeColor="textSecondary">
          {shown.label} · {formatWholeCurrency(amountOf(shown))} {valueMode === 'gross' ? 'gross' : 'est. net'} · {formatShares(shown.totalShares)} shares
        </ThemedText>
      )}

      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height: PLOT_HEIGHT }]}>
          {ticks.map((t) => (
            <ThemedText key={t} type="small" style={{ color: viz.muted }}>
              {t}
            </ThemedText>
          ))}
        </View>
        <View style={[styles.plot, { height: PLOT_HEIGHT }]}>
          <View style={[styles.grid, { top: 0, backgroundColor: viz.grid }]} />
          <View style={[styles.grid, { top: PLOT_HEIGHT / 2, backgroundColor: viz.grid }]} />
          <View style={styles.columns}>
            {buckets.map((b, i) => {
              const visible = b.byGrant.filter((s) => sliceAmount(s) > 0);
              return (
                <Pressable
                  key={b.key}
                  style={styles.column}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  onPressIn={() => setActive(i)}
                  accessibilityLabel={`${b.label}: ${formatWholeCurrency(amountOf(b))}, ${formatShares(b.totalShares)} shares`}>
                  <View style={[styles.stack, active !== null && active !== i && styles.dimmed]}>
                    {[...visible].reverse().map((s, j) => (
                      <View
                        key={s.grantId}
                        style={[
                          styles.segment,
                          j === 0 && styles.top,
                          {
                            height: Math.max((sliceAmount(s) / scale) * PLOT_HEIGHT - GAP, 2),
                            backgroundColor: colorMap.get(s.grantId) ?? viz.series1,
                          },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.baseline, { backgroundColor: viz.axis }]} />
        </View>
      </View>

      <View style={styles.plotRow}>
        <View style={styles.yAxis} />
        <View style={styles.xLabels}>
          {buckets.map((b, i) => {
            const showLabel = i % labelStride === 0 || i === buckets.length - 1;
            const [head, tail] = period === 'quarterly' ? b.label.split(' ') : [b.label, ''];
            return (
              <View key={b.key} style={styles.xLabel}>
                <ThemedText type="small" style={[styles.xText, { color: viz.muted }]} numberOfLines={1}>
                  {showLabel ? head : ''}
                </ThemedText>
                {tail ? (
                  <ThemedText type="small" style={[styles.xText, { color: viz.muted }]} numberOfLines={1}>
                    {showLabel ? tail : ''}
                  </ThemedText>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.legend}>
        {grants
          .filter((g) => g.unvestedShares > 0)
          .map((g) => {
            const slice = shown?.byGrant.find((s) => s.grantId === g.id);
            return (
              <View key={g.id} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colorMap.get(g.id) ?? viz.series1 }]} />
                <ThemedText type="small" themeColor="textSecondary">
                  {g.ticker ? `${g.ticker} · ` : ''}{g.name}
                </ThemedText>
                {slice && (
                  <ThemedText type="small" style={styles.numeric}>
                    {formatWholeCurrency(sliceAmount(slice))}
                  </ThemedText>
                )}
              </View>
            );
          })}
      </View>
    </Card>
  );
}

function GrantsCard({ grants }: { grants: EquityGrant[] }) {
  const theme = useTheme();
  const viz = useVizColors();
  const { width } = useWindowDimensions();
  const compact = width < 560;
  return (
    <Card title="Grants" subtitle="Tap a grant to edit its schedule, attach a grant PDF, or record vested tranches.">
      {grants.map((g, i) => {
        const vestedPct = g.totalShares > 0 ? Math.min(1, g.vestedShares / g.totalShares) : 0;
        const priceLabel =
          g.currentPrice !== null
            ? `${formatCurrency(g.currentPrice)}/sh · ${g.priceSource === 'market' ? 'Market' : 'Manual'}`
            : 'No share price';
        const statusMeta = [
          g.grantNumberMask && `••${g.grantNumberMask}`,
          g.status === 'completed' ? 'Completed' : g.status === 'forfeited' ? 'Forfeited' : null,
          g.linkedAccountName,
          priceLabel,
        ].filter(Boolean);
        const headlineValue =
          g.status === 'forfeited'
            ? 'Forfeited'
            : g.status === 'completed'
              ? 'Vested'
              : g.unvestedGrossValue !== null
                ? formatWholeCurrency(g.unvestedGrossValue)
                : `${formatShares(g.unvestedShares)} sh`;
        const secondaryValue =
          g.status === 'active' && g.unvestedNetValue !== null
            ? `est. ${formatWholeCurrency(g.unvestedNetValue)} net`
            : g.nextVestDate
              ? `Next ${formatDate(g.nextVestDate)}`
              : `Granted ${formatDate(g.grantDate)}`;

        return (
          <Pressable
            key={g.id}
            onPress={() => router.push({ pathname: '/equity/[id]', params: { id: g.id } })}
            style={({ hovered, pressed }) => [
              compact ? styles.grantRowCompact : styles.grantRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
              hovered && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            {compact ? (
              <>
                <View style={styles.grantCompactTop}>
                  <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="smallBold" themeColor="tint">
                      {(g.ticker ?? g.employer).slice(0, 4)}
                    </ThemedText>
                  </View>
                  <View style={styles.grantBody}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {g.employer} · {g.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {statusMeta.join(' · ')}
                    </ThemedText>
                  </View>
                  <Icon name="chevronRight" size={16} themeColor="textSecondary" />
                </View>
                <View style={styles.grantCompactBottom}>
                  <View style={styles.grantCompactValues}>
                    <ThemedText type="smallBold" style={styles.numeric}>
                      {headlineValue}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.numeric}>
                      {secondaryValue}
                      {g.status === 'active' && g.nextVestDate ? ` · Next ${formatDate(g.nextVestDate)}` : ''}
                    </ThemedText>
                  </View>
                  <View style={styles.progressRow}>
                    <View style={[styles.progressTrack, { backgroundColor: viz.track }]}>
                      <View style={[styles.progressFill, { width: `${vestedPct * 100}%`, backgroundColor: viz.series1 }]} />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.numeric}>
                      {formatShares(g.vestedShares)} / {formatShares(g.totalShares)} sh vested
                    </ThemedText>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.badge, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="smallBold" themeColor="tint">
                    {(g.ticker ?? g.employer).slice(0, 4)}
                  </ThemedText>
                </View>
                <View style={styles.grantBody}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {g.employer} · {g.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {statusMeta.join(' · ')}
                  </ThemedText>
                  <View style={styles.progressRow}>
                    <View style={[styles.progressTrack, { backgroundColor: viz.track }]}>
                      <View style={[styles.progressFill, { width: `${vestedPct * 100}%`, backgroundColor: viz.series1 }]} />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.numeric}>
                      {formatShares(g.vestedShares)} / {formatShares(g.totalShares)} sh vested
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.grantRight}>
                  <ThemedText type="smallBold" style={styles.numeric}>
                    {headlineValue}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.numeric}>
                    {secondaryValue}
                  </ThemedText>
                  {g.status === 'active' && g.nextVestDate && (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.numeric}>
                      Next {formatDate(g.nextVestDate)}
                    </ThemedText>
                  )}
                </View>
                <Icon name="chevronRight" size={16} themeColor="textSecondary" />
              </>
            )}
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  emptyActions: { flexDirection: 'row', gap: Spacing.two },
  confirmRow: { gap: Spacing.two },
  confirmMeta: { gap: 2 },
  confirmInputs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: Spacing.two },
  miniField: { gap: Spacing.one, width: 112 },
  miniInput: { paddingVertical: Spacing.one + Spacing.half, paddingHorizontal: Spacing.two },
  confirmButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginLeft: 'auto' },
  chartActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, maxWidth: '100%', flexShrink: 1 },
  plotRow: { flexDirection: 'row', gap: Spacing.two },
  yAxis: { width: 44, justifyContent: 'space-between', alignItems: 'flex-end' },
  plot: { flex: 1, justifyContent: 'flex-end' },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  baseline: { height: 1 },
  columns: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  stack: { width: '100%', maxWidth: BAR_MAX + Spacing.two * 2, paddingHorizontal: Spacing.one, gap: GAP },
  dimmed: { opacity: 0.4 },
  segment: { width: '100%' },
  top: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  xLabels: { flex: 1, flexDirection: 'row' },
  xLabel: { flex: 1, alignItems: 'center', minWidth: 0 },
  xText: { fontSize: 11, lineHeight: 15 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  numeric: { fontVariant: ['tabular-nums'] },
  grantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  grantRowCompact: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.one,
    borderRadius: Spacing.two,
  },
  grantCompactTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.half },
  grantCompactBottom: { gap: Spacing.one + Spacing.half, paddingLeft: 46 + Spacing.two + Spacing.half },
  grantCompactValues: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  badge: {
    minWidth: 46,
    height: 36,
    paddingHorizontal: Spacing.one + Spacing.half,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantBody: { flex: 1, minWidth: 0, gap: Spacing.one },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  progressTrack: { flex: 1, maxWidth: 160, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  grantRight: { alignItems: 'flex-end', gap: 2 },
  pressed: { opacity: 0.7 },
});
