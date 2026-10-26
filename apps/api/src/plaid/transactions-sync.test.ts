import type { PlaidApi, Transaction, TransactionsSyncResponse } from 'plaid';
import { describe, expect, it, vi } from 'vitest';
import { fetchTransactionUpdates } from './transactions-sync';

const txn = (id: string) => ({ transaction_id: id, account_id: 'acc' }) as Transaction;

function page(overrides: Partial<TransactionsSyncResponse>) {
  return {
    data: {
      added: [],
      modified: [],
      removed: [],
      next_cursor: '',
      has_more: false,
      transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
      accounts: [],
      request_id: 'req',
      ...overrides,
    },
  };
}

const mutationError = () =>
  Object.assign(new Error('Request failed'), {
    response: { data: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } },
  });

function client(...responses: (ReturnType<typeof page> | Error)[]) {
  const transactionsSync = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) transactionsSync.mockRejectedValueOnce(r);
    else transactionsSync.mockResolvedValueOnce(r);
  }
  return { transactionsSync } as unknown as Pick<PlaidApi, 'transactionsSync'> & {
    transactionsSync: ReturnType<typeof vi.fn>;
  };
}

describe('fetchTransactionUpdates', () => {
  it('follows has_more across pages and returns the final cursor', async () => {
    const plaid = client(
      page({ added: [txn('a')], next_cursor: 'c1', has_more: true }),
      page({ added: [txn('b')], removed: [{ transaction_id: 'x', account_id: 'acc' }], next_cursor: 'c2' }),
    );
    const result = await fetchTransactionUpdates(plaid, 'token', null);
    expect(result.added.map((t) => t.transaction_id)).toEqual(['a', 'b']);
    expect(result.removed).toHaveLength(1);
    expect(result.nextCursor).toBe('c2');
    expect(result.ready).toBe(true);
    expect(plaid.transactionsSync.mock.calls[1]![0].cursor).toBe('c1');
  });

  it('restarts from the original cursor and discards partial pages on mutation', async () => {
    const plaid = client(
      page({ added: [txn('stale')], next_cursor: 'c1', has_more: true }),
      mutationError(),
      page({ added: [txn('fresh')], next_cursor: 'c2' }),
    );
    const result = await fetchTransactionUpdates(plaid, 'token', 'start');
    expect(result.added.map((t) => t.transaction_id)).toEqual(['fresh']);
    expect(plaid.transactionsSync.mock.calls.map((c) => c[0].cursor)).toEqual(['start', 'c1', 'start']);
  });

  it('keeps the previous cursor and reports not-ready while Plaid initializes', async () => {
    const plaid = client(page({ transactions_update_status: 'NOT_READY' as never, next_cursor: '' }));
    const result = await fetchTransactionUpdates(plaid, 'token', 'prev');
    expect(result.nextCursor).toBe('prev');
    expect(result.ready).toBe(false);
  });

  it('treats initial (30-day) update as not yet fully ready', async () => {
    const plaid = client(page({ transactions_update_status: 'INITIAL_UPDATE_COMPLETE' as never, next_cursor: 'c' }));
    expect((await fetchTransactionUpdates(plaid, 'token', null)).ready).toBe(false);
  });

  it('rethrows other errors', async () => {
    const plaid = client(new Error('boom'));
    await expect(fetchTransactionUpdates(plaid, 'token', null)).rejects.toThrow('boom');
  });
});
