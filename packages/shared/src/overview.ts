import { z } from 'zod';
import { AccountType } from './accounts';

/** "2026-10" */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
export type Month = z.infer<typeof Month>;

export const NetWorthSummary = z.object({
  assets: z.number(),
  liabilities: z.number(),
  netWorth: z.number(),
  /**
   * Balance totals per account type; manual assets appear as 'manual' and
   * life insurance surrender value as 'insurance'.
   */
  byType: z.array(z.object({ type: z.union([AccountType, z.enum(['manual', 'insurance'])]), total: z.number() })),
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

/** One site's estimate for a property, e.g. Zillow's Zestimate. */
export const ValuationSource = z.object({
  name: z.string(),
  value: z.number().nonnegative(),
  url: z.url().nullable(),
});
export type ValuationSource = z.infer<typeof ValuationSource>;

export const ManualAssetInput = z.object({
  kind: ManualAssetKind,
  name: z.string().trim().min(1),
  /** Full market value; net worth counts `value × ownershipPercent`. */
  value: z.number().nonnegative(),
  valueAsOf: z.iso.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  address: z.string().trim().min(1).nullable().optional(),
  /** Your share, 0–100. Null means you own all of it. */
  ownershipPercent: z.number().gt(0).max(100).nullable().optional(),
  valuationSources: z.array(ValuationSource).nullable().optional(),
});
export type ManualAssetInput = z.infer<typeof ManualAssetInput>;

export const ManualAsset = ManualAssetInput.extend({
  id: z.string().uuid(),
  valueAsOf: z.string().nullable(),
  notes: z.string().nullable(),
  address: z.string().nullable(),
  ownershipPercent: z.number().nullable(),
  valuationSources: z.array(ValuationSource).nullable(),
});
export type ManualAsset = z.infer<typeof ManualAsset>;

/** The part of an asset's value that counts toward your net worth. */
export function ownedValue(asset: { value: number; ownershipPercent?: number | null }): number {
  return Math.round(asset.value * (asset.ownershipPercent ?? 100)) / 100;
}

export const PropertyEstimateRequest = z.object({ address: z.string().trim().min(5) });
export type PropertyEstimateRequest = z.infer<typeof PropertyEstimateRequest>;

/** A rough market value for an address, pieced together from real estate sites. */
export const PropertyEstimate = z.object({
  /** The address as the sites list it, when one matched. */
  address: z.string(),
  /** Median of the source estimates. */
  value: z.number(),
  /** `direct`: sites' estimates for this property. `comparables`: similar units in the building, scaled by size. */
  basis: z.enum(['direct', 'comparables']),
  sources: z.array(ValuationSource),
  warnings: z.array(z.string()),
});
export type PropertyEstimate = z.infer<typeof PropertyEstimate>;
