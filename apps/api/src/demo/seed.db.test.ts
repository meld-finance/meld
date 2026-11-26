import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plaidItems } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { listAlerts } from '../services/alerts';
import { getCashPlan } from '../services/cash';
import { getBudgetStatus } from '../services/overview';
import { getRecurringSummary } from '../services/recurring';
import { getTaxPlan } from '../services/tax';
import { ensureDemoData, seedDemo } from './seed';

// Late in the month, early in the month, and across a year end: the story holds whatever the date.
describe.skipIf(!testDatabaseUrl)('demo data (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx.reset();
    await ctx?.sql.end();
  });

  it.each(['2026-11-25', '2026-03-02', '2027-01-01'])('gives the tour something to show on %s', async (today) => {
    await ctx.reset();
    await seedDemo(ctx.db, { today });
    const db = ctx.db;

    const { alerts } = await listAlerts(db);
    expect(alerts.find((a) => a.type === 'autopay_short')?.severity).toBe('critical');
    expect(alerts.map((a) => a.type)).toEqual(expect.arrayContaining(['price_increase', 'new_recurring', 'estate']));

    const recurring = await getRecurringSummary(db, today);
    const byName = new Map(recurring.series.map((s) => [s.name, s]));
    expect(byName.get('Netflix')?.priceChange).toMatchObject({ from: 15.49, to: 17.99 });
    expect(byName.get('Disney+')?.status).toBe('stopped');
    // Only the bills, subscriptions and income meant to repeat; no lunch spot that lined up by chance.
    expect([...byName.keys()].sort()).toEqual(
      [
        'Acme Corp',
        'Apple',
        'Bright Steps Preschool',
        'City Water Utility',
        'Comcast',
        'Disney+',
        'GEICO',
        'Headspace',
        'Interest Payment',
        'Keystone Home Loans',
        'Lifeline Mutual',
        'Netflix',
        'PG&E',
        'Peak Fitness',
        'Spotify',
        'Summit Bank',
        'Verizon',
      ].sort(),
    );

    const tax = await getTaxPlan(db, Number(today.slice(0, 4)), today);
    expect(tax.suggestions.map((s) => s.id)).toEqual(expect.arrayContaining(['harvest-losses']));

    const cash = await getCashPlan(db, undefined, today);
    expect(cash.suggestions.some((n) => n.id.startsWith('low-yield:'))).toBe(true);

    const budgets = await getBudgetStatus(db, today.slice(0, 7));
    expect(budgets.map((b) => b.category)).toContain('FOOD_AND_DRINK');
  });

  it('rebuilds stale demo data but leaves fresh data alone', async () => {
    await ctx.reset();
    expect(await ensureDemoData(ctx.db, { today: '2026-11-20' })).toBe(true);
    expect(await ensureDemoData(ctx.db, { today: '2026-11-21' })).toBe(false);
    expect(await ensureDemoData(ctx.db, { today: '2026-11-28' })).toBe(true);
  });

  it('refuses to replace real linked banks', async () => {
    await ctx.reset();
    await ctx.db.insert(plaidItems).values({ plaidItemId: 'item-real', accessTokenEnc: 'x' });
    await expect(seedDemo(ctx.db, { today: '2026-11-25' })).rejects.toThrow(/real linked banks/);
  });
});
