import type {
  CreateScenario,
  RetirementPlan,
  RetirementScenario,
  RetirementSummary,
  SavedSimulation,
  SimulationSettings,
  TaxPlan,
  TaxSettings,
  UpdateScenario,
  UserProfile,
} from '@meld/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

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

/** Ticks a year-end checklist item, showing it at once and rolling back on failure. */
export function useSetChecklistDone(year: number) {
  const qc = useQueryClient();
  const key = [...keys.tax, year];
  return useMutation({
    mutationFn: (change: { id: string; done: boolean }) =>
      api<{ done: string[] }>(`/tax/checklist?year=${year}`, { method: 'PUT', body: JSON.stringify(change) }),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TaxPlan>(key);
      if (previous) {
        qc.setQueryData<TaxPlan>(key, { ...previous, checklist: previous.checklist.map((c) => (c.id === id ? { ...c, done } : c)) });
      }
      return { previous };
    },
    onError: (_e, _v, context) => context?.previous && qc.setQueryData(key, context.previous),
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
