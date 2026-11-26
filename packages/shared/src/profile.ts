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

/** A spouse or partner, optional, for staggered retirement and separate Social Security. */
export const Partner = z.object({
  name: z.string().trim().max(60).nullable(),
  birthYear: z.number().int().min(1900).max(2100).nullable(),
  annualGrossIncome: z.number().nonnegative().nullable(),
});
export type Partner = z.infer<typeof Partner>;

/** A partner's display name, falling back to "Partner". */
export function partnerName(partner: Pick<Partner, 'name'> | null | undefined): string {
  return partner?.name?.trim() || 'Partner';
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
  partner: Partner.nullable().default(null),
  occupation: z.string().trim().max(200).nullable(),
  /** Free-form: 401k match, HSA eligibility, ESPP, etc. */
  employerBenefits: z.string().trim().max(4000).nullable(),
  goals: z.string().trim().max(4000).nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;

/** Combined household gross income across you and your partner, or null if neither is entered. */
export function householdGrossIncome(profile: Pick<UserProfile, 'annualGrossIncome' | 'partner'>): number | null {
  const partnerIncome = profile.partner?.annualGrossIncome ?? null;
  if (profile.annualGrossIncome === null && partnerIncome === null) return null;
  return (profile.annualGrossIncome ?? 0) + (partnerIncome ?? 0);
}
