import { z } from 'zod';

export const Transaction = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  /** Plaid convention: positive = money out, negative = money in. */
  amount: z.number(),
  currency: z.string(),
  date: z.string(),
  name: z.string(),
  merchantName: z.string().nullable(),
  /** User override when set, otherwise Plaid's primary category. */
  category: z.string().nullable(),
  categoryOverridden: z.boolean(),
  /** User override when set, otherwise Plaid's detailed category while the category is Plaid's. */
  subcategory: z.string().nullable(),
  /** Set when a categorization rule chose the category. */
  categoryRuleId: z.string().uuid().nullable(),
  /** The user has confirmed the category, by setting it by hand or accepting it as is. */
  categoryVerified: z.boolean(),
  pending: z.boolean(),
  notes: z.string().nullable(),
});
export type Transaction = z.infer<typeof Transaction>;

export const TransactionQuery = z.object({
  accountId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  /** Only transactions that count toward cash flow (cash and card accounts, no transfers or card payments). */
  cashflow: z.stringbool().optional(),
  /** Only transactions whose category the user has (true) or hasn't (false) confirmed. */
  verified: z.stringbool().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TransactionQuery = z.input<typeof TransactionQuery>;

export const TransactionPage = z.object({
  transactions: z.array(Transaction),
  total: z.number().int(),
});
export type TransactionPage = z.infer<typeof TransactionPage>;

export const TransactionUpdate = z.object({
  /** null clears the override and falls back to Plaid's category. */
  category: z.string().trim().min(1).nullable().optional(),
  subcategory: z.string().trim().min(1).nullable().optional(),
  /** true accepts the current category as correct; setting a category verifies it too. */
  categoryVerified: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type TransactionUpdate = z.infer<typeof TransactionUpdate>;

/** The uncategorized bucket in totals; transactions themselves report a null category. */
export const UNCATEGORIZED = 'UNCATEGORIZED';

export const CategoryRuleInput = z.object({
  /** Matched case-insensitively anywhere in the merchant name or description. */
  pattern: z.string().trim().min(2),
  category: z.string().trim().min(1),
  subcategory: z.string().trim().min(1).nullable().optional(),
});
export type CategoryRuleInput = z.infer<typeof CategoryRuleInput>;

export const CategoryRule = CategoryRuleInput.extend({
  id: z.string().uuid(),
  subcategory: z.string().nullable(),
  /** Transactions this rule has categorized. */
  transactionCount: z.number().int(),
});
export type CategoryRule = z.infer<typeof CategoryRule>;

export const CategoryRuleCreate = CategoryRuleInput.extend({
  /** Also recategorize existing matches that weren't categorized by hand. */
  applyToExisting: z.boolean().default(false),
});
export type CategoryRuleCreate = z.input<typeof CategoryRuleCreate>;

export const CategoryRuleResult = z.object({ rule: CategoryRule, updated: z.number().int() });
export type CategoryRuleResult = z.infer<typeof CategoryRuleResult>;
