import {
  Beneficiary,
  InsurancePolicyInput,
  InsurancePolicyType,
  maskPolicyNumber,
  PremiumFrequency,
} from '@meld/shared';
import { z } from 'zod';
import type { ExtractedPolicy } from './provider';

/**
 * What the model fills in. Kept loose (no ranges or formats) so structured output
 * always parses; normalizeExtraction() then validates each field and turns
 * anything unusable into null plus a warning, rather than failing the whole upload.
 */
export const ExtractionSchema = z.object({
  type: InsurancePolicyType,
  carrier: z.string().nullable(),
  policyNumberLast4: z.string().nullable(),
  insuredName: z.string().nullable(),
  coverageAmount: z.number().nullable(),
  benefitPercentOfIncome: z.number().nullable(),
  premiumAmount: z.number().nullable(),
  premiumFrequency: PremiumFrequency.nullable(),
  effectiveDate: z.string().nullable(),
  termEndDate: z.string().nullable(),
  eliminationPeriodDays: z.number().nullable(),
  benefitPeriod: z.string().nullable(),
  ownOccupation: z.boolean().nullable(),
  employerProvided: z.boolean().nullable(),
  cashValue: z.number().nullable(),
  beneficiaries: z.array(
    z.object({
      name: z.string(),
      relationship: z.string().nullable(),
      percentage: z.number(),
      primary: z.boolean(),
    }),
  ),
  notes: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type RawExtraction = z.infer<typeof ExtractionSchema>;

export const EXTRACTION_PROMPT = `Read this insurance document and fill in the policy fields.

- type: life_term, life_whole, life_universal, disability_short, disability_long, or other.
- coverageAmount: the death benefit for life insurance; the MONTHLY benefit for disability. If a disability benefit is only given as a weekly or annual amount, convert it to monthly and say so in warnings. If it is only a percentage of income with a monthly maximum, use the maximum.
- benefitPercentOfIncome: disability only, e.g. 60 for 60%.
- premiumAmount and premiumFrequency: what the policyholder pays per period. For employer plans where the employer pays the full premium, use 0.
- Dates as YYYY-MM-DD. termEndDate is when term life coverage ends; compute it from the effective date and term length if needed, and say so in warnings.
- eliminationPeriodDays: disability waiting period in days (convert weeks or months to days).
- benefitPeriod: disability only, short text like "2 years" or "to age 65".
- ownOccupation: true only if the definition of disability is own-occupation (for the whole or a stated part of the benefit period; describe any limit in notes).
- employerProvided: true for group or employer-sponsored coverage.
- policyNumberLast4: ONLY the last 4 characters of the policy or certificate number, never the full number.
- beneficiaries: name, relationship, percentage and whether primary (true) or contingent (false).
- notes: one or two short sentences on anything important that doesn't fit a field (riders, conversion options, offsets for Social Security, coverage that ends when employment ends).

Use null for anything the document doesn't state. Don't guess. Add a short warning for every field you inferred, converted or couldn't find but would normally expect, and if the document isn't an insurance policy or summary of benefits.`;

const isoDate = z.iso.date();

export function normalizeExtraction(raw: RawExtraction): ExtractedPolicy {
  const warnings = [...raw.warnings];

  function check<T>(field: string, value: T | null, schema: z.ZodType<T>): T | null {
    if (value === null) return null;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    warnings.push(`Ignored an unreadable ${field} (${JSON.stringify(value)}).`);
    return null;
  }

  const shape = InsurancePolicyInput.shape;
  const beneficiaries = raw.beneficiaries.filter((b) => Beneficiary.safeParse(b).success);
  if (beneficiaries.length < raw.beneficiaries.length) warnings.push('Some beneficiaries couldn’t be read.');

  const carrier = raw.carrier?.trim() ?? '';
  if (!carrier) warnings.push('Couldn’t find the insurance company name.');

  return {
    draft: {
      type: raw.type,
      carrier,
      // Enforce masking even if the model returned more than asked.
      policyNumberMask: maskPolicyNumber(raw.policyNumberLast4),
      insuredName: raw.insuredName?.trim() || null,
      coverageAmount: check('coverage amount', raw.coverageAmount, shape.coverageAmount.unwrap()),
      benefitPercentOfIncome: check('benefit percentage', raw.benefitPercentOfIncome, shape.benefitPercentOfIncome.unwrap()),
      premiumAmount: check('premium', raw.premiumAmount, shape.premiumAmount.unwrap()),
      premiumFrequency: raw.premiumFrequency,
      effectiveDate: check('effective date', raw.effectiveDate, isoDate),
      termEndDate: check('term end date', raw.termEndDate, isoDate),
      eliminationPeriodDays: check(
        'elimination period',
        raw.eliminationPeriodDays === null ? null : Math.round(raw.eliminationPeriodDays),
        shape.eliminationPeriodDays.unwrap(),
      ),
      benefitPeriod: raw.benefitPeriod?.trim() || null,
      ownOccupation: raw.ownOccupation,
      employerProvided: raw.employerProvided,
      cashValue: check('cash value', raw.cashValue, shape.cashValue.unwrap()),
      beneficiaries,
      notes: raw.notes?.trim() || null,
    },
    warnings,
  };
}
