import { z } from 'zod';

export const FilingStatus = z.enum([
  'single',
  'married_joint',
  'married_separate',
  'head_of_household',
  'qualifying_widow',
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/** Inputs the AI needs for tax and insurance reasoning. Every field is optional. */
export const UserProfile = z.object({
  displayName: z.string().trim().max(100).nullable(),
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  filingStatus: FilingStatus.nullable(),
  /** Two-letter US state code. */
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter state code')
    .nullable(),
  dependents: z.number().int().min(0).max(20).nullable(),
  annualGrossIncome: z.number().nonnegative().nullable(),
  occupation: z.string().trim().max(200).nullable(),
  /** Free-form: 401k match, HSA eligibility, ESPP, etc. */
  employerBenefits: z.string().trim().max(4000).nullable(),
  goals: z.string().trim().max(4000).nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;
