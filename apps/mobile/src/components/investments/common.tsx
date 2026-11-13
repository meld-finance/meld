import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { WithTip, type Tip } from '@/components/info-tip';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type Accent } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useStartChat } from '@/hooks/use-start-chat';
import { useTheme } from '@/hooks/use-theme';
import { formatPercent, percentChange } from '@/lib/cashflow';
import { formatShare, type ExposureRow } from '@/lib/investments';
import { formatWholeCurrency } from '@/lib/format';

export function TabHeading({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        <ThemedText type="cardTitle" style={styles.headingTitle}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
      {actions && <View style={styles.headingActions}>{actions}</View>}
    </View>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

/** A headline figure, with either a caption or a change against an earlier value. */
export function StatTile({
  label,
  value,
  caption,
  change,
  tip,
  tone,
}: {
  label: string;
  /** A number is shown as whole dollars. */
  value: number | string;
  caption?: string;
  change?: { previous: number; against: string };
  /** A plain-words explanation behind an ⓘ next to the label. */
  tip?: Tip;
  /** Colors the value, for a status. */
  tone?: 'positive' | 'negative';
}) {
  const theme = useTheme();
  const amount = typeof value === 'number' ? value : 0;
  const pct = change ? percentChange(amount, change.previous) : null;
  const up = change ? amount >= change.previous : true;
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <WithTip tip={tip}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      </WithTip>
      <ThemedText style={styles.value} themeColor={tone} numberOfLines={1}>
        {typeof value === 'number' ? formatWholeCurrency(value) : value}
      </ThemedText>
      {change && pct !== null ? (
        <View style={styles.change}>
          <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} themeColor={up ? 'positive' : 'negative'} strokeWidth={2.25} />
          <ThemedText type="smallBold" themeColor={up ? 'positive' : 'negative'}>
            {formatPercent(pct)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            vs. {change.against}
          </ThemedText>
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {change ? `Nothing to compare for ${change.against}` : caption}
        </ThemedText>
      )}
    </View>
  );
}

/** A takeaway across the page; tapping asks the assistant about it. */
export function InsightCallout({
  title,
  body,
  question,
  icon = 'sparkles',
  accent = 'blue',
  action,
}: {
  title?: string;
  body: string;
  question: string;
  icon?: IconName;
  accent?: Accent;
  /** A button label; without one the whole callout is the button. */
  action?: string;
}) {
  const theme = useTheme();
  const color = useAccents()[accent];
  const chat = useStartChat();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Ask the assistant about this"
      disabled={chat.isPending}
      onPress={() => chat.start(question)}
      style={({ hovered, pressed }) => [
        styles.callout,
        { backgroundColor: color.bg, borderColor: hovered ? color.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <Icon name={icon} size={24} color={color.fg} />
      <View style={styles.calloutText}>
        {title && <ThemedText type="smallBold">{title}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">
          {body}
        </ThemedText>
        {chat.error && (
          <ThemedText type="small" themeColor="negative">
            {chat.error.message}
          </ThemedText>
        )}
      </View>
      {chat.isPending ? (
        <ActivityIndicator size="small" color={color.fg} />
      ) : action ? (
        <View style={[styles.calloutButton, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="smallBold" style={{ color: color.fg }}>
            {action}
          </ThemedText>
          <Icon name="chevronRight" size={14} color={color.fg} />
        </View>
      ) : (
        <Icon name="chevronRight" size={18} themeColor="textSecondary" />
      )}
    </Pressable>
  );
}

/** Labeled bars with share and amount; bars are scaled to the largest row. */
export function ExposureBars({
  rows,
  total,
  colorOf,
}: {
  rows: ExposureRow[];
  /** What each share is a share of. */
  total: number;
  colorOf: (row: ExposureRow, index: number) => string;
}) {
  const theme = useTheme();
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return (
    <View style={styles.bars}>
      {rows.map((r, i) => {
        const color = colorOf(r, i);
        return (
          <View key={r.key} style={styles.barRow} accessible accessibilityLabel={`${r.label}: ${formatShare(r.amount, total)}, ${formatWholeCurrency(r.amount)}`}>
            <View style={[styles.badge, { backgroundColor: color }]}>
              <ThemedText style={styles.badgeText}>{r.label[0]}</ThemedText>
            </View>
            <ThemedText type="small" style={styles.barLabel} numberOfLines={1}>
              {r.label}
            </ThemedText>
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View style={[styles.bar, { width: `${(r.amount / max) * 100}%`, backgroundColor: color }]} />
            </View>
            <ThemedText type="small" style={styles.share}>
              {formatShare(r.amount, total)}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.amount}>
              {formatWholeCurrency(r.amount)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { zIndex: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three },
  headingText: { flexShrink: 1, flexBasis: 360, flexGrow: 1, gap: Spacing.half },
  headingTitle: { fontSize: 22, lineHeight: 30, fontWeight: 700 },
  headingActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 200,
    gap: Spacing.one,
    padding: Spacing.four,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
  },
  value: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.4 },
  change: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
  },
  calloutText: { flex: 1, gap: Spacing.half },
  calloutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  pressed: { opacity: 0.7 },
  bars: { gap: Spacing.three },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 13, lineHeight: 16, fontWeight: 700 },
  barLabel: { width: 180, flexShrink: 1 },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden', minWidth: 60 },
  bar: { height: '100%', borderRadius: 5, minWidth: 2 },
  share: { width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] },
  amount: { minWidth: 92, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
