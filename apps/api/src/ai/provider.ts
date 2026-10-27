import type { InsurancePolicyInput, PropertyEstimate } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { AnthropicProvider } from './anthropic';
import type { ChatTool } from './chat-tools';

export type ExtractedPolicy = {
  draft: Omit<InsurancePolicyInput, 'documentId'>;
  warnings: string[];
};

/**
 * One stored chat message. `native` is the provider's own message content, replayed
 * unchanged on later turns (some providers require that, e.g. for reasoning blocks).
 * `display` is what the app shows; null for internal messages such as tool results.
 */
export type StoredChatMessage = {
  role: 'user' | 'assistant';
  content: {
    provider: string;
    native: unknown;
    display: { text: string; lookups: string[] } | null;
  };
};

export type ChatTurnEvent = { type: 'text'; text: string } | { type: 'lookup'; label: string };

export type ChatTurnInput = {
  system: string;
  /** Per-session data appended to the system prompt. */
  snapshot: string;
  history: StoredChatMessage[];
  userText: string;
  tools: ChatTool[];
  onEvent: (event: ChatTurnEvent) => void;
  signal?: AbortSignal;
};

export type ChatTurnResult = {
  /** Everything to append to the session, starting with the user's message. */
  messages: StoredChatMessage[];
  /** `refused`: the model declined. `truncated`: hit the output limit. `step_limit`: too many tool rounds. */
  outcome: 'complete' | 'refused' | 'truncated' | 'step_limit';
};

/**
 * The LLM-backed features Meld uses, independent of vendor. Add an implementation
 * (OpenAI, a local model, ...) and select it with AI_PROVIDER.
 */
export interface AIProvider {
  readonly name: string;
  /** Reads an insurance policy PDF into a draft for the user to review. */
  extractInsurancePolicy(pdf: Buffer): Promise<ExtractedPolicy>;
  /** Looks up a property's market value on real estate sites. */
  estimatePropertyValue(address: string): Promise<PropertyEstimate>;
  /** Answers one user message, calling tools as needed and streaming text through onEvent. */
  chat(input: ChatTurnInput): Promise<ChatTurnResult>;
}

/** Returns null when no provider is configured, so AI features can say so instead of failing. */
export function createAIProvider(env: Env): AIProvider | null {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL) : null;
  }
}

export function requireAI(ai: AIProvider | null): AIProvider {
  if (!ai) throw new HttpError(503, 'AI isn’t set up. Add ANTHROPIC_API_KEY to .env and restart the API.');
  return ai;
}
