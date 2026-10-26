import { z } from 'zod';

export const PlaidItemStatus = z.enum(['active', 'login_required', 'error', 'revoked']);
export type PlaidItemStatus = z.infer<typeof PlaidItemStatus>;

/** A linked institution login (one Plaid Item can hold several accounts). */
export const PlaidItemSummary = z.object({
  id: z.string().uuid(),
  institutionName: z.string().nullable(),
  status: PlaidItemStatus,
  lastError: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  accountCount: z.number().int(),
});
export type PlaidItemSummary = z.infer<typeof PlaidItemSummary>;

export const LinkTokenRequest = z.object({
  /** Set to re-authenticate an existing item (Plaid "update mode"). */
  itemId: z.string().uuid().optional(),
});
export type LinkTokenRequest = z.infer<typeof LinkTokenRequest>;

export const LinkTokenResponse = z.object({ linkToken: z.string() });
export type LinkTokenResponse = z.infer<typeof LinkTokenResponse>;

export const ExchangeRequest = z.object({ publicToken: z.string().min(1) });
export type ExchangeRequest = z.infer<typeof ExchangeRequest>;

export const SyncResult = z.object({
  accounts: z.number().int(),
  added: z.number().int(),
  modified: z.number().int(),
  removed: z.number().int(),
  /** False while Plaid is still pulling history for a new item. */
  transactionsReady: z.boolean(),
  holdings: z.number().int(),
  liabilities: z.number().int(),
});
export type SyncResult = z.infer<typeof SyncResult>;
