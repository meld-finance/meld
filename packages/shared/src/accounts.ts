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
  /** Your share of a jointly held account, 0–100. Null means it's all yours. */
  ownershipPercent: z.number().nullable(),
  updatedAt: z.string(),
});
export type Account = z.infer<typeof Account>;

export const AccountUpdate = z.object({
  /** Hidden accounts are excluded from net worth, cash flow, budgets and lists. */
  hidden: z.boolean().optional(),
  /** Scales the balance and the account's transactions in every total; null resets to 100%. */
  ownershipPercent: z.number().gt(0).max(100).nullable().optional(),
});
export type AccountUpdate = z.infer<typeof AccountUpdate>;

/** The part of an account's balance that's yours. */
export function ownedBalance(account: { currentBalance: number | null; ownershipPercent?: number | null }): number {
  return Math.round((account.currentBalance ?? 0) * (account.ownershipPercent ?? 100)) / 100;
}

/** Liability-type accounts reduce net worth. */
export function isLiabilityType(type: AccountType): boolean {
  return type === 'credit' || type === 'loan' || type === 'mortgage';
}

/** Full human-readable account label: institution, official (or short) name, and last 4 digits. */
export function accountDisplayName(a: {
  name: string;
  officialName?: string | null;
  institutionName?: string | null;
  mask?: string | null;
}): string {
  const base = a.officialName?.trim() || a.name.trim();
  const inst = a.institutionName?.trim();
  const withInst = inst && !base.toLowerCase().includes(inst.toLowerCase()) ? `${inst} · ${base}` : base;
  return a.mask ? `${withInst} ••${a.mask}` : withInst;
}
