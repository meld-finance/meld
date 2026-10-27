import { z } from 'zod';

export type ChatSessionSummary = { id: string; title: string | null; createdAt: string; updatedAt: string };

/** A message as shown in the app. Tool round-trips are folded into the assistant message they belong to. */
export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** What the assistant looked up, e.g. "Checked spending by category". */
  lookups: string[];
  createdAt: string;
};

export type ChatSessionDetail = ChatSessionSummary & { messages: ChatMessageView[] };

export const ChatSendRequest = z.object({ text: z.string().trim().min(1).max(8000) });
export type ChatSendRequest = z.infer<typeof ChatSendRequest>;

/** Server-sent events while an answer streams. */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'lookup'; label: string }
  | { type: 'done'; message: ChatMessageView; title: string | null }
  | { type: 'error'; error: string };
