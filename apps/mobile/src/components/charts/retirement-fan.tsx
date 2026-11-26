import type { ResolvedPartner, SimulationResult } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { zeroBasedScale } from '@/components/charts/scale';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

const HEIGHT = 220;
const PAD_TOP = 22; // room for the retirement label
const END_PAD_X = 6;
const Y_AXIS_WIDTH = 52;
const TICKS = 5;
const TOOLTIP_WIDTH = 196;

type Band = SimulationResult['bands'][number];

/** The range of simulated balances by age: the middle half darker, 10th to 90th percentile lighter, the median as a line. */
export function RetirementFan({
  bands,
  retirementAge,
  partner = null,
}: {
  bands: Band[];
  retirementAge: number;
  partner?: Pick<ResolvedPartner, 'name' | 'currentAge' | 'retirementAge' | 'retirementAgeInYours'> | null;
}) {
  const theme = useTheme();
  const viz = useVizColors();
  const accents = useAccents();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (bands.length < 2) return null;

  const { min, max, ticks } = zeroBasedScale(
    bands.flatMap((b) => [b.p10, b.p90]),
    TICKS,
  );
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (i: number) => END_PAD_X + (i / (bands.length - 1)) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (HEIGHT - PAD_TOP);

  const path = (pick: (b: Band) => number) => bands.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(b)).toFixed(1)}`).join(' ');
  /** Closed shape between two percentiles: along the top, back along the bottom. */
  const area = (top: (b: Band) => number, bottom: (b: Band) => number) =>
    `${path(top)} ${[...bands]
      .map((b, i) => [b, i] as const)
      .reverse()
      .map(([b, i]) => `L${x(i).toFixed(1)},${y(bottom(b)).toFixed(1)}`)
      .join(' ')} Z`;

  const retireIndex = bands.findIndex((b) => b.age === retirementAge);
  const partnerRetireIndex = partner ? bands.findIndex((b) => b.age === partner.retirementAgeInYours) : -1;
  const staggered = !!partner && partner.retirementAgeInYours !== retirementAge;
  const firstRetire = partner ? Math.min(retirementAge, partner.retirementAgeInYours) : retirementAge;
  const fullRetire = partner ? Math.max(retirementAge, partner.retirementAgeInYours) : retirementAge;
  const firstIdx = bands.findIndex((b) => b.age === Math.max(firstRetire, bands[0]!.age));
  const separateRetireLabels =
    staggered && retireIndex > 0 && partnerRetireIndex > 0 && Math.abs(x(partnerRetireIndex) - x(retireIndex)) > 88;
  const combinedRetireLabel = staggered && (retireIndex > 0 || partnerRetireIndex > 0) && !separateRetireLabels;
  const combinedCenterX =
    retireIndex > 0 && partnerRetireIndex > 0
      ? (x(retireIndex) + x(partnerRetireIndex)) / 2
      : retireIndex > 0
        ? x(retireIndex)
        : x(partnerRetireIndex);

  // Ages every 5 or 10 years, depending on the span.
  const every = bands.length > 40 ? 10 : 5;
  const labeled = bands.map((b, i) => (b.age % every === 0 ? i : -1)).filter((i) => i >= 0);

  const shown = active ?? (firstIdx >= 0 ? firstIdx : bands.length - 1);
  const band = bands[shown]!;
  const offset = band.age - bands[0]!.age;
  const year = new Date().getFullYear() + offset;

  return (
    <View style={styles.row}>
      <View style={[styles.yAxis, { height: HEIGHT }]}>
        {ticks.map((t) => (
          <ThemedText key={t} type="small" themeColor="textSecondary" style={[styles.yLabel, { top: y(t) - 10 }]}>
            {formatCompactCurrency(t)}
          </ThemedText>
        ))}
      </View>
      <View style={styles.plot} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ height: HEIGHT }}>
          {width > 0 && (
            <Svg width={width} height={HEIGHT}>
              {ticks.map((t) => (
                <Line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={viz.grid} strokeWidth={1} />
              ))}
              <Path d={area((b) => b.p90, (b) => b.p10)} fill={viz.trend} fillOpacity={0.12} />
              <Path d={area((b) => b.p75, (b) => b.p25)} fill={viz.trend} fillOpacity={0.22} />
              {retireIndex > 0 && (
                <Line
                  x1={x(retireIndex)}
                  x2={x(retireIndex)}
                  y1={PAD_TOP - 4}
                  y2={HEIGHT}
                  stroke={viz.muted}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              )}
              {partnerRetireIndex > 0 && partnerRetireIndex !== retireIndex && (
                <Line
                  x1={x(partnerRetireIndex)}
                  x2={x(partnerRetireIndex)}
                  y1={PAD_TOP - 4}
                  y2={HEIGHT}
                  stroke={accents.teal.fg}
                  strokeOpacity={0.65}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
              )}
              <Path d={path((b) => b.p50)} stroke={viz.trend} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {active !== null && <Line x1={x(shown)} x2={x(shown)} y1={0} y2={HEIGHT} stroke={viz.axis} strokeWidth={1} />}
              <Circle cx={x(shown)} cy={y(band.p50)} r={5} fill={viz.trend} stroke={theme.backgroundElement} strokeWidth={2} />
            </Svg>
          )}
          {!staggered && retireIndex > 0 && width > 0 && (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              pointerEvents="none"
              style={[styles.marker, { left: Math.min(Math.max(x(retireIndex) - 60, 0), width - 120) }]}>
              Retire at {retirementAge}
            </ThemedText>
          )}
          {separateRetireLabels && width > 0 && (
            <>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                pointerEvents="none"
                style={[styles.splitMarker, { left: Math.min(Math.max(x(retireIndex) - 48, 0), width - 96) }]}>
                You {retirementAge}
              </ThemedText>
              <ThemedText
                type="small"
                numberOfLines={1}
                pointerEvents="none"
                style={[
                  styles.splitMarker,
                  { color: accents.teal.fg, left: Math.min(Math.max(x(partnerRetireIndex) - 48, 0), width - 96) },
                ]}>
                {partner!.name} {partner!.retirementAge}
              </ThemedText>
            </>
          )}
          {combinedRetireLabel && width > 0 && (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              pointerEvents="none"
              style={[styles.marker, { left: Math.min(Math.max(combinedCenterX - 60, 0), width - 120) }]}>
              {retireIndex > 0 && partnerRetireIndex > 0
                ? `Retire ${firstRetire}–${fullRetire}`
                : retireIndex > 0
                  ? `You retire ${retirementAge}`
                  : `${partner!.name} ${partner!.retirementAge}`}
            </ThemedText>
          )}
          {active !== null && width > 0 && (
            <ThemedView
              type="backgroundElement"
              pointerEvents="none"
              style={[
                styles.tooltip,
                { borderColor: theme.border, left: Math.min(Math.max(x(shown) - TOOLTIP_WIDTH / 2, 0), width - TOOLTIP_WIDTH) },
              ]}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {partner
                  ? `Age ${band.age} · ${partner.name} ${partner.currentAge + offset} · ${year}`
                  : `Age ${band.age} · ${year}`}
              </ThemedText>
              <ThemedText type="smallBold">{formatWholeCurrency(band.p50)} median</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatCompactCurrency(band.p10)} to {formatCompactCurrency(band.p90)}
              </ThemedText>
            </ThemedView>
          )}
          {/* Hit targets: one slice per year, wider than the mark itself. */}
          <View style={StyleSheet.absoluteFill}>
            <View style={styles.slices}>
              {bands.map((b, i) => (
                <Pressable
                  key={b.age}
                  style={styles.slice}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  onPressIn={() => setActive(i)}
                  onPressOut={() => setActive(null)}
                  accessibilityLabel={`Age ${b.age}: median ${formatWholeCurrency(b.p50)}, 10th to 90th percentile ${formatWholeCurrency(b.p10)} to ${formatWholeCurrency(b.p90)}`}
                />
              ))}
            </View>
          </View>
        </View>
        <View style={styles.xAxis}>
          {width > 0 &&
            labeled.map((i) => (
              <ThemedText
                key={i}
                type="small"
                themeColor="textSecondary"
                style={[styles.xLabel, { left: Math.min(Math.max(x(i) - 24, 0), width - 48) }]}>
                {bands[i]!.age}
              </ThemedText>
            ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  yAxis: { width: Y_AXIS_WIDTH },
  yLabel: { position: 'absolute', left: 0, fontSize: 12 },
  plot: { flex: 1 },
  slices: { flex: 1, flexDirection: 'row' },
  slice: { flex: 1 },
  xAxis: { height: 20, marginTop: Spacing.two },
  xLabel: { position: 'absolute', width: 48, textAlign: 'center', fontSize: 12 },
  marker: { position: 'absolute', top: 0, width: 120, textAlign: 'center', fontSize: 12 },
  splitMarker: { position: 'absolute', top: 0, width: 96, textAlign: 'center', fontSize: 11 },
  tooltip: {
    position: 'absolute',
    top: 0,
    width: TOOLTIP_WIDTH,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
});
