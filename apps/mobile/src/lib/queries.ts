import type {
  Account,
  PlaidItemSummary,
  SyncResult,
  TransactionPage,
  TransactionQuery,
  TransactionUpdate,
} from '@meld/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

const PAGE_SIZE = 100;

export const keys = {
  accounts: ['accounts'] as const,
  items: ['items'] as const,
  transactions: (q: Omit<TransactionQuery, 'limit' | 'offset'>) => ['transactions', q] as const,
  categories: ['transactions', 'categories'] as const,
};

export function useAccounts() {
  return useQuery({ queryKey: keys.accounts, queryFn: () => api<Account[]>('/accounts') });
}

export function useItems() {
  return useQuery({ queryKey: keys.items, queryFn: () => api<PlaidItemSummary[]>('/items') });
}

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: () => api<string[]>('/transactions/categories') });
}

export function useTransactions(filters: Omit<TransactionQuery, 'limit' | 'offset'>) {
  return useInfiniteQuery({
    queryKey: keys.transactions(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
      return api<TransactionPage>(`/transactions?${params}`);
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.transactions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

/** Anything that changes Plaid data invalidates accounts, items and transactions. */
function useInvalidateFinancialData() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.accounts }),
      qc.invalidateQueries({ queryKey: keys.items }),
      qc.invalidateQueries({ queryKey: ['transactions'] }),
    ]);
}

export function useExchangePublicToken() {
  const invalidate = useInvalidateFinancialData();
  return useMutation({
    mutationFn: (publicToken: string) =>
      api<SyncResult & { itemId: string }>('/plaid/exchange', {
        method: 'POST',
        body: JSON.stringify({ publicToken }),
      }),
    onSuccess: invalidate,
  });
}

export function useSyncItem() {
  const invalidate = useInvalidateFinancialData();
  return useMutation({
    mutationFn: (itemId: string) => api<SyncResult>(`/items/${itemId}/sync`, { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useRemoveItem() {
  const invalidate = useInvalidateFinancialData();
  return useMutation({
    mutationFn: (itemId: string) => api(`/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...update }: TransactionUpdate & { id: string }) =>
      api(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });
}
