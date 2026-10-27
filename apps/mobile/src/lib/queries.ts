import type {
  Account,
  AccountDetail,
  AccountUpdate,
  InvestmentsSummary,
  BudgetStatus,
  BudgetUpsert,
  CashflowMonth,
  CategorySpend,
  ChatSessionDetail,
  ChatSessionSummary,
  InsurancePolicy,
  InsurancePolicyInput,
  LiabilitySummary,
  ManualAsset,
  ManualAssetInput,
  NetWorthPoint,
  NetWorthSummary,
  PolicyExtraction,
  PropertyEstimate,
  PlaidItemSummary,
  SyncResult,
  TransactionPage,
  TransactionQuery,
  TransactionUpdate,
  UserProfile,
} from '@meld/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

const PAGE_SIZE = 100;

export const keys = {
  accounts: ['accounts'] as const,
  items: ['items'] as const,
  transactions: (q: Omit<TransactionQuery, 'limit' | 'offset'>) => ['transactions', q] as const,
  categories: ['transactions', 'categories'] as const,
  netWorth: ['networth'] as const,
  netWorthHistory: (days: number) => ['networth', 'history', days] as const,
  cashflow: (months: number) => ['cashflow', months] as const,
  spending: (month: string) => ['spending', month] as const,
  budgets: (month: string) => ['budgets', month] as const,
  manualAssets: ['manual-assets'] as const,
  insurance: ['insurance'] as const,
  chatSessions: ['chat', 'sessions'] as const,
  chatSession: (id: string) => ['chat', 'sessions', id] as const,
  profile: ['profile'] as const,
};

export function useNetWorth() {
  return useQuery({ queryKey: keys.netWorth, queryFn: () => api<NetWorthSummary>('/networth') });
}

export function useNetWorthHistory(days = 365) {
  return useQuery({
    queryKey: keys.netWorthHistory(days),
    queryFn: () => api<NetWorthPoint[]>(`/networth/history?days=${days}`),
  });
}

export function useCashflow(months = 6) {
  return useQuery({ queryKey: keys.cashflow(months), queryFn: () => api<CashflowMonth[]>(`/cashflow?months=${months}`) });
}

export function useSpending(month: string) {
  return useQuery({ queryKey: keys.spending(month), queryFn: () => api<CategorySpend[]>(`/spending?month=${month}`) });
}

export function useBudgets(month: string) {
  return useQuery({ queryKey: keys.budgets(month), queryFn: () => api<BudgetStatus[]>(`/budgets?month=${month}`) });
}

export function useUpsertBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (budget: BudgetUpsert) => api('/budgets', { method: 'PUT', body: JSON.stringify(budget) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (category: string) => api(`/budgets/${encodeURIComponent(category)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useManualAssets() {
  return useQuery({ queryKey: keys.manualAssets, queryFn: () => api<ManualAsset[]>('/manual-assets') });
}

function useInvalidateManualAssets() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.manualAssets }),
      qc.invalidateQueries({ queryKey: ['networth'] }),
    ]);
}

export function useSaveManualAsset() {
  const invalidate = useInvalidateManualAssets();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ManualAssetInput> & { id?: string }) =>
      id
        ? api<ManualAsset>(`/manual-assets/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
        : api<ManualAsset>('/manual-assets', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

/** Looks up a rough market value for an address (takes a minute or two). */
export function useEstimatePropertyValue() {
  return useMutation({
    mutationFn: (address: string) =>
      api<PropertyEstimate>('/manual-assets/estimate', { method: 'POST', body: JSON.stringify({ address }) }),
  });
}

export function useDeleteManualAsset() {
  const invalidate = useInvalidateManualAssets();
  return useMutation({
    mutationFn: (id: string) => api(`/manual-assets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

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
      qc.invalidateQueries({ queryKey: ['networth'] }),
      qc.invalidateQueries({ queryKey: ['cashflow'] }),
      qc.invalidateQueries({ queryKey: ['spending'] }),
      qc.invalidateQueries({ queryKey: ['budgets'] }),
      qc.invalidateQueries({ queryKey: ['investments'] }),
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
    // Recategorizing changes spending, budgets and cash flow too.
    onSuccess: () =>
      Promise.all(
        [['transactions'], ['cashflow'], ['spending'], ['budgets']].map((queryKey) => qc.invalidateQueries({ queryKey })),
      ),
  });
}

export function useInsurancePolicies() {
  return useQuery({ queryKey: keys.insurance, queryFn: () => api<InsurancePolicy[]>('/insurance') });
}

export function useInsurancePolicy(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.insurance, id],
    queryFn: () => api<InsurancePolicy>(`/insurance/${id}`),
    enabled: !!id,
  });
}

export function useSavePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: InsurancePolicyInput }) =>
      api<InsurancePolicy>(id ? `/insurance/${id}` : '/insurance', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.insurance }),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/insurance/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.insurance }),
  });
}

/** Uploads a policy PDF and returns a draft to review; nothing is saved yet. */
export function useExtractPolicy() {
  return useMutation({
    mutationFn: (form: FormData) => api<PolicyExtraction>('/insurance/extract', { method: 'POST', body: form }),
  });
}

/** Drops an uploaded document whose draft was abandoned. */
export function discardDocument(documentId: string) {
  return api(`/documents/${documentId}`, { method: 'DELETE' }).catch(() => undefined);
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: () => api<UserProfile>('/profile') });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: UserProfile) => api<UserProfile>('/profile', { method: 'PUT', body: JSON.stringify(profile) }),
    onSuccess: (saved) => qc.setQueryData(keys.profile, saved),
  });
}

export function useChatSessions() {
  return useQuery({ queryKey: keys.chatSessions, queryFn: () => api<ChatSessionSummary[]>('/chat/sessions') });
}

export function useChatSession(id: string) {
  return useQuery({ queryKey: keys.chatSession(id), queryFn: () => api<ChatSessionDetail>(`/chat/sessions/${id}`) });
}

export function useCreateChatSession() {
  return useMutation({ mutationFn: () => api<ChatSessionSummary>('/chat/sessions', { method: 'POST' }) });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/chat/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chatSessions }),
  });
}
