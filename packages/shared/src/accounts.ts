import { z } from 'zod';

export const AccountType = z.enum([
  'depository',
  'credit',
  'investment',
  'loan',
  'mortgage',
  'other',
]);
export type AccountType = z.infer<typeof AccountType>;

export const AccountSource = z.enum(['plaid', 'manual']);
export type AccountSource = z.infer<typeof AccountSource>;

export const Account = z.object({
  id: z.string().uuid(),
  source: AccountSource,
  itemId: z.string().uuid().nullable(),
  institutionName: z.string().nullable(),
  name: z.string(),
  officialName: z.string().nullable(),
  mask: z.string().nullable(),
  type: AccountType,
  subtype: z.string().nullable(),
  currentBalance: z.number().nullable(),
  availableBalance: z.number().nullable(),
  creditLimit: z.number().nullable(),
  currency: z.string(),
  hidden: z.boolean(),
  updatedAt: z.string(),
});
export type Account = z.infer<typeof Account>;

export const AccountUpdate = z.object({
  /** Hidden accounts are excluded from net worth, cash flow, budgets and lists. */
  hidden: z.boolean().optional(),
});
export type AccountUpdate = z.infer<typeof AccountUpdate>;

/** Liability-type accounts reduce net worth. */
export function isLiabilityType(type: AccountType): boolean {
  return type === 'credit' || type === 'loan' || type === 'mortgage';
}
