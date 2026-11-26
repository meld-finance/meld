import type {
  AISettings,
  ChatGPTStatus,
  DemoModeRequest,
  DemoModeResponse,
  McpConfigUpdate,
  McpStatus,
  McpTokenResponse,
  McpUpdateResponse,
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
import { router, type Href } from 'expo-router';

import { api } from './api';
import { endTour, startTour } from './tour';

const RESTART_POLL_MS = 500;
const RESTART_TIMEOUT_MS = 60_000;

const keys = {
  status: ['setup', 'status'] as const,
  settings: ['settings'] as const,
  phone: ['phone-access'] as const,
  chatgpt: ['ai', 'chatgpt'] as const,
  mcp: ['mcp', 'config'] as const,
};
/** How often to check whether the browser has finished signing in with ChatGPT. */
const CHATGPT_POLL_MS = 1_500;

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
      const status = await waitForRestart(true);
      await afterRestart?.(body);
      return status;
    },
    // Everything may look different with new keys (another Plaid environment, AI on or off).
    onSuccess: (status) => {
      qc.setQueryData(keys.status, status);
      if (!status.demo) endTour();
      qc.removeQueries({ type: 'inactive', predicate: (q) => q.queryKey[0] !== 'setup' });
      void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'setup' });
    },
  });
}

export type SwitchDemoInput = DemoModeRequest & {
  /** When entering demo mode: true starts the guided tour, false explores the sandbox on your own. */
  tour?: boolean;
  /** Where to go after switching; defaults to '/'. Pass null to stay on the current screen. */
  redirect?: Href | null;
};

/** Switches between the user's own accounts and the demo household at runtime without restarting. */
export function useSwitchDemoMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SwitchDemoInput) =>
      api<DemoModeResponse>('/demo', {
        method: 'PUT',
        body: JSON.stringify({ enabled: input.enabled, reset: !!input.reset }),
      }),
    onSuccess: (res, input) => {
      const prev = qc.getQueryData<SetupStatus>(keys.status);
      if (prev) {
        qc.setQueryData<SetupStatus>(keys.status, {
          ...prev,
          demo: res.demo,
          plaidReady: res.plaidReady,
          demoAvailable: res.demoAvailable,
        });
      } else {
        void qc.invalidateQueries({ queryKey: keys.status });
      }
      qc.removeQueries({ type: 'inactive', predicate: (q) => q.queryKey[0] !== 'setup' });
      void qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'setup' });
      if (!res.demo) endTour();
      else if (input.tour === true) startTour();
      else if (input.tour === false) endTour();
      if (!(res.demo && input.tour === true) && input.redirect !== null) {
        router.replace(input.redirect ?? '/');
      }
    },
  });
}

export function testPlaidKeys(body: { clientId: string; secret: string; env: PlaidEnvironment }) {
  return api<KeyTestResult>('/setup/test-plaid', { method: 'POST', body: JSON.stringify(body) });
}

export function testAnthropicKey(apiKey: string) {
  return api<KeyTestResult>('/setup/test-anthropic', { method: 'POST', body: JSON.stringify({ apiKey }) });
}

export function testOpenRouterKey(apiKey: string) {
  return api<KeyTestResult>('/setup/test-openrouter', { method: 'POST', body: JSON.stringify({ apiKey }) });
}

export function detectOllama(url: string) {
  return api<OllamaDetectResult>('/setup/detect-ollama', { method: 'POST', body: JSON.stringify({ url }) });
}

export type PlaidForm = { clientId: string; sandboxSecret: string; productionSecret: string; env: PlaidEnvironment };
export type AIForm = Pick<AISettings, 'anthropicApiKey' | 'openrouterApiKey' | 'ollamaUrl' | 'ollamaModels'> & {
  /** OpenRouter model IDs as typed: one per line (commas work too). */
  openrouterModels: string;
};

export const modelsText = (models: readonly string[]) => models.join('\n');

/** The form as the API takes it. */
export function aiSettings(form: AIForm, remove: { anthropic?: boolean; openrouter?: boolean } = {}): AISettings {
  return {
    ...form,
    openrouterModels: form.openrouterModels.split(/[\s,]+/).filter(Boolean),
    removeAnthropicKey: !!remove.anthropic,
    removeOpenRouterKey: !!remove.openrouter,
  };
}

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

/** Sign in with ChatGPT; checks back while a sign-in is waiting on the browser. */
export function useChatGPT() {
  return useQuery({
    queryKey: keys.chatgpt,
    queryFn: () => api<ChatGPTStatus>('/ai/chatgpt'),
    refetchInterval: (q) => (q.state.data?.state === 'pending' ? CHATGPT_POLL_MS : false),
  });
}

/** Signing in or out changes which models Ask Meld offers. */
function useChatGPTMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: keys.chatgpt });
      await qc.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

/** Returns the ChatGPT page to open in the browser. */
export const useStartChatGPTSignIn = () =>
  useChatGPTMutation((_: void) => api<{ authorizeUrl: string }>('/ai/chatgpt/sign-in', { method: 'POST' }));

/** For when the browser isn't on Meld's computer: the address it landed on after signing in. */
export const useFinishChatGPTSignIn = () =>
  useChatGPTMutation((url: string) => api<ChatGPTStatus>('/ai/chatgpt/callback', { method: 'POST', body: JSON.stringify({ url }) }));

export const useChatGPTSignOut = () => useChatGPTMutation((_: void) => api<{ revoked: boolean }>('/ai/chatgpt', { method: 'DELETE' }));

/** Read-only MCP server settings for external agents (Claude Code, Cursor, Codex). */
export function useMcpStatus() {
  return useQuery({ queryKey: keys.mcp, queryFn: () => api<McpStatus>('/mcp/config') });
}

export function useUpdateMcpConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: McpConfigUpdate) =>
      api<McpUpdateResponse>('/mcp/config', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: (res) => qc.setQueryData(keys.mcp, res.status),
  });
}

export function useRotateMcpToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<McpTokenResponse>('/mcp/token', { method: 'POST', body: '{}' }),
    onSuccess: (res) => qc.setQueryData(keys.mcp, res.status),
  });
}

export function useRevokeMcpToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<McpStatus>('/mcp/token', { method: 'DELETE' }),
    onSuccess: (status) => qc.setQueryData(keys.mcp, status),
  });
}
