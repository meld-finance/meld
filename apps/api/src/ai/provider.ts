import type { EquityGrantInput, InsurancePolicyInput, PropertyEstimate, SecurityProfile, VehicleDetails, VehicleEstimate } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { AnthropicProvider } from './anthropic';
import { OpenRouterProvider } from './openrouter';
import type { ChatTool } from './chat-tools';
import type { SecurityDescription } from './security-profiles';

export type ExtractedPolicy = {
  draft: Omit<InsurancePolicyInput, 'documentId'>;
  warnings: string[];
};

export type ExtractedEquityGrant = {
  draft: Omit<EquityGrantInput, 'documentId'>;
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
  /** The provider's own model name, from listChatModels. */
  model: string;
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

/** A model a ChatProvider offers in the Ask model picker. */
export type ChatModelInfo = { model: string; label: string; note: string | null; local: boolean };

/** Answers Ask chat messages. Local models (Ollama) only do chat, so it stands apart from AIProvider. */
export interface ChatProvider {
  readonly name: string;
  listChatModels(): Promise<ChatModelInfo[]>;
  /** Answers one user message, calling tools as needed and streaming text through onEvent. */
  chat(input: ChatTurnInput): Promise<ChatTurnResult>;
}

/**
 * The LLM-backed features Meld uses, independent of vendor: Anthropic or OpenRouter,
 * picked with AI_PROVIDER when both keys are set.
 */
export interface AIProvider extends ChatProvider {
  /** Reads an insurance policy PDF into a draft for the user to review. */
  extractInsurancePolicy(pdf: Buffer): Promise<ExtractedPolicy>;
  /** Reads an RSU grant PDF into a draft for the user to review. */
  extractEquityGrantFromPdf(pdf: Buffer): Promise<ExtractedEquityGrant>;
  /** Parses a pasted RSU grant / vesting table into a draft for the user to review. */
  extractEquityGrantFromText(text: string): Promise<ExtractedEquityGrant>;
  /** Looks up a property's market value on real estate sites. */
  estimatePropertyValue(address: string): Promise<PropertyEstimate>;
  /** Looks up a used vehicle's private-party value on car pricing sites. */
  estimateVehicleValue(vehicle: VehicleDetails): Promise<VehicleEstimate>;
  /** Estimates what each security holds, by input position; null for one it doesn't recognize. */
  profileSecurities(securities: SecurityDescription[]): Promise<(SecurityProfile | null)[]>;
}

export function createAnthropicProvider(env: Env): AnthropicProvider | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new AnthropicProvider(
    env.ANTHROPIC_API_KEY,
    env.ANTHROPIC_MODEL,
    env.ANTHROPIC_LOOKUP_MODEL,
    [env.ANTHROPIC_CHAT_MODEL, ...env.ANTHROPIC_CHAT_MODELS],
    env.ANTHROPIC_CHAT_EFFORT || undefined,
  );
}

export function createOpenRouterProvider(env: Env): OpenRouterProvider | null {
  if (!env.OPENROUTER_API_KEY) return null;
  return new OpenRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_CHAT_MODELS, {
    model: env.OPENROUTER_MODEL,
    lookupModel: env.OPENROUTER_LOOKUP_MODEL,
  });
}

/**
 * The provider for PDF reading, value lookups and fund make-up: AI_PROVIDER's when both keys
 * are set, else whichever is. Null when neither is, so AI features can say so instead of failing.
 */
export function createAIProvider(env: Env): AIProvider | null {
  const anthropic = createAnthropicProvider(env);
  const openrouter = createOpenRouterProvider(env);
  return env.AI_PROVIDER === 'openrouter' ? (openrouter ?? anthropic) : (anthropic ?? openrouter);
}

export function requireAI(ai: AIProvider | null): AIProvider {
  if (!ai) throw new HttpError(503, 'AI isn’t set up. Add an Anthropic or OpenRouter API key in Settings → AI.');
  return ai;
}
