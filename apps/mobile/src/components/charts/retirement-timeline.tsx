import type { LifeEventKind, RetirementInputs } from '@meld/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  CHART_GEOMETRY,
  KIND_ACCENT,
  formatEventDelta,
  type HighlightedSpan,
  type ProjectionEventMarker,
} from '@/components/charts/retirement-chart-shared';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';

const { endPadX: END_PAD_X, yAxisWidth: Y_AXIS_WIDTH } = CHART_GEOMETRY;
const ROW_HEIGHT = 30;
const COLLAPSE_AT = 7;

export type TimelineEventInput = ProjectionEventMarker & { key: number };
export type TimelinePropertyInput = { assetId: string; name: string; sellAge: number; proceeds: number; netRentAnnual: number };

type TimelineRow = {
  id: string;
  label: string;
  impact: string;
  ageBadge: string;
  startAge: number;
  endAge: number | null;
  pointOnly: boolean;
  accent: Accent;
  inactive?: boolean;
  onPress: () => void;
};

function isInactiveEvent(e: ProjectionEventMarker, inputs: RetirementInputs): boolean {
  const end = e.kind === 'once' ? e.startAge : (e.endAge ?? Infinity);
  if (e.kind === 'spending' && end <= inputs.retirementAge) return true;
  if (e.kind === 'saving' && e.startAge >= inputs.retirementAge) return true;
  if (end <= inputs.currentAge || e.startAge > inputs.lifeExpectancy) return true;
  return false;
}

function formatAgeBadge(startAge: number, endAge: number | null, pointOnly: boolean): string {
  if (pointOnly) return String(startAge);
  if (endAge === null) return `${startAge}+`;
  return `${startAge}–${endAge}`;
}

/**
 * Interactive horizontal timeline of life events, property sales, and Social Security, aligned
 * pixel-for-pixel with the Balance / Cash flow chart above it.
 */
export function RetirementTimeline({
  inputs,
  events,
  properties,
  activeAge,
  onHoverAge,
  onHighlight,
  onSelectEvent,
  onSelectProperty,
  onSelectAssumptions,
  onAddEvent,
}: {
  inputs: RetirementInputs;
  /** Life events already converted into your ages (`inYourAges`), preserving draft `key`. */
  events: TimelineEventInput[];
  properties: TimelinePropertyInput[];
  activeAge: number | null;
  onHoverAge: (age: number | null) => void;
  onHighlight: (span: HighlightedSpan | null) => void;
  onSelectEvent: (key: number) => void;
  onSelectProperty: (assetId: string) => void;
  onSelectAssumptions: () => void;
  onAddEvent: () => void;
}) {
  const theme = useTheme();
  const accents = useAccents();
  const viz = useVizColors();
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const items: TimelineRow[] = [
    ...events.map((e): TimelineRow => {
      const pointOnly = e.kind === 'once';
      return {
        id: `ev-${e.key}`,
        label: e.label,
        impact: formatEventDelta(e),
        ageBadge: formatAgeBadge(e.startAge, e.endAge, pointOnly),
        startAge: e.startAge,
        endAge: pointOnly ? null : e.endAge,
        pointOnly,
        accent: KIND_ACCENT[e.kind as LifeEventKind],
        inactive: isInactiveEvent(e, inputs),
        onPress: () => onSelectEvent(e.key),
      };
    }),
    ...properties.map((p): TimelineRow => {
      const hasRent = p.netRentAnnual !== 0;
      const rentSign = p.netRentAnnual > 0 ? '+' : '−';
      const impact = hasRent
        ? `${rentSign}${formatCompactCurrency(Math.abs(p.netRentAnnual))}/yr, sell +${formatCompactCurrency(p.proceeds)}`
        : `Sell +${formatCompactCurrency(p.proceeds)}`;
      return {
        id: `prop-${p.assetId}`,
        label: p.name,
        impact,
        ageBadge: hasRent ? `${inputs.currentAge}–${p.sellAge}` : String(p.sellAge),
        startAge: hasRent ? inputs.currentAge : p.sellAge,
        endAge: hasRent ? p.sellAge : null,
        pointOnly: !hasRent,
        accent: 'teal',
        onPress: () => onSelectProperty(p.assetId),
      };
    }),
    ...(inputs.socialSecurityAnnual > 0
      ? [
          {
            id: 'ss-start',
            label: 'Social Security',
            impact: `${formatWholeCurrency(Math.round(inputs.socialSecurityAnnual / 12))}/mo`,
            ageBadge: `${inputs.socialSecurityAge}+`,
            startAge: inputs.socialSecurityAge,
            endAge: null,
            pointOnly: false,
            accent: 'green' as Accent,
            onPress: onSelectAssumptions,
          },
        ]
      : []),
  ].sort((a, b) => a.startAge - b.startAge || a.label.localeCompare(b.label));

  const hasCustomItems = events.length > 0 || properties.length > 0;
  const visible = expanded ? items : items.slice(0, COLLAPSE_AT);

  const minAge = inputs.currentAge;
  const maxAge = inputs.lifeExpectancy;
  const ageSpan = Math.max(maxAge - minAge, 1);
  const plotW = Math.max(width - END_PAD_X * 2, 1);
  const x = (age: number) => END_PAD_X + ((age - minAge) / ageSpan) * plotW;

  const retireLeft = inputs.retirementAge >= minAge && inputs.retirementAge <= maxAge ? x(inputs.retirementAge) : null;
  const activeLeft = activeAge !== null && activeAge >= minAge && activeAge <= maxAge ? x(activeAge) : null;

  return (
    <View style={[styles.root, { borderTopColor: theme.border }]}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">Timeline</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Life events & milestones · tap any item to edit
        </ThemedText>
      </View>

      {items.length > 0 && (
        <View style={styles.rowsWrap}>
          {visible.map((item, idx) => {
            const accent = accents[item.accent];
            const clampedStart = Math.max(minAge, Math.min(maxAge, item.startAge));
            const clampedEnd = item.pointOnly
              ? clampedStart
              : item.endAge === null
                ? maxAge
                : Math.max(clampedStart, Math.min(maxAge, item.endAge));

            const startX = x(clampedStart);
            const endX = x(clampedEnd);
            const barWidth = item.pointOnly ? 10 : Math.max(10, endX - startX);
            const barLeft = item.pointOnly ? startX - 5 : endX - startX < 10 ? Math.max(END_PAD_X, startX - 5) : startX;
            const barRight = barLeft + barWidth;
            const text = `${item.label} · ${item.impact}`;

            const estTextW = text.length * 7.1 + 20;
            const rightSpace = width - barRight - 8;
            const leftSpace = barLeft - 8;
            const inside = !item.pointOnly && (barWidth >= Math.max(170, estTextW) || (rightSpace < 60 && barWidth > leftSpace));
            const placeLeft = !inside && width > 0 && (rightSpace < estTextW && leftSpace > rightSpace);

            return (
              <Pressable
                key={item.id}
                onPress={item.onPress}
                onHoverIn={() => {
                  onHoverAge(clampedStart);
                  onHighlight({ startAge: clampedStart, endAge: item.pointOnly ? clampedStart : item.endAge, color: accent.fg });
                }}
                onHoverOut={() => {
                  onHoverAge(null);
                  onHighlight(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.impact}, age ${item.ageBadge}`}
                style={({ hovered, pressed }) => [
                  styles.row,
                  hovered && { backgroundColor: theme.background },
                  pressed && styles.pressed,
                ]}>
                <View style={styles.yGutter}>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.ageBadge}>
                    {item.ageBadge}
                  </ThemedText>
                </View>
                <View
                  style={styles.track}
                  onLayout={idx === 0 ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}>
                  {width > 0 && retireLeft !== null && (
                    <View style={[styles.retireGuide, { left: retireLeft, borderColor: viz.muted }]} pointerEvents="none" />
                  )}
                  {width > 0 && activeLeft !== null && (
                    <View style={[styles.activeGuide, { left: activeLeft, backgroundColor: viz.axis }]} pointerEvents="none" />
                  )}
                  {width > 0 &&
                    (item.pointOnly ? (
                      <View
                        style={[
                          styles.diamond,
                          {
                            left: startX - 5,
                            backgroundColor: accent.fg,
                            borderColor: theme.backgroundElement,
                            opacity: item.inactive ? 0.55 : 1,
                          },
                        ]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.bar,
                          {
                            left: barLeft,
                            width: barWidth,
                            backgroundColor: accent.bg,
                            borderColor: accent.fg,
                            borderStyle: item.inactive ? 'dashed' : 'solid',
                            opacity: item.inactive ? 0.6 : 1,
                          },
                        ]}
                      />
                    ))}
                  {width > 0 && (
                    <ThemedText
                      type="small"
                      numberOfLines={1}
                      pointerEvents="none"
                      style={[
                        styles.rowLabel,
                        { color: item.inactive ? theme.textSecondary : inside ? accent.fg : theme.text },
                        inside
                          ? { left: barLeft + 8, width: barWidth - 16 }
                          : placeLeft
                            ? { right: width - barLeft + 6, maxWidth: Math.max(60, barLeft - 8), textAlign: 'right' }
                            : { left: barRight + 6, maxWidth: Math.max(60, width - barRight - 8) },
                      ]}>
                      {text}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.footerRow}>
        {items.length > COLLAPSE_AT && (
          <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button">
            <ThemedText type="small" themeColor="tint">
              {expanded ? 'Show fewer' : `Show all ${items.length} timeline items`}
            </ThemedText>
          </Pressable>
        )}
        {!hasCustomItems && (
          <View style={styles.emptyPrompt}>
            <ThemedText type="small" themeColor="textSecondary">
              Add life events or property sales to map them along your timeline.
            </ThemedText>
            <Pressable onPress={onAddEvent} accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="tint">
                + Add life event
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, gap: Spacing.two },
  headerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  rowsWrap: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_HEIGHT, borderRadius: Spacing.one + Spacing.half },
  pressed: { opacity: 0.75 },
  yGutter: { width: Y_AXIS_WIDTH, paddingRight: Spacing.two },
  ageBadge: { textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { flex: 1, height: ROW_HEIGHT, justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  retireGuide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  activeGuide: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  bar: { position: 'absolute', height: 18, borderRadius: 6, borderWidth: 1 },
  diamond: { position: 'absolute', width: 10, height: 10, transform: [{ rotate: '45deg' }], borderWidth: 1, borderRadius: 2 },
  rowLabel: { position: 'absolute', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  footerRow: { gap: Spacing.one },
  emptyPrompt: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
});
