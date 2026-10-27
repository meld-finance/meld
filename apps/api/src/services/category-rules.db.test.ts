import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, transactions } from '../db/schema';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { categorizeNewRows, deleteRule, listRules, matchRule, saveRule, updateRule } from './category-rules';

const rule = (pattern: string, category: string, updatedAt = new Date(0)) => ({
  id: pattern,
  pattern,
  category,
  subcategory: null,
  updatedAt,
});

describe('matchRule', () => {
  const rules = [rule('costco', 'GROCERIES'), rule('costco gas', 'GAS'), rule('venmo', 'GIFTS')];

  it('matches merchant or description, ignoring case, preferring the longest pattern', () => {
    expect(matchRule(rules, { name: 'COSTCO WHSE #123', merchantName: null })?.id).toBe('costco');
    expect(matchRule(rules, { name: 'COSTCO GAS #123', merchantName: 'Costco' })?.id).toBe('costco gas');
    expect(matchRule(rules, { name: 'VENMO PAYMENT 1234', merchantName: null })?.id).toBe('venmo');
    expect(matchRule(rules, { name: 'Safeway', merchantName: 'Safeway' })).toBeUndefined();
  });

  it('breaks ties with the most recently changed rule', () => {
    const tied = [rule('uber', 'TRAVEL', new Date(1)), { ...rule('UBER', 'FOOD'), id: 'newer', updatedAt: new Date(2) }];
    expect(matchRule(tied, { name: 'Uber', merchantName: null })?.id).toBe('newer');
  });

  it('categorizes only new rows that have no category yet', () => {
    const rows: (typeof transactions.$inferInsert)[] = [
      { accountId: 'a', amount: 1, date: '2026-10-01', name: 'COSTCO WHSE', merchantName: null },
      { accountId: 'a', amount: 1, date: '2026-10-01', name: 'COSTCO WHSE', category: 'KEEP' },
      { accountId: 'a', amount: 1, date: '2026-10-01', name: 'Safeway' },
      { accountId: 'a', amount: 1, date: '2026-10-01', name: 'COSTCO WHSE', categoryVerified: true },
    ];
    expect(categorizeNewRows(rules, rows).map((r) => [r.category, r.categoryRuleId])).toEqual([
      ['GROCERIES', 'costco'],
      ['KEEP', undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe.skipIf(!testDatabaseUrl)('category rules (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterAll(async () => {
    await ctx?.sql.end();
  });

  const categories = async () =>
    Object.fromEntries(
      (
        await ctx.db
          .select({ name: transactions.name, category: transactions.category, subcategory: transactions.subcategory })
          .from(transactions)
      ).map((t) => [t.name, [t.category, t.subcategory]]),
    );

  beforeEach(async () => {
    await ctx.reset();
    const [card] = await ctx.db
      .insert(accounts)
      .values({ source: 'manual', name: 'Card', type: 'credit' })
      .returning({ id: accounts.id });
    const t = (name: string, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
      accountId: card!.id,
      date: '2026-10-01',
      amount: 50,
      name,
      plaidCategoryPrimary: 'GENERAL_MERCHANDISE',
      ...extra,
    });
    await ctx.db.insert(transactions).values([
      t('COSTCO WHSE #1'),
      t('COSTCO GAS #1'),
      t('Something', { merchantName: 'Costco' }),
      t('COSTCO WHSE #2', { category: 'HOUSEHOLD' }), // categorized by hand
      t('Safeway'),
      t('COSTCO WHSE #3', { categoryVerified: true }), // Plaid's category accepted as is
    ]);
  });

  it('applies to future transactions only unless asked to update existing ones', async () => {
    const { updated } = await saveRule(ctx.db, { pattern: 'Costco', category: 'FOOD_AND_DRINK', applyToExisting: false });
    expect(updated).toBe(0);
    expect((await categories())['COSTCO WHSE #1']).toEqual([null, null]);
  });

  it('updates existing matches, leaving hand edits and more specific rules alone', async () => {
    await saveRule(ctx.db, { pattern: 'costco gas', category: 'TRANSPORTATION', applyToExisting: true });
    const { rule, updated } = await saveRule(ctx.db, {
      pattern: 'Costco',
      category: 'FOOD_AND_DRINK',
      subcategory: 'FOOD_AND_DRINK_GROCERIES',
      applyToExisting: true,
    });
    expect(updated).toBe(2);
    expect(rule).toMatchObject({ pattern: 'Costco', transactionCount: 2 });
    expect(await categories()).toEqual({
      'COSTCO WHSE #1': ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
      'COSTCO GAS #1': ['TRANSPORTATION', null],
      Something: ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
      'COSTCO WHSE #2': ['HOUSEHOLD', null],
      Safeway: [null, null],
      'COSTCO WHSE #3': [null, null],
    });
  });

  it('updates the rule with the same pattern, and its transactions follow', async () => {
    await saveRule(ctx.db, { pattern: 'costco', category: 'FOOD_AND_DRINK', applyToExisting: true });
    const { updated } = await saveRule(ctx.db, { pattern: 'COSTCO', category: 'SHOPPING', applyToExisting: false });
    expect(updated).toBe(3);
    expect(await listRules(ctx.db)).toMatchObject([{ pattern: 'COSTCO', category: 'SHOPPING', transactionCount: 3 }]);
    expect((await categories())['COSTCO GAS #1']).toEqual(['SHOPPING', null]);
  });

  it('puts transactions back to their original category when the rule is deleted', async () => {
    const { rule } = await saveRule(ctx.db, { pattern: 'costco', category: 'FOOD_AND_DRINK', applyToExisting: true });
    expect(await deleteRule(ctx.db, rule.id)).toBe(true);
    expect(await listRules(ctx.db)).toEqual([]);
    expect((await categories())['COSTCO WHSE #1']).toEqual([null, null]);
    expect((await categories())['COSTCO WHSE #2']).toEqual(['HOUSEHOLD', null]);
    const [hand] = await ctx.db.select().from(transactions).where(eq(transactions.name, 'COSTCO WHSE #2'));
    expect(hand?.categoryRuleId).toBeNull();
  });

  it('edits a rule, releasing transactions the new pattern no longer matches', async () => {
    await saveRule(ctx.db, { pattern: 'whse', category: 'SHOPPING', applyToExisting: false });
    const { rule } = await saveRule(ctx.db, { pattern: 'costco', category: 'FOOD_AND_DRINK', applyToExisting: true });
    expect(rule.transactionCount).toBe(3);

    const result = await updateRule(ctx.db, rule.id, {
      pattern: 'costco gas',
      category: 'TRANSPORTATION',
      subcategory: 'TRANSPORTATION_GAS',
      applyToExisting: false,
    });
    expect(result).toMatchObject({ rule: { pattern: 'costco gas', transactionCount: 1 }, updated: 1 });
    expect(await categories()).toMatchObject({
      'COSTCO GAS #1': ['TRANSPORTATION', 'TRANSPORTATION_GAS'],
      'COSTCO WHSE #1': ['SHOPPING', null], // picked up by the other rule that still matches
      Something: [null, null],
      'COSTCO WHSE #2': ['HOUSEHOLD', null],
    });
  });

  it('refuses to edit a rule into another rule\'s pattern', async () => {
    await saveRule(ctx.db, { pattern: 'costco', category: 'FOOD_AND_DRINK', applyToExisting: false });
    const { rule } = await saveRule(ctx.db, { pattern: 'safeway', category: 'FOOD_AND_DRINK', applyToExisting: false });
    expect(await updateRule(ctx.db, rule.id, { pattern: 'COSTCO', category: 'SHOPPING', applyToExisting: false })).toBe(
      'conflict',
    );
    expect(
      await updateRule(ctx.db, '00000000-0000-0000-0000-000000000000', {
        pattern: 'x y',
        category: 'SHOPPING',
        applyToExisting: false,
      }),
    ).toBe('not-found');
  });
});
