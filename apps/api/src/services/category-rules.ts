import type { CategoryRule, CategoryRuleCreate, CategoryRuleResult } from '@meld/shared';
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { categoryRules, transactions } from '../db/schema';
import { chunk } from '../db/upsert';
import { escapeLike } from './transactions';

type Rule = Pick<typeof categoryRules.$inferSelect, 'id' | 'pattern' | 'category' | 'subcategory' | 'updatedAt'>;

/** The most specific rule matching a transaction: longest pattern first, then the most recently changed. */
export function matchRule<R extends Rule>(rules: R[], t: { name: string; merchantName: string | null }): R | undefined {
  const text = `${t.merchantName ?? ''}\n${t.name}`.toLowerCase();
  let best: R | undefined;
  for (const r of rules) {
    if (!text.includes(r.pattern.toLowerCase())) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.updatedAt > best.updatedAt)
    ) {
      best = r;
    }
  }
  return best;
}

/** What a transaction gets when a rule categorizes it: a rule's category counts as verified. */
const byRule = (r: Pick<Rule, 'id' | 'category' | 'subcategory'>) => ({
  category: r.category,
  subcategory: r.subcategory,
  categoryRuleId: r.id,
  categoryVerified: true,
});

/** Back to the original category, for review again. */
const released = { category: null, subcategory: null, categoryRuleId: null, categoryVerified: false };

/** Fills in the category of new rows that matched a rule; rows already categorized or verified are left alone. */
export function categorizeNewRows<T extends typeof transactions.$inferInsert>(rules: Rule[], rows: T[]): T[] {
  if (!rules.length) return rows;
  return rows.map((row) => {
    if (row.category || row.categoryVerified) return row;
    const rule = matchRule(rules, { name: row.name, merchantName: row.merchantName ?? null });
    return rule ? { ...row, ...byRule(rule) } : row;
  });
}

export async function loadRules(db: Pick<Db, 'select'>): Promise<Rule[]> {
  return db
    .select({
      id: categoryRules.id,
      pattern: categoryRules.pattern,
      category: categoryRules.category,
      subcategory: categoryRules.subcategory,
      updatedAt: categoryRules.updatedAt,
    })
    .from(categoryRules);
}

export async function listRules(db: Db): Promise<CategoryRule[]> {
  return db
    .select({
      id: categoryRules.id,
      pattern: categoryRules.pattern,
      category: categoryRules.category,
      subcategory: categoryRules.subcategory,
      transactionCount: count(transactions.id),
    })
    .from(categoryRules)
    .leftJoin(transactions, eq(transactions.categoryRuleId, categoryRules.id))
    .groupBy(categoryRules.id)
    .orderBy(asc(sql`lower(${categoryRules.pattern})`));
}

type RuleFields = Omit<z.output<typeof CategoryRuleCreate>, 'applyToExisting'>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Creates a rule, or updates the one with the same pattern (ignoring case). Transactions the rule
 * already categorized follow the change; with `applyToExisting`, other matches that weren't
 * categorized by hand are recategorized too, unless a more specific rule claims them.
 */
export async function saveRule(db: Db, input: z.output<typeof CategoryRuleCreate>): Promise<CategoryRuleResult> {
  const { applyToExisting, ...fields } = input;
  const values = { ...fields, subcategory: fields.subcategory ?? null };

  const { id, updated } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: categoryRules.id })
      .from(categoryRules)
      .where(eq(sql`lower(${categoryRules.pattern})`, values.pattern.toLowerCase()));
    const [saved] = existing
      ? await tx.update(categoryRules).set(values).where(eq(categoryRules.id, existing.id)).returning({ id: categoryRules.id })
      : await tx.insert(categoryRules).values(values).returning({ id: categoryRules.id });
    return { id: saved!.id, updated: await applyRule(tx, saved!.id, values, applyToExisting) };
  });

  const rule = (await listRules(db)).find((r) => r.id === id)!;
  return { rule, updated };
}

/**
 * Edits a rule. Transactions it categorized that no longer match the new pattern go back to their
 * original category, unverified (or to another rule that matches them); the rest follow the change, and
 * `applyToExisting` picks up other matches as in `saveRule`.
 */
export async function updateRule(
  db: Db,
  id: string,
  input: z.output<typeof CategoryRuleCreate>,
): Promise<CategoryRuleResult | 'not-found' | 'conflict'> {
  const { applyToExisting, ...fields } = input;
  const values = { ...fields, subcategory: fields.subcategory ?? null };

  const result = await db.transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: categoryRules.id })
      .from(categoryRules)
      .where(and(eq(sql`lower(${categoryRules.pattern})`, values.pattern.toLowerCase()), ne(categoryRules.id, id)));
    if (clash) return 'conflict' as const;
    const [saved] = await tx.update(categoryRules).set(values).where(eq(categoryRules.id, id)).returning();
    if (!saved) return 'not-found' as const;

    const owned = await tx
      .select({ id: transactions.id, name: transactions.name, merchantName: transactions.merchantName })
      .from(transactions)
      .where(eq(transactions.categoryRuleId, id));
    const unmatched = owned.filter((t) => !matchRule([saved], t));
    if (unmatched.length) {
      const others = (await loadRules(tx)).filter((r) => r.id !== id);
      for (const t of unmatched) {
        const other = matchRule(others, t);
        await tx
          .update(transactions)
          .set(other ? byRule(other) : released)
          .where(eq(transactions.id, t.id));
      }
    }
    return applyRule(tx, id, values, applyToExisting);
  });
  if (typeof result === 'string') return result;

  const rule = (await listRules(db)).find((r) => r.id === id)!;
  return { rule, updated: result };
}

/** Brings the rule's transactions (and, with `applyToExisting`, its other matches) in line with it; returns how many. */
async function applyRule(tx: Tx, ruleId: string, values: RuleFields & { subcategory: string | null }, applyToExisting: boolean) {
  const assign = byRule({ id: ruleId, ...values });

  const followed = await tx
    .update(transactions)
    .set(assign)
    .where(eq(transactions.categoryRuleId, ruleId))
    .returning({ id: transactions.id });
  if (!applyToExisting) return followed.length;

  const like = `%${escapeLike(values.pattern)}%`;
  const candidates = await tx
    .select({ id: transactions.id, name: transactions.name, merchantName: transactions.merchantName })
    .from(transactions)
    .where(
      and(
        // Another rule's transactions are fair game; otherwise only ones never categorized or verified by hand.
        or(isNotNull(transactions.categoryRuleId), and(isNull(transactions.category), eq(transactions.categoryVerified, false))),
        or(ilike(transactions.name, like), ilike(transactions.merchantName, like)),
      ),
    );
  const rules = await loadRules(tx);
  const ids = candidates.filter((c) => matchRule(rules, c)?.id === ruleId).map((c) => c.id);
  for (const batch of chunk(ids, 1000)) {
    await tx.update(transactions).set(assign).where(inArray(transactions.id, batch));
  }
  return new Set([...followed.map((r) => r.id), ...ids]).size;
}

/** Deletes a rule; the transactions it categorized go back to their original category, unverified. */
export async function deleteRule(db: Db, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.update(transactions).set(released).where(eq(transactions.categoryRuleId, id));
    const [row] = await tx.delete(categoryRules).where(eq(categoryRules.id, id)).returning({ id: categoryRules.id });
    return !!row;
  });
}
