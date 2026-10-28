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

/** One month's spending split by category, largest first. */
export const CategoryMonth = z.object({ month: Month, categories: z.array(CategorySpend) });
export type CategoryMonth = z.infer<typeof CategoryMonth>;

export const CategoryChange = z.object({
  category: z.string(),
  amount: z.number(),
  /** Spending in the same category over the comparison period. */
  previous: z.number(),
  /** The merchant whose spending moved the most between the two periods. */
  driver: z.object({ merchant: z.string(), amount: z.number(), previous: z.number() }).nullable(),
});
export type CategoryChange = z.infer<typeof CategoryChange>;

/** Cash flow over a date range, compared with the same dates a year earlier. */
export const CashflowPeriod = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  previousFrom: z.iso.date(),
  previousTo: z.iso.date(),
  income: z.number(),
  spending: z.number(),
  previousIncome: z.number(),
  previousSpending: z.number(),
  /** Spending categories with spending in either period, largest current amount first. */
  categories: z.array(CategoryChange),
});
export type CashflowPeriod = z.infer<typeof CashflowPeriod>;

const Change = { amount: z.number(), previous: z.number() };

/** One category over a period and the same dates a year earlier, split by subcategory and merchant. */
export const CategoryDetail = z.object({
  category: z.string(),
  from: z.iso.date(),
  to: z.iso.date(),
  previousFrom: z.iso.date(),
  previousTo: z.iso.date(),
  ...Change,
  /** Largest current amount first; null groups transactions without a subcategory. */
  subcategories: z.array(z.object({ subcategory: z.string().nullable(), ...Change })),
  merchants: z.array(z.object({ merchant: z.string(), count: z.number().int(), ...Change })),
});
export type CategoryDetail = z.infer<typeof CategoryDetail>;

export const CashflowPeriodQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, 'from must not be after to');
export type CashflowPeriodQuery = z.infer<typeof CashflowPeriodQuery>;

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

/** What identifies a vehicle for a value lookup on sites like Kelley Blue Book and Edmunds. */
export const VehicleDetails = z.object({
  year: z.number().int().min(1950).max(2100),
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  trim: z.string().trim().min(1).nullable().optional(),
  mileage: z.number().int().nonnegative().nullable().optional(),
  /** Values vary by region; sites ask for a ZIP code. */
  zip: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
});
export type VehicleDetails = z.infer<typeof VehicleDetails>;

/** "2021 Toyota RAV4 XLE". */
export const vehicleLabel = (v: VehicleDetails) => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');

/** Annual depreciation applied to a newly added vehicle; used cars lose roughly this much a year. */
export const DEFAULT_VEHICLE_DEPRECIATION_PERCENT = 15;

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
  vehicle: VehicleDetails.nullable().optional(),
  /** Yearly loss in value, 0–100, compounded from `valueAsOf`. Null means the value holds. */
  depreciationPercent: z.number().min(0).max(100).nullable().optional(),
});
export type ManualAssetInput = z.infer<typeof ManualAssetInput>;

export const ManualAsset = ManualAssetInput.extend({
  id: z.string().uuid(),
  valueAsOf: z.string().nullable(),
  notes: z.string().nullable(),
  address: z.string().nullable(),
  ownershipPercent: z.number().nullable(),
  valuationSources: z.array(ValuationSource).nullable(),
  vehicle: VehicleDetails.nullable(),
  depreciationPercent: z.number().nullable(),
});
export type ManualAsset = z.infer<typeof ManualAsset>;

type ValuedAsset = {
  value: number;
  valueAsOf?: string | null;
  depreciationPercent?: number | null;
  ownershipPercent?: number | null;
};

/** Full value today: `value` as of `valueAsOf`, less `depreciationPercent` a year since then. */
export function currentValue(asset: ValuedAsset, today = new Date()): number {
  const rate = asset.depreciationPercent ?? 0;
  if (!rate || !asset.valueAsOf) return asset.value;
  const [y, m, d] = asset.valueAsOf.split('-').map(Number) as [number, number, number];
  const years = Math.max(0, (today.getTime() - new Date(y, m - 1, d).getTime()) / (365.25 * 86_400_000));
  return Math.round(asset.value * (1 - rate / 100) ** years * 100) / 100;
}

/** The part of an asset's current value that counts toward your net worth. */
export function ownedValue(asset: ValuedAsset, today = new Date()): number {
  return Math.round(currentValue(asset, today) * (asset.ownershipPercent ?? 100)) / 100;
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

export const VehicleEstimateRequest = VehicleDetails;

/** A rough private-party value for a vehicle, from car pricing sites. */
export const VehicleEstimate = z.object({
  /** Median of the source estimates. */
  value: z.number(),
  sources: z.array(ValuationSource),
  warnings: z.array(z.string()),
});
export type VehicleEstimate = z.infer<typeof VehicleEstimate>;

export const CategoryDetailQuery = z
  .object({ category: z.string().min(1), from: z.iso.date(), to: z.iso.date() })
  .refine((q) => q.from <= q.to, 'from must not be after to');
export type CategoryDetailQuery = z.infer<typeof CategoryDetailQuery>;
