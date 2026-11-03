import { estimatePayoff, isLiabilityType, ownedBalance, type Account, type LiabilityDetails } from '@meld/shared';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { HoldingsList } from '@/components/holdings-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { useAccountDetail, useUpdateAccount } from '@/lib/queries';

const KIND_LABELS: Record<LiabilityDetails['kind'], string> = {
  credit: 'Credit card',
  mortgage: 'Mortgage',
  student: 'Student loan',
  loan: 'Loan',
  line_of_credit: 'Line of credit',
};

function formatDuration(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years && `${years} yr`, rest && `${rest} mo`].filter(Boolean).join(' ') || '0 mo';
}

function payoffDate(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useAccountDetail(id);
  const update = useUpdateAccount();
  const account = detail.data?.account;

  const back = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))}>
      <ThemedText type="linkPrimary">‹ Accounts</ThemedText>
    </Pressable>
  );

  if (detail.isPending) {
    return (
      <Screen title="Account" actions={back}>
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </Screen>
    );
  }
  if (detail.isError || !account) {
    return (
      <Screen title="Account" actions={back}>
        <ThemedText themeColor="negative">Couldn’t load this account: {detail.error?.message}</ThemedText>
      </Screen>
    );
  }

  const { liability, holdings } = detail.data;
  const owed = isLiabilityType(account.type);

  return (
    <Screen title={account.name} actions={back}>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {[account.institutionName, account.subtype, account.mask && `••${account.mask}`].filter(Boolean).join(' · ')}
        </ThemedText>
        <ThemedText type="title">{formatCurrency(account.currentBalance, account.currency)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {owed ? 'Balance owed' : 'Current balance'}
          {account.availableBalance !== null && !owed
            ? ` · ${formatCurrency(account.availableBalance, account.currency)} available`
            : ''}
          {account.creditLimit !== null ? ` · ${formatCurrency(account.creditLimit, account.currency)} limit` : ''}
        </ThemedText>
        {account.ownershipPercent !== null && (
          <ThemedText type="small" themeColor="textSecondary">
            Your {account.ownershipPercent}% share: {formatCurrency(ownedBalance(account), account.currency)}
          </ThemedText>
        )}
        {account.hidden && (
          <ThemedText type="small" themeColor="warning">
            Hidden: not counted in net worth, cash flow or budgets.
          </ThemedText>
        )}
      </Card>

      {liability && <LiabilityCard liability={liability} balance={account.currentBalance} />}

      {account.type === 'investment' && (
        <Card title="Holdings">
          <HoldingsList holdings={holdings} />
        </Card>
      )}

      {!account.hidden && <OwnershipCard key={account.ownershipPercent ?? 100} account={account} />}

      {!account.hidden && !owed && (
        <Card title="On death" subtitle="Who inherits this account: a beneficiary, TOD/POD, joint owner or your trust.">
          <Link href={{ pathname: '/estate/account/[id]', params: { id: account.id } }}>
            <ThemedText type="linkPrimary">Set up beneficiaries →</ThemedText>
          </Link>
        </Card>
      )}

      <Card>
        <View style={styles.actions}>
          <Link href={{ pathname: '/spending', params: { tab: 'transactions', accountId: account.id } }}>
            <ThemedText type="linkPrimary">View transactions →</ThemedText>
          </Link>
          <Button
            label={account.hidden ? 'Show in totals' : 'Hide from totals'}
            variant="secondary"
            size="small"
            loading={update.isPending}
            onPress={() => update.mutate({ id: account.id, hidden: !account.hidden })}
          />
        </View>
        {update.isError && <ThemedText themeColor="negative">{update.error.message}</ThemedText>}
      </Card>
    </Screen>
  );
}

/** Your share of a jointly held account; scales its balance and transactions in every total. */
function OwnershipCard({ account }: { account: Account }) {
  const theme = useTheme();
  const update = useUpdateAccount();
  const [share, setShare] = useState(String(account.ownershipPercent ?? 100));
  const percent = Number(share.replace(/[%\s]/g, ''));
  const valid = share.trim() !== '' && Number.isFinite(percent) && percent > 0 && percent <= 100;
  const next = percent === 100 ? null : percent;
  const changed = valid && next !== account.ownershipPercent;

  const save = () => changed && update.mutate({ id: account.id, ownershipPercent: next });

  return (
    <Card title="Ownership">
      <ThemedText type="small" themeColor="textSecondary">
        For a joint account, enter your share. Net worth, cash flow, spending and budgets count only that part of the
        balance and transactions.
      </ThemedText>
      <View style={styles.actions}>
        <TextInput
          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          value={share}
          onChangeText={setShare}
          keyboardType="decimal-pad"
          inputMode="decimal"
          onSubmitEditing={save}
          accessibilityLabel="Your ownership percent"
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          %
        </ThemedText>
        <Button label="Save" size="small" disabled={!changed} loading={update.isPending} onPress={save} />
      </View>
      {!valid && (
        <ThemedText type="small" themeColor="negative">
          Ownership must be between 0 and 100%.
        </ThemedText>
      )}
      {update.isError && <ThemedText themeColor="negative">{update.error.message}</ThemedText>}
    </Card>
  );
}

function LiabilityCard({ liability: l, balance }: { liability: LiabilityDetails; balance: number | null }) {
  const payoff = estimatePayoff(balance, l.interestRatePct, l.minimumPayment);
  const rows: [string, string | null][] = [
    ['Interest rate', l.interestRatePct !== null ? `${l.interestRatePct}% APR` : null],
    [l.kind === 'credit' ? 'Minimum payment' : 'Monthly payment', l.minimumPayment !== null ? formatCurrency(l.minimumPayment) : null],
    ['Next payment due', l.nextPaymentDueDate ? formatDate(l.nextPaymentDueDate) : null],
    ['Original amount', l.originationPrincipal !== null ? formatCurrency(l.originationPrincipal) : null],
    ['Opened', l.originationDate ? formatDate(l.originationDate) : null],
    ['Scheduled payoff', l.maturityDate ? formatDate(l.maturityDate) : null],
    ['Escrow balance', l.escrowBalance !== null ? formatCurrency(l.escrowBalance) : null],
  ];

  return (
    <Card title={KIND_LABELS[l.kind]}>
      {rows
        .filter(([, v]) => v !== null)
        .map(([label, value]) => (
          <View key={label} style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary">
              {label}
            </ThemedText>
            <ThemedText type="small">{value}</ThemedText>
          </View>
        ))}
      {balance && balance > 0 && l.minimumPayment ? (
        <View style={styles.estimate}>
          <ThemedText type="smallBold">Payoff estimate</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {payoff
              ? `Paying ${formatCurrency(l.minimumPayment)} a month pays this off in about ${formatDuration(payoff.months)} (${payoffDate(payoff.months)}), with roughly ${formatCurrency(payoff.totalInterest)} in interest.`
              : `${formatCurrency(l.minimumPayment)} a month doesn’t cover the interest, so the balance won’t go down at this payment.`}
            {l.kind === 'mortgage' ? ' The payment likely includes escrow, so the real payoff is a bit later.' : ''}
          </ThemedText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  estimate: { gap: Spacing.one, marginTop: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  input: { width: 80, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  grow: { flex: 1 },
});
