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

/** A model the Ask chat can answer with. */
export type ChatModelOption = {
  /** `<provider>:<model>`, e.g. `anthropic:claude-haiku-5-5` or `ollama:qwen3.5:latest`. */
  id: string;
  provider: string;
  label: string;
  /** Short hint shown next to the label, e.g. "Lowest cost". */
  note: string | null;
  /** True when the model runs on this machine, so nothing is sent to an outside service. */
  local: boolean;
};

export type ChatModelList = { models: ChatModelOption[]; defaultId: string | null };

export const ChatCreateSessionRequest = z
  .object({
    /** Current screen context when started from the UI (e.g. "your retirement plan"). */
    page: z.string().trim().max(100).optional(),
    /** Selected ChatModelOption id, so session creation validates only that provider. */
    model: z.string().max(200).optional(),
  })
  .optional();
export type ChatCreateSessionRequest = z.infer<typeof ChatCreateSessionRequest>;

export const ChatSendRequest = z.object({
  text: z.string().trim().min(1).max(8000),
  /** A ChatModelOption id; the default model when omitted. */
  model: z.string().max(200).optional(),
});
export type ChatSendRequest = z.infer<typeof ChatSendRequest>;

/** Server-sent events while an answer streams. */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'lookup'; label: string }
  | { type: 'done'; message: ChatMessageView; title: string | null }
  | { type: 'error'; error: string };
