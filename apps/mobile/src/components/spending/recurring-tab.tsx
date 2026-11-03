import {
  AUTOPAY_AMOUNT_LABELS,
  CADENCE_LABELS,
  type Account,
  type AutopayAmount,
  type AutopayHealth,
  type AutopayStatus,
  type AutopaySuggestion,
  type RecurringKind,
  type RecurringSeries,
  type RecurringSummary,
  type UpcomingItem,
} from '@meld/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { StatTile, TabHeading, TileRow } from '@/components/investments/common';
import { Field, Input, Row } from '@/components/plan/profile-tab';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate, formatWholeCurrency } from '@/lib/format';
import { useAccounts, useDeleteAutopay, useRecurring, useSaveAutopay, useSaveRecurringOverride } from '@/lib/queries';

/** Subscriptions, bills and paychecks found in transactions, and the autopay payments that depend on a bank account. */
export function RecurringTab({ header }: { header: ReactNode }) {
  const recurring = useRecurring();
  return (
    <Screen wide refreshControl={<RefreshControl refreshing={recurring.isRefetching} onRefresh={() => void recurring.refetch()} />}>
      {header}
      <TabHeading
        title="Recurring"
        subtitle="Subscriptions, bills and paychecks Meld found in your transactions, what’s due soon, and whether your bank accounts cover your autopay."
        actions={<Button label="Alert settings" variant="secondary" size="small" onPress={() => router.push('/alerts')} />}
      />
      {recurring.isPending ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : recurring.isError ? (
        <ThemedText themeColor="negative">Couldn’t load recurring payments: {recurring.error.message}</ThemedText>
      ) : (
        <RecurringView data={recurring.data} />
      )}
    </Screen>
  );
}

function RecurringView({ data }: { data: RecurringSummary }) {
  const { totals, series } = data;
  const active = series.filter((s) => s.status === 'active');
  const count = (kind: RecurringKind) => active.filter((s) => s.kind === kind).length;
  return (
    <>
      <TileRow>
        <StatTile
          label="Subscriptions"
          value={`${formatWholeCurrency(totals.subscriptionsMonthly)}/mo`}
          caption={`${count('subscription')} active · ${formatWholeCurrency(totals.subscriptionsMonthly * 12)} a year`}
        />
        <StatTile label="Bills" value={`${formatWholeCurrency(totals.billsMonthly)}/mo`} caption={`${count('bill')} active`} />
        <StatTile label="Due in the next 30 days" value={totals.dueNext30} caption="Bills, subscriptions and autopay" />
        <StatTile label="Recurring income" value={`${formatWholeCurrency(totals.incomeMonthly)}/mo`} caption={`${count('income')} deposits`} />
      </TileRow>

      <AutopayCard data={data} />
      <UpcomingCard items={data.upcoming} />
      <SeriesCard
        title="Subscriptions"
        subtitle="Services that charge on a schedule. Look for ones you no longer use."
        series={active.filter((s) => s.kind === 'subscription')}
        empty="No subscriptions found yet."
      />
      <SeriesCard
        title="Bills"
        subtitle="Utilities, insurance, loans and other bills, including ones whose amount changes."
        series={active.filter((s) => s.kind === 'bill')}
        empty="No recurring bills found yet."
      />
      <SeriesCard
        title="Income"
        subtitle="Paychecks and other deposits that arrive on a schedule."
        series={active.filter((s) => s.kind === 'income')}
        empty="No recurring deposits found yet."
      />
      <InactiveCard series={series.filter((s) => s.status !== 'active')} />
    </>
  );
}

// --- Autopay ------------------------------------------------------------------

const HEALTH: Record<AutopayHealth, { label: string; color: 'positive' | 'warning' | 'negative' | 'textSecondary' }> = {
  covered: { label: 'Covered', color: 'positive' },
  tight: { label: 'Tight', color: 'warning' },
  short: { label: 'Short', color: 'negative' },
  paid: { label: 'Paid', color: 'positive' },
  unknown: { label: 'Unknown', color: 'textSecondary' },
};

const SOURCE: Record<NonNullable<AutopayStatus['amountSource']>, string> = {
  statement: 'statement balance',
  minimum: 'minimum payment',
  balance: 'current balance',
  fixed: 'fixed amount',
  scheduled: 'scheduled payment',
  estimate: 'estimated: next statement isn’t out yet',
};

type Draft = { id?: string; payeeAccountId: string; fundingAccountId: string; amountRule: AutopayAmount; fixedAmount: string };

function AutopayCard({ data }: { data: RecurringSummary }) {
  const theme = useTheme();
  const accounts = useAccounts();
  const [draft, setDraft] = useState<Draft | null>(null);
  const visible = (accounts.data ?? []).filter((a) => !a.hidden);
  const payees = visible.filter((a) => a.type === 'credit' || a.type === 'loan' || a.type === 'mortgage');
  const banks = visible.filter((a) => a.type === 'depository');

  const blank = (): Draft => ({
    payeeAccountId: payees.find((p) => !data.autopay.some((a) => a.payeeAccountId === p.id))?.id ?? payees[0]?.id ?? '',
    fundingAccountId: banks.find((b) => b.subtype === 'checking')?.id ?? banks[0]?.id ?? '',
    amountRule: 'statement_balance',
    fixedAmount: '',
  });
  const fromSuggestion = (s: AutopaySuggestion): Draft => ({
    payeeAccountId: s.payeeAccountId,
    fundingAccountId: s.fundingAccountId,
    amountRule: s.likelyRule,
    fixedAmount: s.likelyRule === 'fixed' ? String(s.lastAmount) : '',
  });

  return (
    <Card
      title="Autopay"
      subtitle="Cards and loans paid automatically from a bank account. Meld checks each payment against what the bank account will hold on the due date, after other bills, and alerts you when it falls short."
      action={!draft && payees.length > 0 && banks.length > 0 && <Button label="Add autopay" size="small" onPress={() => setDraft(blank())} />}>
      {draft && <AutopayEditor draft={draft} payees={payees} banks={banks} onClose={() => setDraft(null)} />}

      {data.suggestions.map((s) => (
        <View key={s.payeeAccountId} style={[styles.suggestion, { borderColor: theme.border }]}>
          <Icon name="sparkles" size={18} themeColor="tint" />
          <View style={styles.grow}>
            <ThemedText type="smallBold">
              {s.fundingName} seems to pay {s.payeeName}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {s.payments} {s.payments === 1 ? 'payment' : 'payments'} lately, most recently {formatCurrency(s.lastAmount)} on {formatDate(s.lastDate)}. Is it
              on autopay?
            </ThemedText>
          </View>
          <Button label="Set up" variant="secondary" size="small" onPress={() => setDraft(fromSuggestion(s))} />
        </View>
      ))}

      {data.autopay.length === 0 && !draft && data.suggestions.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {payees.length === 0
            ? 'Link a credit card or loan to track its autopay.'
            : 'Add a card or loan that pays itself from a bank account, and Meld will warn you before that account runs short.'}
        </ThemedText>
      )}

      {data.autopay.map((a) =>
        draft?.id === a.id ? null : (
          <AutopayRow
            key={a.id}
            status={a}
            onEdit={() =>
              setDraft({
                id: a.id,
                payeeAccountId: a.payeeAccountId,
                fundingAccountId: a.fundingAccountId,
                amountRule: a.amountRule,
                fixedAmount: a.fixedAmount === null ? '' : String(a.fixedAmount),
              })
            }
          />
        ),
      )}
    </Card>
  );
}

function AutopayRow({ status: a, onEdit }: { status: AutopayStatus; onEdit: () => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(a.health === 'short' || a.health === 'tight');
  const health = HEALTH[a.health];
  return (
    <View style={[styles.autopay, { borderTopColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.autopayHead}>
        <View style={styles.grow}>
          <ThemedText numberOfLines={1}>
            {a.payeeName} <ThemedText themeColor="textSecondary">from {a.fundingName}</ThemedText>
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {a.health === 'paid'
              ? `Paid · next due around ${a.dueDate ? formatDate(a.dueDate) : '—'}`
              : a.dueDate && a.amount !== null
                ? `${formatCurrency(a.amount)} due ${formatDate(a.dueDate)} · ${a.amountSource ? SOURCE[a.amountSource] : ''}`
                : AUTOPAY_AMOUNT_LABELS[a.amountRule]}
          </ThemedText>
        </View>
        <View style={[styles.badge, { borderColor: theme[health.color] }]}>
          <ThemedText type="smallBold" themeColor={health.color}>
            {health.label}
          </ThemedText>
        </View>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} themeColor="textSecondary" />
      </Pressable>
      {open && (
        <View style={styles.autopayBody}>
          <ThemedText type="small">{a.summary}</ThemedText>
          {a.paidSinceStatement > 0 && a.statementBalance !== null && a.health !== 'paid' && (
            <ThemedText type="small" themeColor="textSecondary">
              Statement of {formatCurrency(a.statementBalance)}
              {a.statementDate ? ` on ${formatDate(a.statementDate)}` : ''}, less {formatCurrency(a.paidSinceStatement)} already paid.
            </ThemedText>
          )}
          {a.before.length > 0 && (
            <View style={styles.before}>
              <ThemedText type="small" themeColor="textSecondary">
                Before the due date, in {a.fundingName}:
              </ThemedText>
              {a.before.map((o, i) => (
                <View key={i} style={styles.beforeRow}>
                  <ThemedText type="small" style={styles.beforeDate}>
                    {formatDate(o.date)}
                  </ThemedText>
                  <ThemedText type="small" style={styles.grow} numberOfLines={1}>
                    {o.name}
                    {o.source === 'autopay' ? ' autopay' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor={o.source === 'income' ? 'positive' : 'text'} style={styles.num}>
                    {o.source === 'income' ? '+' : '−'}
                    {formatCurrency(o.amount)}
                  </ThemedText>
                </View>
              ))}
              {a.fundingBalance !== null && a.projectedAfter !== null && (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatCurrency(a.fundingBalance)} now → {formatCurrency(a.projectedAfter)} after this payment
                </ThemedText>
              )}
            </View>
          )}
          <View style={styles.actions}>
            <Button label="Edit" variant="secondary" size="small" onPress={onEdit} />
          </View>
        </View>
      )}
    </View>
  );
}

function AutopayEditor({ draft: initial, payees, banks, onClose }: { draft: Draft; payees: Account[]; banks: Account[]; onClose: () => void }) {
  const theme = useTheme();
  const save = useSaveAutopay();
  const remove = useDeleteAutopay();
  const [d, setD] = useState(initial);
  const fixed = d.fixedAmount.trim() ? Number(d.fixedAmount.replace(/[$,\s]/g, '')) : null;
  const payee = payees.find((p) => p.id === d.payeeAccountId);
  const isCard = payee?.type === 'credit';
  const rules: AutopayAmount[] = isCard ? ['statement_balance', 'minimum', 'current_balance', 'fixed'] : ['statement_balance', 'fixed'];
  const fixedInvalid = d.amountRule === 'fixed' && !(fixed !== null && fixed > 0);
  const label = (a: Account) => `${a.name}${a.mask ? ` ••${a.mask}` : ''}`;

  function submit() {
    if (fixedInvalid || !d.payeeAccountId || !d.fundingAccountId) return;
    save.mutate(
      { id: d.id, payeeAccountId: d.payeeAccountId, fundingAccountId: d.fundingAccountId, amountRule: d.amountRule, fixedAmount: d.amountRule === 'fixed' ? fixed : null },
      { onSuccess: onClose },
    );
  }

  return (
    <View style={[styles.editor, { borderColor: theme.border, backgroundColor: theme.background }]}>
      <Row>
        <Field label="Card or loan">
          <Dropdown
            accessibilityLabel="Card or loan paid by autopay"
            options={payees.map((p) => ({ value: p.id, label: label(p) }))}
            value={d.payeeAccountId}
            onChange={(v) => setD({ ...d, payeeAccountId: v, amountRule: payees.find((p) => p.id === v)?.type === 'credit' ? d.amountRule : 'statement_balance' })}
          />
        </Field>
        <Field label="Paid from">
          <Dropdown
            accessibilityLabel="Bank account the autopay comes out of"
            options={banks.map((b) => ({ value: b.id, label: label(b) }))}
            value={d.fundingAccountId}
            onChange={(v) => setD({ ...d, fundingAccountId: v })}
          />
        </Field>
      </Row>
      <Field label="Pays">
        <View style={styles.chips}>
          {rules.map((r) => (
            <Chip
              key={r}
              label={!isCard && r === 'statement_balance' ? 'Scheduled payment' : AUTOPAY_AMOUNT_LABELS[r]}
              selected={d.amountRule === r}
              onPress={() => setD({ ...d, amountRule: r })}
            />
          ))}
          {d.amountRule === 'fixed' && (
            <Input
              value={d.fixedAmount}
              onChangeText={(v) => setD({ ...d, fixedAmount: v })}
              placeholder="$"
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel="Fixed autopay amount"
              style={[styles.amountInput, fixedInvalid && d.fixedAmount.trim() !== '' && { borderColor: theme.negative }]}
            />
          )}
        </View>
      </Field>
      {(save.isError || remove.isError) && <ThemedText themeColor="negative">{(save.error ?? remove.error)!.message}</ThemedText>}
      <View style={styles.actions}>
        <Button label="Save" disabled={fixedInvalid} loading={save.isPending} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={onClose} />
        {d.id && (
          <Button label="Remove" variant="danger" loading={remove.isPending} onPress={() => remove.mutate(d.id!, { onSuccess: onClose })} style={styles.push} />
        )}
      </View>
    </View>
  );
}

// --- Upcoming -----------------------------------------------------------------

function UpcomingCard({ items }: { items: UpcomingItem[] }) {
  const theme = useTheme();
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 10);
  return (
    <Card title="Coming up" subtitle="The next 30 days, from each series’ usual timing. Dates and varying amounts are estimates.">
      <View>
        {shown.map((u) => (
          <View key={`${u.ref}:${u.date}`} style={[styles.row, { borderTopColor: theme.border }]}>
            <ThemedText type="small" style={styles.date}>
              {formatDate(u.date)}
            </ThemedText>
            <Icon name={u.kind === 'autopay' ? 'card' : u.kind === 'income' ? 'arrowDownRight' : 'repeat'} size={16} themeColor="textSecondary" />
            <View style={styles.grow}>
              <ThemedText numberOfLines={1}>{u.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {u.accountName}
              </ThemedText>
            </View>
            <ThemedText themeColor={u.amount < 0 ? 'positive' : 'text'} style={styles.num}>
              {u.approximate ? '~' : ''}
              {u.amount < 0 ? '+' : ''}
              {formatCurrency(Math.abs(u.amount))}
            </ThemedText>
          </View>
        ))}
      </View>
      {items.length > 10 && <Button label={all ? 'Show fewer' : `Show all ${items.length}`} variant="secondary" size="small" onPress={() => setAll(!all)} />}
    </Card>
  );
}

// --- Series -------------------------------------------------------------------

const KINDS: { value: RecurringKind; label: string }[] = [
  { value: 'subscription', label: 'Subscription' },
  { value: 'bill', label: 'Bill' },
  { value: 'income', label: 'Income' },
];

function SeriesCard({ title, subtitle, series, empty }: { title: string; subtitle: string; series: RecurringSeries[]; empty: string }) {
  const total = series.reduce((s, x) => s + x.monthlyAmount, 0);
  return (
    <Card title={title} subtitle={series.length ? `${subtitle} About ${formatWholeCurrency(total)} a month.` : subtitle}>
      {series.length ? (
        <View>
          {series.map((s) => (
            <SeriesRow key={s.key} series={s} />
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      )}
    </Card>
  );
}

function SeriesRow({ series: s }: { series: RecurringSeries }) {
  const theme = useTheme();
  const save = useSaveRecurringOverride();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(s.name);
  const detail =
    s.status === 'active'
      ? `${CADENCE_LABELS[s.cadence]} · ${s.accountName} · next ${formatDate(s.nextDate)}`
      : s.status === 'stopped'
        ? `${CADENCE_LABELS[s.cadence]} · last charged ${formatDate(s.lastDate)}`
        : `${CADENCE_LABELS[s.cadence]} · marked not recurring`;
  return (
    <View style={[styles.series, { borderTopColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.row}>
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <ThemedText numberOfLines={1} style={styles.shrink}>
              {s.name}
            </ThemedText>
            {s.priceChange && s.status === 'active' && (
              <View style={[styles.badge, { borderColor: s.priceChange.to > s.priceChange.from ? theme.warning : theme.positive }]}>
                <ThemedText type="smallBold" themeColor={s.priceChange.to > s.priceChange.from ? 'warning' : 'positive'}>
                  {s.priceChange.to > s.priceChange.from ? 'Price up' : 'Price down'} from {formatCurrency(s.priceChange.from)}
                </ThemedText>
              </View>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {detail}
          </ThemedText>
        </View>
        <View style={styles.amounts}>
          <ThemedText style={styles.num}>
            {s.amountVaries ? '~' : ''}
            {formatCurrency(s.amount)}
          </ThemedText>
          {s.cadence !== 'monthly' && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.num}>
              {formatCurrency(s.monthlyAmount)}/mo
            </ThemedText>
          )}
        </View>
      </Pressable>
      {open && (
        <View style={styles.seriesBody}>
          <ThemedText type="small" themeColor="textSecondary">
            Recent: {s.recent.map((r) => `${formatCurrency(r.amount)} on ${formatDate(r.date)}`).join(' · ')}
            {s.occurrences > s.recent.length ? ` · ${s.occurrences} charges since ${formatDate(s.firstDate)}` : ''}
          </ThemedText>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Chip key={k.value} label={k.label} selected={s.kind === k.value} onPress={() => save.mutate({ key: s.key, kind: k.value === s.detectedKind ? null : k.value })} />
            ))}
          </View>
          <View style={styles.chips}>
            <Input value={name} onChangeText={setName} accessibilityLabel="Name" style={styles.nameInput} />
            {name.trim() !== s.name && name.trim() !== '' && (
              <Button label="Rename" variant="secondary" size="small" loading={save.isPending} onPress={() => save.mutate({ key: s.key, name: name.trim() })} />
            )}
          </View>
          {save.isError && <ThemedText themeColor="negative">{save.error.message}</ThemedText>}
          <View style={styles.actions}>
            <Button
              label="See charges"
              variant="secondary"
              size="small"
              onPress={() => router.push({ pathname: '/spending', params: { tab: 'transactions', search: s.search } })}
            />
            <Button
              label={s.status === 'ignored' ? 'Restore' : 'Not recurring'}
              variant="secondary"
              size="small"
              loading={save.isPending}
              onPress={() => save.mutate({ key: s.key, ignored: s.status !== 'ignored' })}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function InactiveCard({ series }: { series: RecurringSeries[] }) {
  const [open, setOpen] = useState(false);
  if (!series.length) return null;
  const stopped = series.filter((s) => s.status === 'stopped').length;
  return (
    <Card
      title="Stopped or ignored"
      subtitle={`${stopped} ${stopped === 1 ? 'series has' : 'series have'} stopped charging (canceled, or the card changed), and ${series.length - stopped} you marked not recurring.`}
      action={<Button label={open ? 'Hide' : 'Show'} variant="secondary" size="small" onPress={() => setOpen(!open)} />}>
      {open && (
        <View>
          {series.map((s) => (
            <SeriesRow key={s.key} series={s} />
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  num: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  date: { width: 56, fontVariant: ['tabular-nums'] },
  series: { borderTopWidth: StyleSheet.hairlineWidth },
  seriesBody: { gap: Spacing.two, paddingBottom: Spacing.three },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  amounts: { alignItems: 'flex-end' },
  badge: { borderWidth: 1, borderRadius: Spacing.five, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  push: { marginLeft: 'auto' },
  nameInput: { minWidth: 200, flexGrow: 1, flexBasis: 200, maxWidth: 360 },
  amountInput: { width: 120 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    borderStyle: 'dashed',
  },
  autopay: { borderTopWidth: StyleSheet.hairlineWidth },
  autopayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  autopayBody: { gap: Spacing.two, paddingBottom: Spacing.three },
  before: { gap: Spacing.one },
  beforeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  beforeDate: { width: 56, fontVariant: ['tabular-nums'] },
  editor: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: Spacing.three, zIndex: 2 },
});
