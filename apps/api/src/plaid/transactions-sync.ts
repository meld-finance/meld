import type { PlaidApi, RemovedTransaction, Transaction } from 'plaid';
import { getPlaidError } from './client';

export type TransactionUpdates = {
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  /** Cursor to store once the updates are applied; null if Plaid has none yet. */
  nextCursor: string | null;
  ready: boolean;
};

const MAX_RESTARTS = 3;
const PENDING_STATUSES = new Set<string>(['NOT_READY', 'INITIAL_UPDATE_COMPLETE']);

/**
 * Pages through /transactions/sync from `cursor` until has_more is false.
 * If Plaid's data changes mid-pagination, the whole loop restarts from the
 * original cursor, as Plaid's docs require; partial pages are discarded.
 */
export async function fetchTransactionUpdates(
  plaid: Pick<PlaidApi, 'transactionsSync'>,
  accessToken: string,
  cursor: string | null,
): Promise<TransactionUpdates> {
  for (let attempt = 0; ; attempt++) {
    const updates: TransactionUpdates = { added: [], modified: [], removed: [], nextCursor: cursor, ready: true };
    try {
      let hasMore = true;
      while (hasMore) {
        const { data } = await plaid.transactionsSync({
          access_token: accessToken,
          cursor: updates.nextCursor ?? undefined,
          count: 500,
        });
        updates.added.push(...data.added);
        updates.modified.push(...data.modified);
        updates.removed.push(...data.removed);
        // Empty string means no data yet (new item still initializing).
        updates.nextCursor = data.next_cursor || updates.nextCursor;
        // INITIAL_UPDATE_COMPLETE = recent ~30 days only; full history comes later.
        updates.ready = !PENDING_STATUSES.has(data.transactions_update_status);
        hasMore = data.has_more;
      }
      return updates;
    } catch (err) {
      const code = getPlaidError(err)?.error_code;
      if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < MAX_RESTARTS) continue;
      throw err;
    }
  }
}
