import {
  insuranceTotals,
  type EstateSummary,
  type InsurancePolicy,
  type RetirementProjection,
  type TaxPlan,
} from '@meld/shared';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useVizColors } from '@/hooks/use-viz-colors';
import { formatCompactCurrency, formatWholeCurrency } from '@/lib/format';
import { AREAS, type Area } from '@/lib/home';

type Status = 'good' | 'attention' | 'setup';

const STATUS_BADGE: Record<Exclude<Status, 'setup'>, { label: string; color: 'positive' | 'warning'; bg: 'green' | 'orange' }> = {
  good: { label: 'On track', color: 'positive', bg: 'green' },
  attention: { label: 'Needs attention', color: 'warning', bg: 'orange' },
};

type Tile = {
  area: Area;
  title: string;
  value: string;
  setupHeadline?: string;
  caption: string;
  status: Status;
  statusLabel?: string;
  /** 0–1, drawn as a bar under the value; null for none. */
  progress: number | null;
  href: Href;
};

export type AreaSources = {
  today: string;
  retirement: { projection: RetirementProjection | null; missing: string[] } | undefined;
  tax: TaxPlan | undefined;
  estate: EstateSummary | undefined;
  policies: InsurancePolicy[] | undefined;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Four long-term planning & protection pillars: Retirement, Taxes, Estate, and Insurance. */
function buildTiles(s: AreaSources): Tile[] {
  const tiles: Tile[] = [];

  if (s.retirement) {
    const { projection: p, missing } = s.retirement;
    tiles.push(
      missing.length || !p
        ? {
            area: 'retirement',
            title: 'Retirement',
            value: '—',
            setupHeadline: 'Project retirement',
            caption: `Add your ${missing.join(' and ') || 'plan'} to see if your savings last.`,
            status: 'setup',
            progress: null,
            href: '/plan?tab=retirement',
          }
        : p.gap <= 0
          ? {
              area: 'retirement',
              title: 'Retirement',
              value: formatCompactCurrency(p.atRetirement),
              caption: `projected at retirement · ${formatCompactCurrency(-p.gap)} to spare`,
              status: 'good',
              progress: 1,
              href: '/plan?tab=retirement',
            }
          : {
              area: 'retirement',
              title: 'Retirement',
              value: `${Math.round(clamp(p.atRetirement / p.needed) * 100)}%`,
              caption: `of what you’ll need · short ${formatCompactCurrency(p.gap)}`,
              status: 'attention',
              progress: clamp(p.atRetirement / p.needed),
              href: '/plan?tab=retirement',
            },
    );
  }

  if (s.tax) {
    const t = s.tax;
    const open = t.checklist.filter((c) => !c.done).length;
    const total = t.checklist.length;
    const due = t.balanceDue;
    tiles.push(
      t.missing.length > 0
        ? {
            area: 'tax',
            title: `${t.year} taxes`,
            value: '—',
            setupHeadline: `Estimate ${t.year} taxes`,
            caption: 'Add income and filing status to see brackets and tax moves.',
            status: 'setup',
            progress: null,
            href: '/plan?tab=tax',
          }
        : {
            area: 'tax',
            title: `${t.year} taxes`,
            value:
              due !== null
                ? due > 0
                  ? `Owe ~${formatWholeCurrency(due)}`
                  : `Refund ~${formatWholeCurrency(-due)}`
                : t.totalTax !== null
                  ? formatWholeCurrency(t.totalTax)
                  : '—',
            caption:
              [
                due === null && t.totalTax !== null ? 'estimated tax' : null,
                total ? `${total - open} of ${total} moves done` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No deadlines left this year',
            status: open || (due !== null && due > 0) ? 'attention' : 'good',
            progress: total ? (total - open) / total : null,
            href: '/plan?tab=tax',
          },
    );
  }

  if (s.estate) {
    const r = s.estate.readiness;
    tiles.push(
      r.done === 0
        ? {
            area: 'estate',
            title: 'Estate',
            value: '—',
            setupHeadline: 'Organize your estate',
            caption: 'Track beneficiaries, store key documents, and export a family packet.',
            status: 'setup',
            progress: null,
            href: '/plan?tab=estate',
          }
        : {
            area: 'estate',
            title: 'Estate',
            value: r.total ? `${Math.round((r.done / r.total) * 100)}%` : '—',
            caption: `${r.done} of ${r.total} steps · ${r.documents.done} of ${r.documents.total} documents`,
            status: r.done >= r.total ? 'good' : 'attention',
            progress: r.total ? r.done / r.total : null,
            href: '/plan?tab=estate',
          },
    );
  }

  if (s.policies) {
    const totals = insuranceTotals(s.policies, s.today);
    const disability = totals.longTermDisabilityMonthly || totals.shortTermDisabilityMonthly;
    tiles.push(
      s.policies.length === 0
        ? {
            area: 'insurance',
            title: 'Insurance',
            value: '—',
            setupHeadline: 'Check family coverage',
            caption: 'Upload a policy PDF or log employer life and disability benefits.',
            status: 'setup',
            progress: null,
            href: '/plan?tab=insurance',
          }
        : {
            area: 'insurance',
            title: 'Insurance',
            value: totals.lifeCoverage
              ? formatCompactCurrency(totals.lifeCoverage)
              : disability
                ? `${formatWholeCurrency(disability)}/mo`
                : '—',
            caption: [
              totals.lifeCoverage ? 'life coverage' : disability ? 'disability benefit' : null,
              disability && totals.lifeCoverage ? `${formatWholeCurrency(disability)}/mo disability` : null,
              `${s.policies.length} ${s.policies.length === 1 ? 'policy' : 'policies'}`,
            ]
              .filter(Boolean)
              .join(' · '),
            status: 'good',
            statusLabel: `${s.policies.length} active`,
            progress: null,
            href: '/plan?tab=insurance',
          },
    );
  }

  return tiles;
}

/** Symmetrical grid of long-term plan & protection tiles. */
export function AreaTiles({ columns, ...sources }: AreaSources & { columns: 1 | 2 | 4 }) {
  const tiles = buildTiles(sources);
  if (tiles.length === 0) return null;

  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += columns) {
    rows.push(tiles.slice(i, i + columns));
  }

  return (
    <View style={styles.grid}>
      {rows.map((row, idx) => (
        <View key={idx} style={styles.row}>
          {row.map((t) => (
            <AreaTile key={t.area} tile={t} />
          ))}
        </View>
      ))}
    </View>
  );
}

function AreaTile({ tile: t }: { tile: Tile }) {
  const theme = useTheme();
  const accents = useAccents();
  const viz = useVizColors();
  const area = AREAS[t.area];
  const accent = accents[area.accent];

  if (t.status === 'setup') {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(t.href)}
        style={({ hovered, pressed }) => [
          styles.tile,
          styles.setupTile,
          { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
          pressed && styles.pressed,
        ]}>
        <View style={styles.top}>
          <View style={[styles.badge, { backgroundColor: accent.bg }]}>
            <Icon name={area.icon} size={18} color={accent.fg} />
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.title}>
            {t.title}
          </ThemedText>
        </View>
        <ThemedText style={styles.setupHeadline} numberOfLines={1}>
          {t.setupHeadline ?? t.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.caption} numberOfLines={2}>
          {t.caption}
        </ThemedText>
        <ThemedText type="smallBold" themeColor="tint" style={styles.setupCta}>
          Set up →
        </ThemedText>
      </Pressable>
    );
  }

  const badge = STATUS_BADGE[t.status];
  const fill = t.status === 'attention' ? viz.warning : viz.good;

  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(t.href)}
      style={({ hovered, pressed }) => [
        styles.tile,
        { backgroundColor: theme.backgroundElement, borderColor: hovered ? accent.fg : theme.border },
        pressed && styles.pressed,
      ]}>
      <View style={styles.top}>
        <View style={[styles.badge, { backgroundColor: accent.bg }]}>
          <Icon name={area.icon} size={18} color={accent.fg} />
        </View>
        <ThemedText type="small" numberOfLines={1} style={styles.title}>
          {t.title}
        </ThemedText>
        <View style={[styles.statusPill, { backgroundColor: accents[badge.bg].bg }]}>
          <ThemedText type="smallBold" themeColor={badge.color} style={styles.statusText} numberOfLines={1}>
            {t.statusLabel ?? badge.label}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.value} numberOfLines={1}>
        {t.value}
      </ThemedText>
      {t.progress !== null && (
        <View
          style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(t.progress * 100) }}>
          <View style={[styles.fill, { width: `${t.progress * 100}%`, backgroundColor: fill }]} />
        </View>
      )}
      <ThemedText type="small" themeColor="textSecondary" style={styles.caption} numberOfLines={2}>
        {t.caption}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: Spacing.three,
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    gap: Spacing.two,
  },
  setupTile: {
    borderStyle: 'dashed',
    borderWidth: 1.5,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { width: 32, height: 32, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 11, lineHeight: 15 },
  value: { fontSize: 24, lineHeight: 30, fontWeight: 700, letterSpacing: -0.4 },
  setupHeadline: { fontSize: 17, lineHeight: 22, fontWeight: 700, letterSpacing: -0.2 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  caption: { fontSize: 13, lineHeight: 18 },
  setupCta: { fontSize: 13, lineHeight: 18, marginTop: 'auto', paddingTop: 2 },
  pressed: { opacity: 0.75 },
});
