import { z } from 'zod';

export const FilingStatus = z.enum([
  'single',
  'married_joint',
  'married_separate',
  'head_of_household',
  'qualifying_widow',
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/** A child, by birth year so their age stays current. */
export const Child = z.object({
  /** Stable across edits, so spending changes can follow a child. */
  id: z.string().min(1).max(40),
  name: z.string().trim().max(60).nullable(),
  birthYear: z.number().int().min(1900).max(2100),
});
export type Child = z.infer<typeof Child>;

/** A child's name, or their place in the list. */
export function childName(children: Child[], id: string): string {
  const i = children.findIndex((c) => c.id === id);
  return children[i]?.name || `Child ${i + 1}`;
}

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
  children: z.array(Child).max(20),
  annualGrossIncome: z.number().nonnegative().nullable(),
  occupation: z.string().trim().max(200).nullable(),
  /** Free-form: 401k match, HSA eligibility, ESPP, etc. */
  employerBenefits: z.string().trim().max(4000).nullable(),
  goals: z.string().trim().max(4000).nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;
