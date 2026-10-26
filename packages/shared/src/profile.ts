import { z } from 'zod';

export const FilingStatus = z.enum([
  'single',
  'married_joint',
  'married_separate',
  'head_of_household',
  'qualifying_widow',
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/** Inputs the AI needs for tax and insurance reasoning. */
export const UserProfile = z.object({
  displayName: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  filingStatus: FilingStatus.nullable(),
  state: z.string().length(2).nullable(),
  dependents: z.number().int().min(0).nullable(),
  annualGrossIncome: z.number().nullable(),
  occupation: z.string().nullable(),
  /** Free-form: 401k match, HSA eligibility, ESPP, etc. */
  employerBenefits: z.string().nullable(),
  goals: z.string().nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;
