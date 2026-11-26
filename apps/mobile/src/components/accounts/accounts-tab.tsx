import {
  isLiabilityType,
  netCashValue,
  ownedBalance,
  ownedValue,
  type Account,
  type BalanceSnapshot,
  type ManualAsset,
  type PlaidItemSummary,
} from '@meld/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AccountBreakdown } from '@/components/accounts/account-breakdown';
import { AccountTiles } from '@/components/accounts/account-tiles';
import { Change, percentChange } from '@/components/accounts/change';
import { SECTIONS, type AccountFilter, type AccountSection } from '@/components/accounts/groups';
import { InstitutionAvatar } from '@/components/accounts/institution-avatar';
import { RecentActivity } from '@/components/accounts/recent-activity';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { AskMeldPanel } from '@/components/home/ask-meld-panel';
import { Icon, type IconName } from '@/components/icon';
import { AssetForm, manualAssetDetail } from '@/components/manual-assets';
import { PlaidLinkButton } from '@/components/plaid-link-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAccents } from '@/hooks/use-accents';
import { useTheme } from '@/hooks/use-theme';
import { useContentWidth } from '@/lib/chat-panel';
import { confirm } from '@/lib/confirm';
import { useSetupStatus } from '@/lib/setup';
import { formatCurrency, formatDate, formatRelativeTime } from '@/lib/format';
import { POLICY_TYPE_LABELS } from '@/lib/insurance';
import {
  useAccounts,
  useBalanceComparison,
  useInsurancePolicies,
  useItems,
  useManualAssets,
  useNetWorth,
  useRemoveItem,
  useSyncItem,
} from '@/lib/queries';

/** Window width at which the breakdown, activity and Ask Meld move beside the list. */
const SIDE_PANEL_MIN_WIDTH = 1280;
/** "vs. last month" */
const COMPARE_DAYS = 30;

const SUGGESTIONS = [
  'How much is in my retirement accounts?',
  'Am I on track for my goals?',
  'Should I pay extra on my mortgage?',
  'What are my biggest risks right now?',
];

type Message = { text: string; error?: boolean };

type Row = {
  key: string;
  name: string;
  detail: string;
  institution: string | null;
  icon: IconName;
  value: number;
  currency?: string;
  percent: number | null;
  liability?: boolean;
  onPress: () => void;
  hint: string;
  /** A manual asset, edited in place instead of opening a page. */
  asset?: ManualAsset;
};

/** Everything you own and owe, grouped by kind, plus the bank connections behind it. */
export function AccountsTab({ header }: { header: (actions: ReactNode) => ReactNode }) {
  const width = useContentWidth();
  const accounts = useAccounts({ includeHidden: true });
  const items = useItems();
  const netWorth = useNetWorth();
  const comparison = useBalanceComparison(COMPARE_DAYS);
  const policies = useInsurancePolicies();
  const assets = useManualAssets();
  const [message, setMessage] = useState<Message | null>(null);
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [editing, setEditing] = useState<ManualAsset | 'new' | null>(null);
  const demo = useSetupStatus().data?.demo ?? false;

  const queries = [accounts, items, netWorth, comparison, policies, assets];
  const refreshing = queries.some((q) => q.isRefetching);
  const onRefresh = () => void Promise.all(queries.map((q) => q.refetch()));
  const sidePanel = width >= SIDE_PANEL_MIN_WIDTH;

  const headerEl = header(
    // Demo data has nothing to link to; the first step is a Plaid account of your own.
    demo ? (
      <Button label="Connect my banks" onPress={() => router.push('/connect')} />
    ) : (
      <PlaidLinkButton
        onLinked={() => setMessage({ text: 'Account linked. Transaction history may take a minute to arrive.' })}
        onError={(text) => setMessage({ text, error: true })}
      />
    ),
  );
  const messageEl = message && (
    <ThemedText type="small" themeColor={message.error ? 'negative' : 'textSecondary'}>
      {message.text}
    </ThemedText>
  );

  if (accounts.isPending || items.isPending || netWorth.isPending) {
    return (
      <Screen wide>
        {headerEl}
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </Screen>
    );
  }
  if (accounts.isError || items.isError || netWorth.isError) {
    return (
      <Screen wide>
        {headerEl}
        <ThemedText themeColor="negative">
          Couldn’t load accounts: {(accounts.error ?? items.error ?? netWorth.error)?.message}
        </ThemedText>
      </Screen>
    );
  }

  const list = (
    <AllAccounts
      accounts={accounts.data}
      items={items.data}
      policies={policies.data ?? []}
      assets={assets.data ?? []}
      comparison={comparison.data}
      filter={filter}
      onFilter={setFilter}
      editing={editing}
      onEdit={setEditing}
      onMessage={setMessage}
    />
  );
  const tiles = <AccountTiles summary={netWorth.data} comparison={comparison.data} onSelect={setFilter} />;
  const side = [
    <AccountBreakdown key="breakdown" summary={netWorth.data} />,
    <RecentActivity key="activity" accounts={accounts.data} />,
    <AskMeldPanel key="ask" suggestions={SUGGESTIONS} />,
  ];

  return (
    <Screen wide refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {headerEl}
      {messageEl}
      {sidePanel ? (
        <View style={styles.split}>
          <View style={styles.main}>
            {tiles}
            {list}
          </View>
          <View style={styles.side}>{side}</View>
        </View>
      ) : (
        <>
          {tiles}
          {list}
          {side}
        </>
      )}
    </Screen>
  );
}

function AllAccounts({
  accounts,
  items,
  policies,
  assets,
  comparison,
  filter,
  onFilter,
  editing,
  onEdit,
  onMessage,
}: {
  accounts: Account[];
  items: PlaidItemSummary[];
  policies: NonNullable<ReturnType<typeof useInsurancePolicies>['data']>;
  assets: ManualAsset[];
  comparison: BalanceSnapshot | null | undefined;
  filter: AccountFilter;
  onFilter: (f: AccountFilter) => void;
  editing: ManualAsset | 'new' | null;
  onEdit: (e: ManualAsset | 'new' | null) => void;
  onMessage: (m: Message) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [showConnections, setShowConnections] = useState<boolean | null>(null);
  const before = (id: string) => comparison?.balances?.[id];

  const accountRow = (a: Account): Row => {
    const shared = a.ownershipPercent !== null;
    // Shared accounts show your share, matching the section total.
    const value = shared ? ownedBalance(a) : (a.currentBalance ?? 0);
    return {
      key: a.id,
      name: a.name,
      detail: [
        a.institutionName,
        a.mask && `•••• ${a.mask}`,
        shared && `${a.ownershipPercent}% of ${formatCurrency(a.currentBalance, a.currency)}`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      institution: a.institutionName,
      icon: 'wallet',
      value,
      currency: a.currency,
      percent: a.hidden ? null : percentChange(ownedBalance(a), before(a.id)),
      liability: isLiabilityType(a.type),
      onPress: () => router.push({ pathname: '/account/[id]', params: { id: a.id } }),
      hint: 'Show account details',
    };
  };

  const rowsFor = (section: AccountSection): Row[] => {
    const plaid = accounts.filter((a) => !a.hidden && section.types?.includes(a.type)).map(accountRow);
    if (section.key === 'insurance') {
      return policies.flatMap((p) => {
        const value = netCashValue(p);
        if (value === null) return [];
        return [
          {
            key: p.id,
            name: `${POLICY_TYPE_LABELS[p.type]} (cash value)`,
            detail: [p.carrier, p.valuesAsOf && `as of ${formatDate(p.valuesAsOf)}`].filter(Boolean).join('  ·  '),
            institution: p.carrier,
            icon: 'shield' as const,
            value,
            percent: percentChange(value, before(p.id)),
            onPress: () => router.push({ pathname: '/insurance/[id]', params: { id: p.id } }),
            hint: 'Show policy details',
          },
        ];
      });
    }
    if (section.key === 'property') {
      return [
        ...assets.map((a) => ({
          key: a.id,
          name: a.name,
          detail: manualAssetDetail(a),
          institution: null,
          icon: (a.kind === 'home' ? 'home' : 'wallet') as IconName,
          value: ownedValue(a),
          percent: percentChange(ownedValue(a), before(a.id)),
          onPress: () => onEdit(a),
          hint: 'Edit asset',
          asset: a,
        })),
        ...plaid,
      ];
    }
    return plaid;
  };

  const sections = SECTIONS.map((s) => ({ section: s, rows: rowsFor(s) }));
  const hidden = accounts.filter((a) => a.hidden).map(accountRow);
  const addingAsset = editing === 'new';
  // Empty sections stay out of the list, unless picked or being added to.
  const visible = sections.filter(
    ({ section, rows }) =>
      (filter === 'all' || filter === section.key) &&
      (rows.length > 0 || filter === section.key || (section.key === 'property' && addingAsset)),
  );
  const chips = sections.filter(({ section, rows }) => rows.length > 0 || filter === section.key);

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const attention = items.filter((i) => i.status !== 'active');
  const connectionsOpen = showConnections ?? attention.length > 0;

  const menu = [
    {
      label: 'Add property or vehicle',
      onPress: () => {
        onFilter('property');
        onEdit('new');
      },
    },
    { label: 'Add insurance policy', onPress: () => router.push('/insurance/new') },
    { label: connectionsOpen ? 'Hide connections' : 'Manage connections', onPress: () => setShowConnections(!connectionsOpen) },
  ];

  return (
    <Card style={styles.allCard}>
      <View style={styles.listHeader}>
        <ThemedText type="cardTitle">All accounts</ThemedText>
        <View style={styles.chips}>
          <Chip label="All" selected={filter === 'all'} onPress={() => onFilter('all')} />
          {chips.map(({ section }) => (
            <Chip
              key={section.key}
              label={section.chip ?? section.label}
              selected={filter === section.key}
              onPress={() => onFilter(section.key)}
            />
          ))}
          <OverflowMenu open={menuOpen} onOpenChange={setMenuOpen} items={menu} />
        </View>
      </View>

      {visible.map(({ section, rows }) => (
        <Section
          key={section.key}
          label={section.label}
          icon={section.icon}
          total={rows.reduce((s, r) => s + r.value, 0)}
          liability={section.key === 'credit' || section.key === 'loans'}
          collapsed={collapsed.has(section.key)}
          onToggle={() => toggle(section.key)}
          action={
            section.key === 'property' ? (
              <Button label="Add" variant="secondary" size="small" onPress={() => onEdit('new')} />
            ) : section.key === 'insurance' ? (
              <Button label="Add policy" variant="secondary" size="small" onPress={() => router.push('/insurance/new')} />
            ) : undefined
          }>
          {rows.map((r) =>
            r.asset && editing !== 'new' && editing?.id === r.asset.id ? (
              <View key={r.key} style={styles.form}>
                <AssetForm asset={r.asset} onDone={() => onEdit(null)} />
              </View>
            ) : (
              <AccountRow key={r.key} row={r} />
            ),
          )}
          {section.key === 'property' && addingAsset && (
            <View style={styles.form}>
              <AssetForm onDone={() => onEdit(null)} />
            </View>
          )}
          {rows.length === 0 && !(section.key === 'property' && addingAsset) && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {section.key === 'insurance'
                ? 'Whole and universal life policies build cash value that counts toward net worth. Term and disability policies are under Plan.'
                : section.key === 'property'
                  ? 'Add your home, car and the like. Enter an address or a car’s details to look up its value.'
                  : 'No accounts of this kind yet.'}
            </ThemedText>
          )}
        </Section>
      ))}

      {filter === 'all' && hidden.length > 0 && (
        <Section
          label="Hidden from totals"
          icon="lock"
          collapsed={!collapsed.has('hidden')}
          onToggle={() => toggle('hidden')}>
          {hidden.map((r) => (
            <AccountRow key={r.key} row={r} />
          ))}
        </Section>
      )}

      <ConnectionsBanner
        items={items}
        attention={attention.length}
        open={connectionsOpen}
        onToggle={() => setShowConnections(!connectionsOpen)}
      />
      {connectionsOpen && items.map((item) => <ConnectionRow key={item.id} item={item} onMessage={onMessage} />)}
    </Card>
  );
}

function Section({
  label,
  icon,
  total,
  liability,
  collapsed,
  onToggle,
  action,
  children,
}: {
  label: string;
  icon: IconName;
  total?: number;
  liability?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderColor: theme.border }]}>
      <View style={[styles.sectionHeader, { backgroundColor: theme.backgroundSelected }]}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={label}
          style={({ pressed }) => [styles.sectionToggle, pressed && styles.pressed]}>
          <Icon name={icon} size={18} themeColor="tint" />
          <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
            {label}
          </ThemedText>
          {total !== undefined && (
            // Plaid reports liabilities as positive amounts owed.
            <ThemedText type="smallBold" themeColor={liability ? 'negative' : 'text'} style={styles.tabular}>
              {formatCurrency(total)}
            </ThemedText>
          )}
          <View style={collapsed && styles.flipped}>
            <Icon name="chevronDown" size={16} themeColor="textSecondary" />
          </View>
        </Pressable>
        {action && !collapsed && action}
      </View>
      {!collapsed && children}
    </View>
  );
}

function AccountRow({ row }: { row: Row }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={row.onPress}
      style={({ hovered, pressed }) => [
        styles.row,
        { borderTopColor: theme.border },
        hovered && { backgroundColor: theme.background },
        pressed && styles.pressed,
      ]}
      accessibilityRole="link"
      accessibilityHint={row.hint}>
      <InstitutionAvatar name={row.institution} icon={row.icon} />
      <View style={styles.grow}>
        <ThemedText numberOfLines={1}>{row.name}</ThemedText>
        {!!row.detail && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {row.detail}
          </ThemedText>
        )}
      </View>
      <ThemedText style={styles.tabular}>{formatCurrency(row.value, row.currency)}</ThemedText>
      <Change percent={row.percent} liability={row.liability} style={styles.change} />
      <Icon name="chevronRight" size={16} themeColor="textSecondary" />
    </Pressable>
  );
}

function OverflowMenu({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: { label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  return (
    // Raised so the open menu draws over the list.
    <View style={open && styles.raised}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More actions"
        accessibilityState={{ expanded: open }}
        onPress={() => onOpenChange(!open)}
        style={({ hovered }) => [styles.more, hovered && { backgroundColor: theme.backgroundSelected }]}>
        <Icon name="more" size={18} themeColor="textSecondary" strokeWidth={2.5} />
      </Pressable>
      {open && (
        <View style={[styles.menu, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onOpenChange(false);
                item.onPress();
              }}
              style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small" numberOfLines={1}>
                {item.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ConnectionsBanner({
  items,
  attention,
  open,
  onToggle,
}: {
  items: PlaidItemSummary[];
  attention: number;
  open: boolean;
  onToggle: () => void;
}) {
  const accent = useAccents()[attention ? 'orange' : 'green'];
  const [title, body] =
    items.length === 0
      ? [
          'Link your first account.',
          'Connect banks, cards, brokerages and loans through Plaid. Meld only reads balances and transactions; it can’t move money.',
        ]
      : attention
        ? [
            `${attention} of your ${items.length} connections ${attention === 1 ? 'needs' : 'need'} attention.`,
            'Sign in again or refresh below to keep their balances current.',
          ]
        : [
            'Your accounts are securely connected with Plaid.',
            'Meld refreshes balances every few hours, and can only read your data; it can’t move money.',
          ];
  return (
    <View style={[styles.banner, { backgroundColor: accent.bg }]}>
      <Icon name={attention ? 'info' : 'lock'} size={18} color={accent.fg} />
      <View style={styles.grow}>
        <ThemedText type="small" style={{ color: accent.fg }}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.bannerBody}>
          {body}
        </ThemedText>
      </View>
      {items.length > 0 && (
        <Button label={open ? 'Hide connections' : 'Manage connections'} variant="secondary" size="small" onPress={onToggle} />
      )}
    </View>
  );
}

function ConnectionRow({ item, onMessage }: { item: PlaidItemSummary; onMessage: (m: Message) => void }) {
  const theme = useTheme();
  const sync = useSyncItem();
  const remove = useRemoveItem();
  const name = item.institutionName ?? 'Unknown institution';
  const needsLogin = item.status === 'login_required';

  async function refresh() {
    try {
      const r = await sync.mutateAsync(item.id);
      onMessage({
        text: `${name} refreshed: ${r.added} new, ${r.modified} updated, ${r.removed} removed transactions.`,
      });
    } catch (e) {
      onMessage({ text: (e as Error).message, error: true });
    }
  }

  async function removeItem() {
    const ok = await confirm(
      `Remove ${name}?`,
      `This disconnects ${name} and deletes its ${item.accountCount} accounts and their transactions from Meld.`,
      'Remove',
    );
    if (!ok) return;
    try {
      await remove.mutateAsync(item.id);
      onMessage({ text: `${name} removed.` });
    } catch (e) {
      onMessage({ text: (e as Error).message, error: true });
    }
  }

  return (
    <View style={[styles.connection, { borderColor: theme.border }]}>
      <InstitutionAvatar name={name} />
      <View style={styles.grow}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText
          type="small"
          style={{ color: needsLogin || item.status === 'error' ? theme.warning : theme.textSecondary }}>
          {needsLogin
            ? 'Sign-in needed to keep syncing'
            : item.status === 'error'
              ? `Sync error: ${item.lastError ?? 'unknown'}`
              : `${item.accountCount} accounts · synced ${formatRelativeTime(item.lastSyncedAt)}`}
        </ThemedText>
      </View>
      <View style={styles.buttons}>
        {needsLogin ? (
          <PlaidLinkButton
            itemId={item.id}
            size="small"
            onLinked={() => onMessage({ text: `${name} reconnected.` })}
            onError={(text) => onMessage({ text, error: true })}
          />
        ) : (
          <Button label="Refresh" variant="secondary" size="small" loading={sync.isPending} onPress={refresh} />
        )}
        <Button label="Remove" variant="danger" size="small" loading={remove.isPending} onPress={removeItem} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  main: { flex: 1, minWidth: 0, gap: Spacing.three },
  side: { width: 380, gap: Spacing.three },
  allCard: { gap: Spacing.three },
  listHeader: {
    zIndex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  section: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingRight: Spacing.three },
  sectionToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    paddingLeft: Spacing.three,
  },
  flipped: { transform: [{ rotate: '180deg' }] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderTopWidth: 1,
  },
  grow: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  change: { width: 52 },
  form: { padding: Spacing.three },
  empty: { padding: Spacing.three },
  more: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  raised: { zIndex: 10 },
  menu: {
    position: 'absolute',
    top: 36,
    right: 0,
    minWidth: 220,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  menuItem: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  bannerBody: { fontSize: 13 },
  connection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  pressed: { opacity: 0.6 },
});
