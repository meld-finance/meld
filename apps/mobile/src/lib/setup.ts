import type {
  AISettings,
  PhoneAccess,
  KeyTestResult,
  OllamaDetectResult,
  PlaidEnvironment,
  SettingsUpdate,
  SettingsView,
  SetupRequest,
  SetupStatus,
} from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

const RESTART_POLL_MS = 500;
const RESTART_TIMEOUT_MS = 60_000;

const keys = { status: ['setup', 'status'] as const, settings: ['settings'] as const, phone: ['phone-access'] as const };

/** Asked before login: whether to show first-run setup. */
export function useSetupStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => api<SetupStatus>('/setup/status'), retry: 2, staleTime: Infinity });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsView>('/settings') });
}

/** Saving settings restarts the API; this waits until it answers again, as `configured` when it should be. */
async function waitForRestart(configured: boolean) {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  // Give the old process a moment to exit, so its answer isn't mistaken for the new one's.
  await new Promise((r) => setTimeout(r, RESTART_POLL_MS * 2));
  while (Date.now() < deadline) {
    const status = await api<SetupStatus>('/setup/status').catch(() => null);
    if (status?.configured === configured) return status;
    await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
  }
  throw new Error('Meld didn’t come back after restarting. Check that it’s still running.');
}

export function useCompleteSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SetupRequest) => {
      await api('/setup', { method: 'POST', body: JSON.stringify(body) });
      return waitForRestart(true);
    },
    onSuccess: (status) => qc.setQueryData(keys.status, status),
  });
}

/** `afterRestart` runs before anything refreshes, e.g. to log in with a passphrase just turned on. */
export function useSaveSettings(afterRestart?: (body: SettingsUpdate) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SettingsUpdate) => {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      await waitForRestart(true);
      await afterRestart?.(body);
    },
    // Everything may look different with new keys (another Plaid environment, AI on or off).
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function testPlaidKeys(body: { clientId: string; secret: string; env: PlaidEnvironment }) {
  return api<KeyTestResult>('/setup/test-plaid', { method: 'POST', body: JSON.stringify(body) });
}

export function testAnthropicKey(apiKey: string) {
  return api<KeyTestResult>('/setup/test-anthropic', { method: 'POST', body: JSON.stringify({ apiKey }) });
}

export function detectOllama(url: string) {
  return api<OllamaDetectResult>('/setup/detect-ollama', { method: 'POST', body: JSON.stringify({ url }) });
}

export type PlaidForm = { clientId: string; sandboxSecret: string; productionSecret: string; env: PlaidEnvironment };
export type AIForm = Pick<AISettings, 'anthropicApiKey' | 'ollamaUrl' | 'ollamaModels'>;

export function usePhoneAccess(enabled: boolean) {
  return useQuery({ queryKey: keys.phone, queryFn: () => api<PhoneAccess>('/phone-access'), enabled });
}

export function useSetPhoneAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api<PhoneAccess>('/phone-access', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: (data) => qc.setQueryData(keys.phone, data),
  });
}
