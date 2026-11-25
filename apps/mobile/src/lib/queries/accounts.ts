import type {
  Account,
  AccountDetail,
  AccountUpdate,
  CashPlan,
  CashSettings,
  InvestmentIncome,
  InvestmentPerformance,
  InvestmentsSummary,
  LiabilitySummary,
  PlaidItemSummary,
  ProfileResult,
  SyncResult,
} from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys, useInvalidateFinancialData } from './keys';

export function useAccounts({ includeHidden = false } = {}) {
  return useQuery({
    queryKey: [...keys.accounts, { includeHidden }],
    queryFn: () => api<Account[]>(`/accounts${includeHidden ? '?includeHidden=true' : ''}`),
  });
}

export function useAccountDetail(id: string) {
  return useQuery({ queryKey: [...keys.accounts, 'detail', id], queryFn: () => api<AccountDetail>(`/accounts/${id}`) });
}

export function useInvestments() {
  return useQuery({ queryKey: ['investments'], queryFn: () => api<InvestmentsSummary>('/investments') });
}

export function useInvestmentIncome() {
  return useQuery({ queryKey: ['investments', 'income'], queryFn: () => api<InvestmentIncome>('/investments/income') });
}

/** Off until wanted: the first load of the day fetches price history. */
export function useInvestmentPerformance(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['investments', 'performance'],
    queryFn: () => api<InvestmentPerformance>('/investments/performance'),
  });
}

/** Asks the AI what's inside held funds that haven't been looked at yet. */
export function useProfileSecurities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<ProfileResult>('/investments/profile', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investments'] }),
  });
}

export function useLiabilities() {
  return useQuery({ queryKey: [...keys.accounts, 'liabilities'], queryFn: () => api<LiabilitySummary[]>('/liabilities') });
}

export function useUpdateAccount() {
  const invalidate = useInvalidateFinancialData();
  return useMutation({
    mutationFn: ({ id, ...update }: AccountUpdate & { id: string }) =>
      api(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: invalidate,
  });
}

export function useItems() {
  return useQuery({ queryKey: keys.items, queryFn: () => api<PlaidItemSummary[]>('/items') });
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

/** Liquid cash, what it earns, and the emergency fund it adds up to. */
export function useCashPlan() {
  return useQuery({ queryKey: keys.cash, queryFn: () => api<CashPlan>('/cash') });
}

export function useSaveCashSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: CashSettings) => api<CashSettings>('/cash/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.cash }),
  });
}
