import type { LifeEventKind, RetirementCashFlowYear } from '@meld/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { formatCompactCurrency } from '@/lib/format';

export const CHART_GEOMETRY = {
  height: 220,
  padTop: 22,
  endPadX: 6,
  yAxisWidth: 52,
  ticks: 5,
  tooltipWidth: 204,
} as const;

export type ProjectionEventMarker = {
  key?: number;
  label: string;
  kind: LifeEventKind;
  startAge: number;
  endAge: number | null;
  annualChange: number;
  monthly: boolean;
};

export type HighlightedSpan = {
  startAge: number;
  endAge: number | null;
  color: string;
};

export const KIND_ACCENT: Record<LifeEventKind, Accent> = {
  spending: 'orange',
  income: 'green',
  saving: 'blue',
  once: 'purple',
};

export function isEventActiveAtAge(e: ProjectionEventMarker, age: number): boolean {
  if (e.kind === 'once') return e.startAge === age;
  return age >= e.startAge && (e.endAge === null || age < e.endAge);
}

/** Compact dollar change string for chart tooltips and timeline pills, e.g. "−$1K/mo", "+$24K/yr", "−$60K". */
export function formatEventDelta(e: Pick<ProjectionEventMarker, 'kind' | 'annualChange' | 'monthly'>): string {
  const sign = e.annualChange < 0 ? '−' : '+';
  if (e.kind === 'once') return `${sign}${formatCompactCurrency(Math.abs(e.annualChange))}`;
  const raw = e.monthly ? Math.abs(e.annualChange) / 12 : Math.abs(e.annualChange);
  return `${sign}${formatCompactCurrency(raw)}/${e.monthly ? 'mo' : 'yr'}`;
}

/** Pixel x & width of a span highlight band inside an SVG of plot width `plotW`. */
export function spanRectX(
  span: HighlightedSpan,
  minAge: number,
  maxAge: number,
  plotW: number,
  endPadX: number,
): { x: number; width: number } | null {
  const ageSpan = Math.max(maxAge - minAge, 1);
  const clampedStart = Math.max(minAge, Math.min(maxAge, span.startAge));
  const clampedEnd = span.endAge === null ? maxAge : Math.max(clampedStart, Math.min(maxAge, span.endAge));
  const xAt = (age: number) => endPadX + ((age - minAge) / ageSpan) * plotW;
  const startX = xAt(clampedStart);
  const endX = xAt(clampedEnd);
  const minW = 8;
  const width = Math.max(minW, endX - startX);
  const x = endX - startX < minW ? Math.max(0, startX - minW / 2) : startX;
  return { x, width };
}

/** X-axis tick row aligned under the plot with an "Age" label under the y-axis gutter. */
export function ChartAgeAxis({
  ages,
  labeledIndices,
  width,
  xAtIndex,
}: {
  ages: number[];
  labeledIndices: number[];
  width: number;
  xAtIndex: (i: number) => number;
}) {
  return (
    <View style={styles.axisRow}>
      <View style={styles.yGutter}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.axisCaption}>
          Age
        </ThemedText>
      </View>
      <View style={styles.xAxis}>
        {width > 0 &&
          labeledIndices.map((i) => (
            <ThemedText
              key={i}
              type="small"
              themeColor="textSecondary"
              style={[styles.xLabel, { left: Math.min(Math.max(xAtIndex(i) - 24, 0), width - 48) }]}>
              {ages[i]}
            </ThemedText>
          ))}
      </View>
    </View>
  );
}

/** Active life-events list rendered inside chart tooltips (up to 3 items + overflow count). */
export function TooltipActiveEvents({ events }: { events: ProjectionEventMarker[] }) {
  const accents = useAccents();
  if (events.length === 0) return null;
  const shown = events.slice(0, 3);
  const extra = events.length - shown.length;
  return (
    <View style={styles.eventList}>
      {shown.map((e, i) => {
        const color = accents[KIND_ACCENT[e.kind]].fg;
        return (
          <View key={`${e.key ?? e.label}-${i}`} style={styles.eventLine}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <ThemedText type="small" numberOfLines={1} style={[styles.eventText, { color }]}>
              {e.label} · {formatEventDelta(e)}
            </ThemedText>
          </View>
        );
      })}
      {extra > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.extraText}>
          +{extra} more
        </ThemedText>
      )}
    </View>
  );
}

/** Clamped floating tooltip shell used by both Balance and Cash flow charts. */
export function ChartTooltipBox({
  anchorX,
  plotWidth,
  children,
}: {
  anchorX: number;
  plotWidth: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const left = Math.min(Math.max(anchorX - CHART_GEOMETRY.tooltipWidth / 2, 0), Math.max(0, plotWidth - CHART_GEOMETRY.tooltipWidth));
  return (
    <ThemedView
      type="backgroundElement"
      pointerEvents="none"
      style={[styles.tooltip, { borderColor: theme.border, left }]}>
      {children}
    </ThemedView>
  );
}

/** Total guaranteed/working/event income in a cash flow row (matches RetirementCashFlow & tooltip math). */
export function cashFlowIncomeTotal(row: RetirementCashFlowYear): number {
  return row.workingIncome + row.socialSecurity + row.pension + Math.max(0, row.rent) + Math.max(0, row.eventIncome);
}

const styles = StyleSheet.create({
  axisRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.two },
  yGutter: { width: CHART_GEOMETRY.yAxisWidth },
  axisCaption: { fontSize: 12 },
  xAxis: { flex: 1, height: 20 },
  xLabel: { position: 'absolute', width: 48, textAlign: 'center', fontSize: 12, fontVariant: ['tabular-nums'] },
  tooltip: {
    position: 'absolute',
    top: 0,
    zIndex: 10,
    width: CHART_GEOMETRY.tooltipWidth,
    gap: 2,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  eventList: { gap: 2, marginTop: 2 },
  eventLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  eventText: { flex: 1, fontSize: 12, lineHeight: 16 },
  extraText: { fontSize: 11, lineHeight: 15 },
});
