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
  pending: z.boolean(),
  notes: z.string().nullable(),
});
export type Transaction = z.infer<typeof Transaction>;

export const TransactionQuery = z.object({
  accountId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  category: z.string().optional(),
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
  notes: z.string().nullable().optional(),
});
export type TransactionUpdate = z.infer<typeof TransactionUpdate>;
