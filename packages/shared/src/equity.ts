import { z } from 'zod';
import { NO_INCOME_TAX_STATES, stateTables } from './tax-tables';

export const EquityGrantKind = z.enum(['rsu']);
export type EquityGrantKind = z.infer<typeof EquityGrantKind>;

export const EquityGrantStatus = z.enum(['active', 'completed', 'forfeited']);
export type EquityGrantStatus = z.infer<typeof EquityGrantStatus>;

export const WithholdingMethod = z.enum(['sell_to_cover', 'net_share', 'cash']);
export type WithholdingMethod = z.infer<typeof WithholdingMethod>;

export const EquityVestStatus = z.enum(['scheduled', 'vested', 'forfeited']);
export type EquityVestStatus = z.infer<typeof EquityVestStatus>;

export const VestSchedulePreset = z.enum([
  '4yr_1yr_cliff_quarterly',
  '4yr_quarterly',
  '4yr_1yr_cliff_monthly',
  '4yr_annual',
  'backloaded_5_15_40_40',
  'frontloaded_38_32_20_10',
  'custom',
]);
export type VestSchedulePreset = z.infer<typeof VestSchedulePreset>;

export const EquityPriceSource = z.enum(['recorded', 'market', 'manual', 'none']);
export type EquityPriceSource = z.infer<typeof EquityPriceSource>;

export const DEFAULT_FEDERAL_SUPPLEMENTAL_RATE = 22;
export const MEDICARE_RATE = 1.45;

const SUPPLEMENTAL_STATE_RATES: Record<string, number> = {
  AL: 5,
  AR: 3.9,
  AZ: 2.5,
  CA: 10.23,
  CO: 4.4,
  CT: 6.99,
  DC: 8.5,
  DE: 6.6,
  GA: 4.99,
  HI: 8.25,
  IA: 3.8,
  ID: 5.3,
  IL: 4.95,
  IN: 2.95,
  KS: 5.58,
  KY: 3.5,
  LA: 3,
  MA: 5,
  MD: 5.75,
  ME: 7.15,
  MI: 4.25,
  MN: 6.25,
  MO: 4.7,
  MS: 4,
  MT: 5.65,
  NC: 3.99,
  ND: 2.5,
  NE: 4.55,
  NJ: 6.37,
  NM: 4.9,
  NY: 11.7,
  OH: 2.75,
  OK: 4.5,
  OR: 8,
  PA: 3.07,
  RI: 5.99,
  SC: 5.21,
  UT: 4.5,
  VA: 5.75,
  VT: 6.6,
  WI: 5.3,
  WV: 4.58,
};

/** Default supplemental state withholding rate (%) used when a grant leaves state withholding blank. */
export function defaultSupplementalStateRate(state: string | null): number {
  if (!state) return 0;
  const upper = state.trim().toUpperCase();
  if (NO_INCOME_TAX_STATES.has(upper)) return 0;
  const known = SUPPLEMENTAL_STATE_RATES[upper];
  if (known !== undefined) return known;
  const tbl = stateTables(upper, 2026);
  if (tbl) {
    const single = tbl.brackets.single;
    const rate = single[Math.floor(single.length / 2)]?.rate ?? single.at(-1)?.rate ?? 0.05;
    return Math.round(rate * 10_000) / 100;
  }
  return 5;
}

export const EquityVestInput = z.object({
  id: z.string().uuid().optional(),
  vestDate: z.iso.date(),
  shares: z.number().positive(),
  status: EquityVestStatus.default('scheduled'),
  vestPrice: z.number().positive().nullable().default(null),
  sharesWithheld: z.number().nonnegative().nullable().default(null),
  taxWithheld: z.number().nonnegative().nullable().default(null),
  matchedTxnId: z.string().uuid().nullable().optional(),
});
export type EquityVestInput = z.infer<typeof EquityVestInput>;

export const EquityGrantInput = z.object({
  kind: EquityGrantKind.default('rsu'),
  employer: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  ticker: z.string().trim().max(12).nullable(),
  manualPrice: z.number().positive().nullable(),
  priceAsOf: z.iso.date().nullable(),
  grantDate: z.iso.date(),
  grantNumberMask: z.string().trim().max(12).nullable(),
  totalShares: z.number().positive(),
  linkedAccountId: z.string().uuid().nullable(),
  withholdingMethod: WithholdingMethod.default('sell_to_cover'),
  federalWithholdingRate: z.number().min(0).max(50).nullable(),
  stateWithholdingRate: z.number().min(0).max(20).nullable(),
  status: EquityGrantStatus.default('active'),
  documentId: z.string().uuid().nullable(),
  notes: z.string().trim().max(4000).nullable(),
  vests: z.array(EquityVestInput).min(1).max(120),
});
export type EquityGrantInput = z.infer<typeof EquityGrantInput>;

export const EquityVestConfirmInput = z.object({
  status: EquityVestStatus,
  vestPrice: z.number().positive().nullable(),
  sharesWithheld: z.number().nonnegative().nullable(),
  taxWithheld: z.number().nonnegative().nullable(),
  matchedTxnId: z.string().uuid().nullable().optional(),
});
export type EquityVestConfirmInput = z.infer<typeof EquityVestConfirmInput>;

export const EquityTableExtractRequest = z.object({
  text: z.string().trim().min(10).max(50_000),
});
export type EquityTableExtractRequest = z.infer<typeof EquityTableExtractRequest>;

export const EquityVest = z.object({
  id: z.string().uuid(),
  grantId: z.string().uuid(),
  vestDate: z.iso.date(),
  shares: z.number(),
  status: EquityVestStatus,
  vestPrice: z.number().nullable(),
  sharesWithheld: z.number().nullable(),
  taxWithheld: z.number().nullable(),
  matchedTxnId: z.string().uuid().nullable(),
  price: z.number().nullable(),
  priceSource: EquityPriceSource,
  grossValue: z.number().nullable(),
  estimatedWithholding: z.number().nullable(),
  estimatedNetValue: z.number().nullable(),
  needsConfirmation: z.boolean(),
});
export type EquityVest = z.infer<typeof EquityVest>;

export const EquityGrant = EquityGrantInput.omit({ vests: true }).extend({
  id: z.string().uuid(),
  documentFilename: z.string().nullable(),
  linkedAccountName: z.string().nullable(),
  currentPrice: z.number().nullable(),
  priceSource: EquityPriceSource,
  effectivePriceAsOf: z.string().nullable(),
  vestedShares: z.number(),
  unvestedShares: z.number(),
  forfeitedShares: z.number(),
  unvestedGrossValue: z.number().nullable(),
  unvestedNetValue: z.number().nullable(),
  nextVestDate: z.iso.date().nullable(),
  nextVestShares: z.number().nullable(),
  nextVestGrossValue: z.number().nullable(),
  vests: z.array(EquityVest),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EquityGrant = z.infer<typeof EquityGrant>;

export const EquityTimelineGrantSlice = z.object({
  grantId: z.string().uuid(),
  label: z.string(),
  ticker: z.string().nullable(),
  gross: z.number(),
  net: z.number(),
  shares: z.number(),
});
export type EquityTimelineGrantSlice = z.infer<typeof EquityTimelineGrantSlice>;

export const EquityTimelineBucket = z.object({
  key: z.string(),
  label: z.string(),
  startDate: z.iso.date(),
  totalGross: z.number(),
  totalNet: z.number(),
  totalShares: z.number(),
  byGrant: z.array(EquityTimelineGrantSlice),
});
export type EquityTimelineBucket = z.infer<typeof EquityTimelineBucket>;

export const EquityTickerBreakdown = z.object({
  ticker: z.string().nullable(),
  label: z.string(),
  shares: z.number(),
  grossValue: z.number(),
  netValue: z.number(),
  price: z.number().nullable(),
});
export type EquityTickerBreakdown = z.infer<typeof EquityTickerBreakdown>;

export const EquityNextVest = z.object({
  grantId: z.string().uuid(),
  vestId: z.string().uuid(),
  employer: z.string(),
  grantName: z.string(),
  ticker: z.string().nullable(),
  vestDate: z.iso.date(),
  shares: z.number(),
  grossValue: z.number().nullable(),
  netValue: z.number().nullable(),
});
export type EquityNextVest = z.infer<typeof EquityNextVest>;

export const EquitySummary = z.object({
  asOf: z.iso.date(),
  totalUnvestedGross: z.number(),
  totalUnvestedNet: z.number(),
  next12MonthsGross: z.number(),
  next12MonthsNet: z.number(),
  ytdVestedGross: z.number(),
  ytdVestedWithheld: z.number(),
  remainingThisYearGross: z.number(),
  remainingThisYearWithheld: z.number(),
  unpricedGrants: z.number(),
  nextVest: EquityNextVest.nullable(),
  byTicker: z.array(EquityTickerBreakdown),
  quarterlyTimeline: z.array(EquityTimelineBucket),
  yearlyTimeline: z.array(EquityTimelineBucket),
  grants: z.array(EquityGrant),
});
export type EquitySummary = z.infer<typeof EquitySummary>;

export type EquityGrantExtraction = {
  documentId: string | null;
  filename: string | null;
  draft: EquityGrantInput;
  warnings: string[];
};

/** Same day `months` later in UTC, clamping end-of-month dates (Jan 31 + 1m -> Feb 28/29). */
export function addMonthsUtc(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
}

type ScheduleStep = { months: number; weight: number };

function presetSteps(preset: VestSchedulePreset): ScheduleStep[] {
  switch (preset) {
    case '4yr_1yr_cliff_quarterly':
      return [{ months: 12, weight: 0.25 }, ...Array.from({ length: 12 }, (_, i) => ({ months: 15 + i * 3, weight: 0.0625 }))];
    case '4yr_quarterly':
      return Array.from({ length: 16 }, (_, i) => ({ months: (i + 1) * 3, weight: 1 / 16 }));
    case '4yr_1yr_cliff_monthly':
      return [{ months: 12, weight: 0.25 }, ...Array.from({ length: 36 }, (_, i) => ({ months: 13 + i, weight: 0.75 / 36 }))];
    case '4yr_annual':
      return [12, 24, 36, 48].map((months) => ({ months, weight: 0.25 }));
    case 'backloaded_5_15_40_40':
      return [
        { months: 12, weight: 0.05 },
        { months: 24, weight: 0.15 },
        { months: 30, weight: 0.2 },
        { months: 36, weight: 0.2 },
        { months: 42, weight: 0.2 },
        { months: 48, weight: 0.2 },
      ];
    case 'frontloaded_38_32_20_10':
      return [
        ...Array.from({ length: 4 }, (_, i) => ({ months: (i + 1) * 3, weight: 0.38 / 4 })),
        ...Array.from({ length: 4 }, (_, i) => ({ months: 12 + (i + 1) * 3, weight: 0.32 / 4 })),
        ...Array.from({ length: 4 }, (_, i) => ({ months: 24 + (i + 1) * 3, weight: 0.2 / 4 })),
        ...Array.from({ length: 4 }, (_, i) => ({ months: 36 + (i + 1) * 3, weight: 0.1 / 4 })),
      ];
    case 'custom':
      return [{ months: 12, weight: 1 }];
  }
}

/** Generates a vesting schedule from a grant date, share total, and preset curve. */
export function generateVestSchedule({
  grantDate,
  totalShares,
  preset,
}: {
  grantDate: string;
  totalShares: number;
  preset: VestSchedulePreset;
}): { vestDate: string; shares: number }[] {
  if (!Number.isFinite(totalShares) || totalShares <= 0) return [];
  const steps = presetSteps(preset);
  const integerMode = Number.isInteger(totalShares);
  const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

  let cumulativeWeight = 0;
  let allocated = 0;
  const out: { vestDate: string; shares: number }[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    cumulativeWeight += step.weight;
    const targetCumulative = i === steps.length - 1 ? totalShares : integerMode ? Math.round(totalShares * cumulativeWeight) : round4(totalShares * cumulativeWeight);
    const shares = integerMode ? targetCumulative - allocated : round4(targetCumulative - allocated);
    if (shares > 0) {
      out.push({ vestDate: addMonthsUtc(grantDate, step.months), shares });
      allocated = integerMode ? allocated + shares : round4(allocated + shares);
    }
  }

  // Fallback guard for edge-case rounding on fractional totals.
  if (!out.length) {
    out.push({ vestDate: addMonthsUtc(grantDate, steps[0]!.months), shares: totalShares });
  }
  return out;
}
