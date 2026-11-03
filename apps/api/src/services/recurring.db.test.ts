import { DEFAULT_ALERT_SETTINGS } from '@meld/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, alerts, liabilities, plaidItems, transactions } from '../db/schema';
import { addMonths } from '../lib/recurring';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { saveAlertSettings } from './alert-settings';
import { dismissAlert, evaluateAlerts, listAlerts, type AlertCandidate } from './alerts';
import { createAutopayLink, getRecurringSummary, saveRecurringOverride } from './recurring';

const TODAY = '2026-11-02';

describe.skipIf(!testDatabaseUrl)('recurring, autopay and alerts (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let ids: Record<'checking' | 'card', string>;
  let pushed: AlertCandidate[];
  const notify = async (a: AlertCandidate) => void pushed.push(a);

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  beforeEach(async () => {
    await ctx.reset();
    pushed = [];
    const db = ctx.db;
    const [checking, card] = await db
      .insert(accounts)
      .values([
        { source: 'manual', name: 'Checking', type: 'depository', subtype: 'checking', currentBalance: 2_000, availableBalance: 1_900 },
        { source: 'manual', name: 'Sapphire', type: 'credit', currentBalance: 2_400 },
      ])
      .returning({ id: accounts.id });
    ids = { checking: checking!.id, card: card!.id };
    await db.insert(liabilities).values({
      accountId: card!.id,
      kind: 'credit',
      minimumPayment: 40,
      nextPaymentDueDate: '2026-11-18',
      details: { last_statement_balance: 1_850, last_statement_issue_date: '2026-10-22' },
    });

    const months = (from: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(from, i));
    await db.insert(transactions).values([
      // A streaming subscription on the card, and internet billed to checking before the card is due.
      // Netflix's price went up with the last charge.
      ...months('2026-04-28', 7).map((date, i) => ({ accountId: card!.id, date, name: 'NETFLIX.COM', merchantName: 'Netflix', amount: i < 6 ? 15.49 : 17.99, plaidCategoryPrimary: 'ENTERTAINMENT' })),
      ...months('2026-05-10', 6).map((date) => ({ accountId: checking!.id, date, name: 'COMCAST', amount: 90, plaidCategoryPrimary: 'RENT_AND_UTILITIES' })),
      // Checking paid the card's statement each month.
      ...months('2026-08-17', 3).flatMap((date, i) => [
        { accountId: checking!.id, date, name: 'CHASE CREDIT CRD AUTOPAY', amount: 1_500 + i * 100, plaidCategoryPrimary: 'LOAN_PAYMENTS', plaidCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
        { accountId: card!.id, date, name: 'AUTOMATIC PAYMENT - THANK YOU', amount: -(1_500 + i * 100), plaidCategoryPrimary: 'LOAN_PAYMENTS', plaidCategoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
      ]),
    ]);
  });

  it('finds series, suggests the autopay, and leaves card payments out of the series', async () => {
    const s = await getRecurringSummary(ctx.db, TODAY);
    expect(s.series.map((x) => [x.name, x.kind])).toEqual([
      ['Comcast', 'bill'],
      ['Netflix', 'subscription'],
    ]);
    expect(s.suggestions).toEqual([
      expect.objectContaining({ payeeAccountId: ids.card, fundingAccountId: ids.checking, payments: 3, likelyRule: 'statement_balance' }),
    ]);
    expect(s.upcoming.map((u) => [u.date, u.name])).toEqual([
      ['2026-11-10', 'Comcast'],
      ['2026-11-28', 'Netflix'],
    ]);
  });

  it('works out whether checking covers the card, counting the bill due first', async () => {
    await createAutopayLink(ctx.db, { payeeAccountId: ids.card, fundingAccountId: ids.checking, amountRule: 'statement_balance', fixedAmount: null });
    const s = await getRecurringSummary(ctx.db, TODAY);
    expect(s.suggestions).toEqual([]);
    expect(s.autopay[0]).toMatchObject({
      dueDate: '2026-11-18',
      amount: 1_850,
      amountSource: 'statement',
      fundingBalance: 1_900,
      projectedAfter: -40,
      health: 'short',
      before: [{ name: 'Comcast', date: '2026-11-10', amount: 90, source: 'recurring' }],
    });
    expect(s.upcoming.find((u) => u.source === 'autopay')).toMatchObject({ name: 'Sapphire autopay', amount: 1_850, kind: 'autopay' });
    expect(s.totals.dueNext30).toBe(1_957.99);
  });

  it('opens an alert, pushes it once, updates it, and resolves it when the money arrives', async () => {
    await saveAlertSettings(ctx.db, { ...DEFAULT_ALERT_SETTINGS, ntfyUrl: 'https://ntfy.example/meld' });
    await createAutopayLink(ctx.db, { payeeAccountId: ids.card, fundingAccountId: ids.checking, amountRule: 'statement_balance', fixedAmount: null });

    // A gym membership that started this summer is new; Netflix and Comcast have been around too long to be news.
    await ctx.db.insert(transactions).values(
      ['2026-08-20', '2026-09-20', '2026-10-20'].map((date) => ({ accountId: ids.card, date, name: 'EQUINOX', amount: 260, plaidCategoryPrimary: 'PERSONAL_CARE' })),
    );

    expect(await evaluateAlerts(ctx.db, notify, TODAY)).toEqual({ opened: 3, resolved: 0 });
    let list = await listAlerts(ctx.db);
    expect(list.alerts.map((a) => [a.type, a.severity]).sort()).toEqual([
      ['autopay_short', 'critical'],
      ['new_recurring', 'info'],
      ['price_increase', 'warning'],
    ]);
    expect(list.alerts.find((a) => a.type === 'price_increase')!.title).toBe('Netflix went up to $17.99');
    // Info alerts stay in the app; warnings and worse are pushed.
    expect(pushed.map((p) => p.type).sort()).toEqual(['autopay_short', 'price_increase']);

    // Run again: nothing new, nothing pushed twice.
    expect(await evaluateAlerts(ctx.db, notify, TODAY)).toEqual({ opened: 0, resolved: 0 });
    expect(pushed).toHaveLength(2);

    // Less money: the alert's text updates in place.
    await ctx.db.update(accounts).set({ availableBalance: 1_500 }).where(eq(accounts.id, ids.checking));
    await evaluateAlerts(ctx.db, notify, TODAY);
    list = await listAlerts(ctx.db);
    expect(list.alerts.filter((a) => a.type === 'autopay_short')).toHaveLength(1);
    expect(list.alerts.find((a) => a.type === 'autopay_short')!.body).toContain('$440 short');

    // Topped up: resolved, and a later shortfall would open a new one.
    await ctx.db.update(accounts).set({ availableBalance: 5_000 }).where(eq(accounts.id, ids.checking));
    expect(await evaluateAlerts(ctx.db, notify, TODAY)).toEqual({ opened: 0, resolved: 1 });
    list = await listAlerts(ctx.db);
    expect(list.alerts.find((a) => a.type === 'autopay_short')!.resolvedAt).not.toBeNull();
  });

  it('brings back a dismissed alert only when it gets worse', async () => {
    await saveAlertSettings(ctx.db, { ...DEFAULT_ALERT_SETTINGS, autopayCushion: 200, newRecurring: false, priceIncrease: false });
    await ctx.db.update(accounts).set({ availableBalance: 2_000 }).where(eq(accounts.id, ids.checking));
    await createAutopayLink(ctx.db, { payeeAccountId: ids.card, fundingAccountId: ids.checking, amountRule: 'statement_balance', fixedAmount: null });

    await evaluateAlerts(ctx.db, notify, TODAY);
    const [tight] = (await listAlerts(ctx.db)).alerts;
    expect(tight).toMatchObject({ type: 'autopay_short', severity: 'warning' });
    await dismissAlert(ctx.db, tight!.id, true);

    await evaluateAlerts(ctx.db, notify, TODAY);
    expect((await listAlerts(ctx.db)).unread).toBe(0);

    await ctx.db.update(accounts).set({ availableBalance: 1_000 }).where(eq(accounts.id, ids.checking));
    await evaluateAlerts(ctx.db, notify, TODAY);
    const list = await listAlerts(ctx.db);
    expect(list.unread).toBe(1);
    expect(list.alerts[0]).toMatchObject({ id: tight!.id, severity: 'critical', dismissedAt: null });
  });

  it('alerts on low balances, large charges and bank connections, and respects ignored series', async () => {
    const [item] = await ctx.db
      .insert(plaidItems)
      .values({ plaidItemId: 'item-1', accessTokenEnc: 'x', status: 'login_required' })
      .returning({ id: plaidItems.id });
    await ctx.db.insert(transactions).values({ accountId: ids.card, date: '2026-11-01', name: 'BEST BUY', amount: 1_299, plaidCategoryPrimary: 'GENERAL_MERCHANDISE' });
    const netflix = (await getRecurringSummary(ctx.db, TODAY)).series.find((s) => s.name === 'Netflix')!;
    await saveRecurringOverride(ctx.db, netflix.key, { ignored: true });
    await saveAlertSettings(ctx.db, { ...DEFAULT_ALERT_SETTINGS, lowBalance: { [ids.checking]: 2_500 }, largeTransaction: 1_000 });

    await evaluateAlerts(ctx.db, notify, TODAY);
    const types = (await listAlerts(ctx.db)).alerts.map((a) => a.type).sort();
    // Netflix's price went up last month, but it's ignored, so no price alert.
    expect(types).toEqual(['connection', 'large_transaction', 'low_balance']);
    expect((await ctx.db.select().from(alerts).where(eq(alerts.key, `connection:${item!.id}`)))[0]!.title).toBe('Reconnect A bank');
  });
});
