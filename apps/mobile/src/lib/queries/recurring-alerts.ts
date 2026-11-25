import type { AlertList, AlertSettings, AutopayLinkInput, RecurringOverride, RecurringSummary } from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

/** Subscriptions, bills and paychecks Meld detected, autopay health, and what's due soon. */
export function useRecurring() {
  return useQuery({ queryKey: keys.recurring, queryFn: () => api<RecurringSummary>('/recurring') });
}

export function useSaveRecurringOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...override }: RecurringOverride & { key: string }) =>
      api<{ ok: true }>(`/recurring/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(override) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.recurring }),
  });
}

/** Autopay changes what's due and can open or clear alerts, which the API re-checks a moment later. */
function useInvalidateAutopay() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.recurring });
    setTimeout(() => void qc.invalidateQueries({ queryKey: keys.alerts }), 1_500);
  };
}

export function useSaveAutopay() {
  const invalidate = useInvalidateAutopay();
  return useMutation({
    mutationFn: ({ id, ...input }: AutopayLinkInput & { id?: string }) =>
      api<{ id: string }>(id ? `/autopay/${id}` : '/autopay', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useDeleteAutopay() {
  const invalidate = useInvalidateAutopay();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/autopay/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useAlerts() {
  // Alerts can open in the background (each sync), so check now and then while the app is open.
  return useQuery({ queryKey: keys.alerts, queryFn: () => api<AlertList>('/alerts'), refetchInterval: 5 * 60_000 });
}

export function useMarkAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api<{ ok: true }>('/alerts/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useDismissAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dismissed }: { id: string; dismissed: boolean }) =>
      api<{ ok: true }>(`/alerts/${id}/dismiss`, { method: 'POST', body: JSON.stringify({ dismissed }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useCheckAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ opened: number; resolved: number }>('/alerts/check', { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useAlertSettings() {
  return useQuery({ queryKey: keys.alertSettings, queryFn: () => api<AlertSettings>('/alerts/settings') });
}

export function useSaveAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: AlertSettings) => api<AlertSettings>('/alerts/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.alertSettings, saved);
      setTimeout(() => void qc.invalidateQueries({ queryKey: keys.alerts, exact: true }), 1_500);
      // Cushion and paycheck settings change autopay health.
      void qc.invalidateQueries({ queryKey: keys.recurring });
    },
  });
}

export function useTestAlert() {
  return useMutation({
    mutationFn: (ntfyUrl: string) => api<{ ok: true }>('/alerts/test', { method: 'POST', body: JSON.stringify({ ntfyUrl }) }),
  });
}
