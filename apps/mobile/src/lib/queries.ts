import type {
  AppFeatures,
  UploadedDocument,
  Account,
  AccountDetail,
  BalanceSnapshot,
  AccountUpdate,
  InvestmentIncome,
  InvestmentPerformance,
  InvestmentsSummary,
  BudgetStatus,
  BudgetUpsert,
  CashflowMonth,
  CashPlan,
  CashSettings,
  CashflowPeriod,
  CategoryDetail,
  CategoryMonth,
  CategoryRule,
  CategoryRuleCreate,
  CategoryRuleResult,
  CategorySpend,
  ChatModelList,
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
  ProfileResult,
  PropertyEstimate,
  PlaidItemSummary,
  CreateScenario,
  RetirementPlan,
  RetirementScenario,
  RetirementSummary,
  SavedSimulation,
  SimulationSettings,
  UpdateScenario,
  SyncResult,
  TaxPlan,
  TaxSettings,
  TransactionPage,
  TransactionQuery,
  TransactionUpdate,
  UserProfile,
  VehicleDetails,
  VehicleEstimate,
} from '@meld/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

const PAGE_SIZE = 100;

export const keys = {
  features: ['features'] as const,
  accounts: ['accounts'] as const,
  items: ['items'] as const,
  transactions: (q: Omit<TransactionQuery, 'limit' | 'offset'>) => ['transactions', q] as const,
  categories: ['transactions', 'categories'] as const,
  subcategories: (category: string) => ['transactions', 'subcategories', category] as const,
  categoryRules: ['category-rules'] as const,
  netWorth: ['networth'] as const,
  netWorthHistory: (days: number) => ['networth', 'history', days] as const,
  netWorthCompare: (days: number) => ['networth', 'compare', days] as const,
  cashflow: (months: number) => ['cashflow', months] as const,
  cashflowPeriod: (from: string, to: string) => ['cashflow', 'period', from, to] as const,
  cashflowCategories: (months: number, end: string) => ['cashflow', 'categories', months, end] as const,
  categoryDetail: (category: string, from: string, to: string) => ['cashflow', 'category', category, from, to] as const,
  spending: (month: string) => ['spending', month] as const,
  budgets: (month: string) => ['budgets', month] as const,
  manualAssets: ['manual-assets'] as const,
  insurance: ['insurance'] as const,
  chatModels: ['chat', 'models'] as const,
  chatSessions: ['chat', 'sessions'] as const,
  chatSession: (id: string) => ['chat', 'sessions', id] as const,
  profile: ['profile'] as const,
  tax: ['tax'] as const,
  cash: ['cash'] as const,
  retirement: ['retirement'] as const,
  /** null is the active scenario. */
  retirementScenario: (id: string | null) => ['retirement', 'scenario', id ?? 'active'] as const,
  simulations: (scenarioId: string) => ['retirement', 'simulations', scenarioId] as const,
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

/** Balances `days` ago, or null when history doesn't reach back that far. */
export function useBalanceComparison(days = 30) {
  return useQuery({
    queryKey: keys.netWorthCompare(days),
    queryFn: () => api<BalanceSnapshot | null>(`/networth/compare?days=${days}`),
  });
}

export function useCashflow(months = 6) {
  return useQuery({ queryKey: keys.cashflow(months), queryFn: () => api<CashflowMonth[]>(`/cashflow?months=${months}`) });
}

/** Cash flow for [from, to] alongside the same dates a year earlier. */
export function useCashflowPeriod(from: string, to: string) {
  return useQuery({
    queryKey: keys.cashflowPeriod(from, to),
    queryFn: () => api<CashflowPeriod>(`/cashflow/period?from=${from}&to=${to}`),
    placeholderData: (previous) => previous,
  });
}

/** Spending by category for the `months` months ending with `end` (YYYY-MM). */
export function useSpendingByMonth(months: number, end: string) {
  return useQuery({
    queryKey: keys.cashflowCategories(months, end),
    queryFn: () => api<CategoryMonth[]>(`/cashflow/categories?months=${months}&end=${end}`),
    placeholderData: (previous) => previous,
  });
}

/** One category's spending by subcategory and merchant for [from, to], against a year earlier. */
export function useCategoryDetail(category: string, from: string, to: string) {
  return useQuery({
    queryKey: keys.categoryDetail(category, from, to),
    queryFn: () =>
      api<CategoryDetail>(`/cashflow/category?${new URLSearchParams({ category, from, to })}`),
  });
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

/** Looks up a used vehicle's private-party value (takes a minute or two). */
export function useEstimateVehicleValue() {
  return useMutation({
    mutationFn: (vehicle: VehicleDetails) =>
      api<VehicleEstimate>('/manual-assets/estimate-vehicle', { method: 'POST', body: JSON.stringify(vehicle) }),
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

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: () => api<string[]>('/transactions/categories') });
}

export function useSubcategories(category: string | null) {
  return useQuery({
    queryKey: keys.subcategories(category ?? ''),
    queryFn: () => api<string[]>(`/transactions/subcategories?${new URLSearchParams({ category: category! })}`),
    enabled: !!category,
  });
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

/** The latest few transactions across every account. */
export function useRecentTransactions(limit: number) {
  return useQuery({
    queryKey: ['transactions', 'recent', limit],
    queryFn: () => api<TransactionPage>(`/transactions?limit=${limit}`),
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
      qc.invalidateQueries({ queryKey: keys.retirement }),
      qc.invalidateQueries({ queryKey: keys.tax }),
      qc.invalidateQueries({ queryKey: keys.cash }),
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

/** Recategorizing changes spending, budgets, cash flow and rule counts too. */
function useInvalidateCategories() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [['transactions'], ['cashflow'], ['spending'], ['budgets'], keys.categoryRules].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, ...update }: TransactionUpdate & { id: string }) =>
      api(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: invalidate,
  });
}

export function useCategoryRules() {
  return useQuery({ queryKey: keys.categoryRules, queryFn: () => api<CategoryRule[]>('/category-rules') });
}

/** Creates a rule, or updates the one with the same pattern. */
export function useSaveCategoryRule() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (rule: CategoryRuleCreate) =>
      api<CategoryRuleResult>('/category-rules', { method: 'POST', body: JSON.stringify(rule) }),
    onSuccess: invalidate,
  });
}

export function useUpdateCategoryRule() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, ...rule }: CategoryRuleCreate & { id: string }) =>
      api<CategoryRuleResult>(`/category-rules/${id}`, { method: 'PATCH', body: JSON.stringify(rule) }),
    onSuccess: invalidate,
  });
}

export function useDeleteCategoryRule() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (id: string) => api(`/category-rules/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
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

/** Stores a PDF to keep with a policy (no AI); it's attached when the policy is saved with its id. */
export function useUploadDocument() {
  return useMutation({
    mutationFn: (form: FormData) => api<UploadedDocument>('/documents', { method: 'POST', body: form }),
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
    onSuccess: (saved) => {
      qc.setQueryData(keys.profile, saved);
      // Retirement defaults and the tax estimate come from the profile.
      void qc.invalidateQueries({ queryKey: keys.retirement });
      void qc.invalidateQueries({ queryKey: keys.tax });
    },
  });
}

/** A year's tax estimate, inputs included. */
export function useTaxPlan(year: number) {
  return useQuery({
    queryKey: [...keys.tax, year],
    queryFn: () => api<TaxPlan>(`/tax?year=${year}`),
    // Switching years keeps the last one on screen until the next arrives.
    placeholderData: keepPreviousData,
  });
}

export function useSaveTaxSettings(year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: TaxSettings) =>
      api<TaxSettings>(`/tax/settings?year=${year}`, { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...keys.tax, year] }),
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

/** A scenario's plan and summary; the active scenario when `scenarioId` is null. */
export function useRetirement(scenarioId: string | null = null) {
  return useQuery({
    queryKey: keys.retirementScenario(scenarioId),
    queryFn: () => api<RetirementSummary>(scenarioId ? `/retirement?scenario=${scenarioId}` : '/retirement'),
    // Switching scenarios keeps the last one on screen until the next arrives.
    placeholderData: keepPreviousData,
  });
}

export function useSaveRetirementPlan(scenarioId: string | null = null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: RetirementPlan) =>
      api<RetirementSummary>(scenarioId ? `/retirement?scenario=${scenarioId}` : '/retirement', { method: 'PUT', body: JSON.stringify(plan) }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.retirementScenario(scenarioId), saved);
      // Every summary lists every scenario's plan for comparing.
      void qc.invalidateQueries({ queryKey: keys.retirement, predicate: (q) => q.queryKey[2] !== (scenarioId ?? 'active') });
    },
  });
}

export function useCreateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScenario) => api<RetirementScenario>('/retirement/scenarios', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.retirement }),
  });
}

export function useUpdateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateScenario & { id: string }) =>
      api<RetirementScenario>(`/retirement/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.retirement }),
  });
}

export function useDeleteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/retirement/scenarios/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.retirement }),
  });
}

export function useSimulations(scenarioId: string) {
  return useQuery({
    queryKey: keys.simulations(scenarioId),
    queryFn: () => api<SavedSimulation[]>(`/retirement/scenarios/${scenarioId}/simulations`),
  });
}

export function useRunSimulation(scenarioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: SimulationSettings) =>
      api<SavedSimulation>(`/retirement/scenarios/${scenarioId}/simulations`, { method: 'POST', body: JSON.stringify(settings) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.simulations(scenarioId) }),
  });
}

export function useDeleteSimulation(scenarioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/retirement/simulations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.simulations(scenarioId) }),
  });
}

export function useChatModels() {
  return useQuery({ queryKey: keys.chatModels, queryFn: () => api<ChatModelList>('/chat/models'), staleTime: 60_000 });
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

/** What this install has set up (e.g. cloud AI); changes only when the API restarts. */
export function useFeatures() {
  return useQuery({ queryKey: keys.features, queryFn: () => api<AppFeatures>('/features'), staleTime: 5 * 60_000 });
}
