import { z } from 'zod';
import { AccountType } from './accounts';

/** "2026-10" */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export type Month = z.infer<typeof Month>;

export const NetWorthSummary = z.object({
  assets: z.number(),
  liabilities: z.number(),
  netWorth: z.number(),
  /** Balance totals per account type; manual assets appear as 'manual'. */
  byType: z.array(z.object({ type: z.union([AccountType, z.literal('manual')]), total: z.number() })),
});
export type NetWorthSummary = z.infer<typeof NetWorthSummary>;

export const NetWorthPoint = z.object({
  date: z.string(),
  assets: z.number(),
  liabilities: z.number(),
  netWorth: z.number(),
});
export type NetWorthPoint = z.infer<typeof NetWorthPoint>;

export const CashflowMonth = z.object({
  month: Month,
  income: z.number(),
  /** Net of refunds; excludes transfers and credit card payments. */
  spending: z.number(),
});
export type CashflowMonth = z.infer<typeof CashflowMonth>;

export const CategorySpend = z.object({ category: z.string(), amount: z.number() });
export type CategorySpend = z.infer<typeof CategorySpend>;

export const BudgetStatus = z.object({
  category: z.string(),
  monthlyTarget: z.number(),
  spent: z.number(),
});
export type BudgetStatus = z.infer<typeof BudgetStatus>;

export const BudgetUpsert = z.object({
  category: z.string().trim().min(1),
  monthlyTarget: z.number().positive(),
});
export type BudgetUpsert = z.infer<typeof BudgetUpsert>;

export const ManualAssetKind = z.enum(['home', 'vehicle', 'other']);
export type ManualAssetKind = z.infer<typeof ManualAssetKind>;

export const ManualAssetInput = z.object({
  kind: ManualAssetKind,
  name: z.string().trim().min(1),
  value: z.number().nonnegative(),
  valueAsOf: z.iso.date().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type ManualAssetInput = z.infer<typeof ManualAssetInput>;

export const ManualAsset = ManualAssetInput.extend({
  id: z.string().uuid(),
  valueAsOf: z.string().nullable(),
  notes: z.string().nullable(),
});
export type ManualAsset = z.infer<typeof ManualAsset>;
