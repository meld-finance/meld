import type {
  EquityGrant,
  EquityGrantExtraction,
  EquityGrantInput,
  EquitySummary,
  EquityVestConfirmInput,
} from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

export function useEquity() {
  return useQuery({ queryKey: keys.equity, queryFn: () => api<EquitySummary>('/equity') });
}

export function useEquityGrant(id: string | undefined) {
  return useQuery({
    queryKey: [...keys.equity, id],
    queryFn: () => api<EquityGrant>(`/equity/${id}`),
    enabled: !!id,
  });
}

function useInvalidateEquity() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.equity }),
      qc.invalidateQueries({ queryKey: keys.tax }),
      qc.invalidateQueries({ queryKey: ['investments'] }),
    ]);
}

export function useSaveEquityGrant() {
  const invalidate = useInvalidateEquity();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EquityGrantInput }) =>
      api<EquityGrant>(id ? `/equity/${id}` : '/equity', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteEquityGrant() {
  const invalidate = useInvalidateEquity();
  return useMutation({
    mutationFn: (id: string) => api(`/equity/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useConfirmEquityVest() {
  const invalidate = useInvalidateEquity();
  return useMutation({
    mutationFn: ({ vestId, input }: { vestId: string; input: EquityVestConfirmInput }) =>
      api<EquityGrant>(`/equity/vests/${vestId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useExtractEquityPdf() {
  return useMutation({
    mutationFn: (form: FormData) => api<EquityGrantExtraction>('/equity/extract', { method: 'POST', body: form }),
  });
}

export function useExtractEquityText() {
  return useMutation({
    mutationFn: (text: string) =>
      api<EquityGrantExtraction>('/equity/extract-text', { method: 'POST', body: JSON.stringify({ text }) }),
  });
}
