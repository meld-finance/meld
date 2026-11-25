import type {
  BalanceSnapshot,
  BudgetStatus,
  BudgetUpsert,
  CashflowMonth,
  CashflowPeriod,
  CategoryDetail,
  CategoryMonth,
  CategorySpend,
  ManualAsset,
  ManualAssetInput,
  NetWorthPoint,
  NetWorthSummary,
  PropertyEstimate,
  VehicleDetails,
  VehicleEstimate,
} from '@meld/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

export function useNetWorth() {
  return useQuery({ queryKey: keys.netWorth, queryFn: () => api<NetWorthSummary>('/networth') });
}

export function useNetWorthHistory(days = 365) {
  return useQuery({
    queryKey: keys.netWorthHistory(days),
    queryFn: () => api<NetWorthPoint[]>(`/networth/history?days=${days}`),
    placeholderData: keepPreviousData,
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
