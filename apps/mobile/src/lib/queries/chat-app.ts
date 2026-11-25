import type {
  AppFeatures,
  ChatCreateSessionRequest,
  ChatModelList,
  ChatSessionDetail,
  ChatSessionSummary,
  ReleaseList,
} from '@meld/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { keys } from './keys';

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: ChatCreateSessionRequest) =>
      api<ChatSessionSummary>('/chat/sessions', { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSuccess: (session) => {
      // Seed the session detail cache so Conversation doesn't wait on GET /chat/sessions/:id before streaming.
      qc.setQueryData<ChatSessionDetail>(keys.chatSession(session.id), { ...session, messages: [] });
    },
  });
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

/** Meld's published releases (from GitHub, cached by the API) and the version running. */
export function useReleases() {
  return useQuery({ queryKey: keys.releases, queryFn: () => api<ReleaseList>('/releases'), staleTime: 30 * 60_000 });
}
