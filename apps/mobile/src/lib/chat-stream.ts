import type { ChatStreamEvent } from '@meld/shared';
import { fetch } from 'expo/fetch';

import { ApiError, getAuthToken, notifyUnauthorized } from './api';
import { API_URL } from './config';

/**
 * Sends a chat message and calls `onEvent` for each server-sent event as the answer streams.
 * Uses expo/fetch, which supports streamed response bodies on native as well as web.
 */
export async function streamChatMessage(
  sessionId: string,
  text: string,
  /** A ChatModelOption id; the server default when null. */
  model: string | null,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, ...(model ? { model } : {}) }),
    signal,
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; keep any partial event for the next chunk.
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) onEvent(JSON.parse(data) as ChatStreamEvent);
    }
  }
}
