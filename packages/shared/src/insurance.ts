import { z } from 'zod';

export const InsurancePolicyType = z.enum([
  'life_term',
  'life_whole',
  'life_universal',
  'disability_short',
  'disability_long',
  'other',
]);
export type InsurancePolicyType = z.infer<typeof InsurancePolicyType>;

export const isLifePolicy = (t: InsurancePolicyType) => t.startsWith('life_');
/** Permanent life policies build cash value; term life doesn't. */
export const hasCashValue = (t: InsurancePolicyType) => t === 'life_whole' || t === 'life_universal';
export const isDisabilityPolicy = (t: InsurancePolicyType) => t.startsWith('disability_');

export const PremiumFrequency = z.enum(['monthly', 'quarterly', 'semiannual', 'annual']);
export type PremiumFrequency = z.infer<typeof PremiumFrequency>;

export const PAYMENTS_PER_YEAR: Record<PremiumFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

export const Beneficiary = z.object({
  name: z.string(),
  relationship: z.string().nullable(),
  percentage: z.number().min(0).max(100),
  primary: z.boolean(),
});
export type Beneficiary = z.infer<typeof Beneficiary>;

/** Fields the user (or PDF extraction) provides for a policy. */
export const InsurancePolicyInput = z.object({
  type: InsurancePolicyType,
  carrier: z.string().trim().min(1),
  /** Last 4 characters only; full policy numbers are never stored. */
  policyNumberMask: z.string().max(4).nullable(),
  insuredName: z.string().nullable(),
  /** Death benefit for life; monthly benefit for disability. */
  coverageAmount: z.number().nonnegative().nullable(),
  /** Disability: percent of income replaced. */
  benefitPercentOfIncome: z.number().min(0).max(100).nullable(),
  premiumAmount: z.number().nonnegative().nullable(),
  premiumFrequency: PremiumFrequency.nullable(),
  effectiveDate: z.iso.date().nullable(),
  /** Term life end date. */
  termEndDate: z.iso.date().nullable(),
  /** Disability: days before benefits begin. */
  eliminationPeriodDays: z.number().int().nonnegative().nullable(),
  /** Disability: e.g. "2 years", "to age 65". */
  benefitPeriod: z.string().nullable(),
  ownOccupation: z.boolean().nullable(),
  employerProvided: z.boolean().nullable(),
  /** Whole/universal life: account value before surrender charges and loans. */
  cashValue: z.number().nonnegative().nullable(),
  /** Whole/universal life: what cancelling pays out, after surrender charges and loans. */
  cashSurrenderValue: z.number().nonnegative().nullable(),
  /** Whole/universal life: outstanding policy loans, including accrued interest. */
  loanBalance: z.number().nonnegative().nullable(),
  /** Statement date the cash values come from. */
  valuesAsOf: z.iso.date().nullable(),
  beneficiaries: z.array(Beneficiary),
  notes: z.string().nullable(),
  /** The uploaded policy document this was entered from, if any. */
  documentId: z.uuid().nullable(),
});
export type InsurancePolicyInput = z.infer<typeof InsurancePolicyInput>;

export const InsurancePolicy = InsurancePolicyInput.extend({
  id: z.uuid(),
  documentFilename: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InsurancePolicy = z.infer<typeof InsurancePolicy>;

/** Draft returned from PDF extraction, for the user to review before saving. */
export type PolicyExtraction = {
  documentId: string;
  filename: string;
  /** Fields read from the document; documentId is already set. */
  draft: InsurancePolicyInput;
  /** Things the model was unsure about or couldn't find. */
  warnings: string[];
};

export function annualPremium(p: Pick<InsurancePolicyInput, 'premiumAmount' | 'premiumFrequency'>): number | null {
  if (p.premiumAmount === null || p.premiumFrequency === null) return null;
  return p.premiumAmount * PAYMENTS_PER_YEAR[p.premiumFrequency];
}

/** Term life whose end date has passed no longer pays out. */
export function isLapsed(p: Pick<InsurancePolicyInput, 'type' | 'termEndDate'>, today: string): boolean {
  return p.type === 'life_term' && p.termEndDate !== null && p.termEndDate < today;
}

type CashValueFields = Pick<InsurancePolicyInput, 'type' | 'cashValue' | 'cashSurrenderValue' | 'loanBalance'>;

/**
 * What the policy would pay if cancelled today, which is what counts toward net worth.
 * Prefers the stated surrender value (already net of surrender charges and loans);
 * otherwise estimates it as cash value minus loans, which overstates it while
 * surrender charges still apply.
 */
export function netCashValue(p: CashValueFields): number | null {
  if (!hasCashValue(p.type)) return null;
  if (p.cashSurrenderValue !== null) return p.cashSurrenderValue;
  if (p.cashValue === null) return null;
  return Math.max(0, p.cashValue - (p.loanBalance ?? 0));
}

/** Statements are annual; allow a month's slack for the next one to arrive. */
const CASH_VALUE_STALE_MONTHS = 13;

/** Cash values from a statement older than about a year are likely out of date. */
export function isCashValueStale(p: CashValueFields & Pick<InsurancePolicyInput, 'valuesAsOf'>, today: string): boolean {
  if (netCashValue(p) === null || p.valuesAsOf === null) return false;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const cutoff = new Date(Date.UTC(y, m - 1 - CASH_VALUE_STALE_MONTHS, d)).toISOString().slice(0, 10);
  return p.valuesAsOf < cutoff;
}

export type InsuranceTotals = {
  lifeCoverage: number;
  /** Monthly disability benefit; short- and long-term counted separately. */
  shortTermDisabilityMonthly: number;
  longTermDisabilityMonthly: number;
  annualPremiums: number;
  /** Surrender value of permanent life policies; see netCashValue(). */
  cashValue: number;
};

export function insuranceTotals(policies: InsurancePolicyInput[], today: string): InsuranceTotals {
  const totals: InsuranceTotals = {
    lifeCoverage: 0,
    shortTermDisabilityMonthly: 0,
    longTermDisabilityMonthly: 0,
    annualPremiums: 0,
    cashValue: 0,
  };
  for (const p of policies) {
    if (isLapsed(p, today)) continue;
    const coverage = p.coverageAmount ?? 0;
    if (isLifePolicy(p.type)) totals.lifeCoverage += coverage;
    if (p.type === 'disability_short') totals.shortTermDisabilityMonthly += coverage;
    if (p.type === 'disability_long') totals.longTermDisabilityMonthly += coverage;
    totals.annualPremiums += annualPremium(p) ?? 0;
    totals.cashValue += netCashValue(p) ?? 0;
  }
  return totals;
}

/** Keeps only the last 4 alphanumeric characters of a policy number. */
export function maskPolicyNumber(value: string | null | undefined): string | null {
  const chars = (value ?? '').replace(/[^A-Za-z0-9]/g, '');
  return chars ? chars.slice(-4) : null;
}
