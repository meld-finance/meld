import type { SyncResult } from '@meld/shared';
import { eq, inArray } from 'drizzle-orm';
import type { PlaidApi } from 'plaid';
import type { Db } from '../db/client';
import { accounts, plaidItems, transactions } from '../db/schema';
import { chunk, excluded } from '../db/upsert';
import { decrypt } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { recordSnapshot } from '../services/overview';
import { getPlaidError } from './client';
import { toAccountRow, toTransactionRow } from './mappers';
import { fetchTransactionUpdates } from './transactions-sync';

export type SyncDeps = { db: Db; plaid: PlaidApi; encryptionKey: string };

const LOGIN_REQUIRED_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT']);

// One sync per item at a time; concurrent callers share the in-flight run.
const inFlight = new Map<string, Promise<SyncResult>>();

export function syncItem(deps: SyncDeps, itemId: string): Promise<SyncResult> {
  const existing = inFlight.get(itemId);
  if (existing) return existing;
  const run = runSync(deps, itemId).finally(() => inFlight.delete(itemId));
  inFlight.set(itemId, run);
  return run;
}

async function runSync({ db, plaid, encryptionKey }: SyncDeps, itemId: string): Promise<SyncResult> {
  const item = await db.query.plaidItems.findFirst({ where: eq(plaidItems.id, itemId) });
  if (!item) throw new HttpError(404, 'Item not found');
  const accessToken = decrypt(item.accessTokenEnc, encryptionKey);

  try {
    // Accounts first so transactions can reference them.
    const { data } = await plaid.accountsGet({ access_token: accessToken });
    const accountRows = data.accounts.map((a) =>
      toAccountRow(a, { plaidItemId: item.id, institutionId: item.institutionId }),
    );
    const upserted = accountRows.length
      ? await db
          .insert(accounts)
          .values(accountRows)
          .onConflictDoUpdate({
            target: accounts.plaidAccountId,
            set: excluded(accounts, [
              'name',
              'officialName',
              'mask',
              'type',
              'subtype',
              'currentBalance',
              'availableBalance',
              'creditLimit',
              'currency',
            ]),
          })
          .returning({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
      : [];
    const accountIdByPlaidId = new Map(upserted.map((a) => [a.plaidAccountId!, a.id]));

    const updates = await fetchTransactionUpdates(plaid, accessToken, item.transactionsCursor);

    await db.transaction(async (tx) => {
      const changed = [...updates.added, ...updates.modified].filter((t) => accountIdByPlaidId.has(t.account_id));
      const rows = changed.map((t) => toTransactionRow(t, accountIdByPlaidId.get(t.account_id)!));

      // When a pending transaction posts, Plaid removes the pending one and adds
      // a new posted one. Carry the user's category/notes across.
      const pendingIds = changed.map((t) => t.pending_transaction_id).filter((id): id is string => !!id);
      if (pendingIds.length) {
        const pendingRows = await tx
          .select({
            plaidTransactionId: transactions.plaidTransactionId,
            category: transactions.category,
            notes: transactions.notes,
          })
          .from(transactions)
          .where(inArray(transactions.plaidTransactionId, pendingIds));
        const byId = new Map(pendingRows.map((r) => [r.plaidTransactionId, r]));
        changed.forEach((t, i) => {
          const prior = t.pending_transaction_id ? byId.get(t.pending_transaction_id) : undefined;
          if (prior) Object.assign(rows[i]!, { category: prior.category, notes: prior.notes });
        });
      }

      for (const batch of chunk(rows, 500)) {
        await tx
          .insert(transactions)
          .values(batch)
          .onConflictDoUpdate({
            target: transactions.plaidTransactionId,
            set: excluded(transactions, [
              'accountId',
              'amount',
              'currency',
              'date',
              'authorizedDate',
              'name',
              'merchantName',
              'plaidCategoryPrimary',
              'plaidCategoryDetailed',
              'pending',
            ]),
          });
      }

      const removedIds = updates.removed.map((r) => r.transaction_id);
      for (const batch of chunk(removedIds, 1000)) {
        await tx.delete(transactions).where(inArray(transactions.plaidTransactionId, batch));
      }

      await tx
        .update(plaidItems)
        .set({ transactionsCursor: updates.nextCursor, status: 'active', lastError: null, lastSyncedAt: new Date() })
        .where(eq(plaidItems.id, item.id));
    });
    await recordSnapshot(db);

    return {
      accounts: upserted.length,
      added: updates.added.length,
      modified: updates.modified.length,
      removed: updates.removed.length,
      transactionsReady: updates.ready,
    };
  } catch (err) {
    const plaidError = getPlaidError(err);
    if (plaidError) {
      await db
        .update(plaidItems)
        .set({
          status: LOGIN_REQUIRED_CODES.has(plaidError.error_code) ? 'login_required' : 'error',
          lastError: plaidError.display_message ?? plaidError.error_message,
        })
        .where(eq(plaidItems.id, item.id));
    }
    throw err;
  }
}

const READY_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000];

/** New items may not have transactions yet; re-sync a few times in the background. */
export function syncUntilReady(deps: SyncDeps, itemId: string, log: (msg: string) => void) {
  const schedule = (i: number) => {
    const delay = READY_RETRY_DELAYS_MS[i];
    if (delay === undefined) return;
    setTimeout(async () => {
      try {
        const result = await syncItem(deps, itemId);
        if (!result.transactionsReady) schedule(i + 1);
      } catch (err) {
        log(`Background sync failed for item ${itemId}: ${(err as Error).message}`);
      }
    }, delay);
  };
  schedule(0);
}

/** Syncs every active item; used by the periodic scheduler. */
export async function syncAllItems(deps: SyncDeps, log: (msg: string) => void) {
  const items = await deps.db.select({ id: plaidItems.id }).from(plaidItems).where(eq(plaidItems.status, 'active'));
  for (const { id } of items) {
    try {
      await syncItem(deps, id);
    } catch (err) {
      log(`Scheduled sync failed for item ${id}: ${(err as Error).message}`);
    }
  }
}
