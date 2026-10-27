import type { CategoryRule, CategoryRuleCreate, CategoryRuleResult } from '@meld/shared';
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
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

/** Fills in the category of new rows that matched a rule; rows that already carry a category are left alone. */
export function categorizeNewRows<T extends typeof transactions.$inferInsert>(rules: Rule[], rows: T[]): T[] {
  if (!rules.length) return rows;
  return rows.map((row) => {
    if (row.category) return row;
    const rule = matchRule(rules, { name: row.name, merchantName: row.merchantName ?? null });
    return rule ? { ...row, category: rule.category, subcategory: rule.subcategory, categoryRuleId: rule.id } : row;
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
    const ruleId = saved!.id;
    const assign = { category: values.category, subcategory: values.subcategory, categoryRuleId: ruleId };

    const followed = await tx
      .update(transactions)
      .set(assign)
      .where(eq(transactions.categoryRuleId, ruleId))
      .returning({ id: transactions.id });
    if (!applyToExisting) return { id: ruleId, updated: followed.length };

    const like = `%${escapeLike(values.pattern)}%`;
    const candidates = await tx
      .select({ id: transactions.id, name: transactions.name, merchantName: transactions.merchantName })
      .from(transactions)
      .where(
        and(
          or(isNull(transactions.category), isNotNull(transactions.categoryRuleId)),
          or(ilike(transactions.name, like), ilike(transactions.merchantName, like)),
        ),
      );
    const rules = await loadRules(tx);
    const ids = candidates.filter((c) => matchRule(rules, c)?.id === ruleId).map((c) => c.id);
    for (const batch of chunk(ids, 1000)) {
      await tx.update(transactions).set(assign).where(inArray(transactions.id, batch));
    }
    return { id: ruleId, updated: new Set([...followed.map((r) => r.id), ...ids]).size };
  });

  const rule = (await listRules(db)).find((r) => r.id === id)!;
  return { rule, updated };
}

/** Deletes a rule; the transactions it categorized go back to their original category. */
export async function deleteRule(db: Db, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ category: null, subcategory: null, categoryRuleId: null })
      .where(eq(transactions.categoryRuleId, id));
    const [row] = await tx.delete(categoryRules).where(eq(categoryRules.id, id)).returning({ id: categoryRules.id });
    return !!row;
  });
}
