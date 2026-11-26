import type { TransactionQuery } from '@meld/shared';
import { useQueryClient } from '@tanstack/react-query';

export const PAGE_SIZE = 100;

export const keys = {
  features: ['features'] as const,
  releases: ['releases'] as const,
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
  equity: ['equity'] as const,
  insurance: ['insurance'] as const,
  chatModels: ['chat', 'models'] as const,
  chatSessions: ['chat', 'sessions'] as const,
  chatSession: (id: string) => ['chat', 'sessions', id] as const,
  profile: ['profile'] as const,
  tax: ['tax'] as const,
  cash: ['cash'] as const,
  recurring: ['recurring'] as const,
  alerts: ['alerts'] as const,
  estate: ['estate'] as const,
  alertSettings: ['alerts', 'settings'] as const,
  retirement: ['retirement'] as const,
  /** null is the active scenario. */
  retirementScenario: (id: string | null) => ['retirement', 'scenario', id ?? 'active'] as const,
  simulations: (scenarioId: string) => ['retirement', 'simulations', scenarioId] as const,
};

/** Anything that changes Plaid data invalidates accounts, items and transactions. */
export function useInvalidateFinancialData() {
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
      qc.invalidateQueries({ queryKey: keys.equity }),
      qc.invalidateQueries({ queryKey: keys.retirement }),
      qc.invalidateQueries({ queryKey: keys.tax }),
      qc.invalidateQueries({ queryKey: keys.cash }),
      qc.invalidateQueries({ queryKey: keys.recurring }),
      qc.invalidateQueries({ queryKey: keys.alerts }),
    ]);
}

/** Recategorizing changes spending, budgets, cash flow and rule counts too. */
export function useInvalidateCategories() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [['transactions'], ['cashflow'], ['spending'], ['budgets'], keys.categoryRules].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}
