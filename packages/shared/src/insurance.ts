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

export const PremiumFrequency = z.enum(['monthly', 'quarterly', 'semiannual', 'annual']);
export type PremiumFrequency = z.infer<typeof PremiumFrequency>;

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
  carrier: z.string(),
  policyNumberMask: z.string().nullable(),
  insuredName: z.string().nullable(),
  /** Death benefit for life; monthly benefit for disability. */
  coverageAmount: z.number().nullable(),
  /** Disability: percent of income replaced. */
  benefitPercentOfIncome: z.number().nullable(),
  premiumAmount: z.number().nullable(),
  premiumFrequency: PremiumFrequency.nullable(),
  effectiveDate: z.string().nullable(),
  /** Term life end date. */
  termEndDate: z.string().nullable(),
  /** Disability: days before benefits begin. */
  eliminationPeriodDays: z.number().int().nullable(),
  /** Disability: e.g. "2 years", "to age 65". */
  benefitPeriod: z.string().nullable(),
  ownOccupation: z.boolean().nullable(),
  employerProvided: z.boolean().nullable(),
  /** Whole/universal life cash value. */
  cashValue: z.number().nullable(),
  beneficiaries: z.array(Beneficiary),
  notes: z.string().nullable(),
});
export type InsurancePolicyInput = z.infer<typeof InsurancePolicyInput>;

export const InsurancePolicy = InsurancePolicyInput.extend({
  id: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InsurancePolicy = z.infer<typeof InsurancePolicy>;
