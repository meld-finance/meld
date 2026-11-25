import type {
  CategoryRule,
  CategoryRuleCreate,
  CategoryRuleResult,
  TransactionPage,
  TransactionQuery,
  TransactionUpdate,
} from '@meld/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';

import { api } from '../api';
import { keys, PAGE_SIZE, useInvalidateCategories } from './keys';

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
