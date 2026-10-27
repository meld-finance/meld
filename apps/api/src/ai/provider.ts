import type { InsurancePolicyInput } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { AnthropicProvider } from './anthropic';

export type ExtractedPolicy = {
  draft: Omit<InsurancePolicyInput, 'documentId'>;
  warnings: string[];
};

/**
 * The LLM-backed features Meld uses, independent of vendor. Add an implementation
 * (OpenAI, a local model, ...) and select it with AI_PROVIDER.
 */
export interface AIProvider {
  readonly name: string;
  /** Reads an insurance policy PDF into a draft for the user to review. */
  extractInsurancePolicy(pdf: Buffer): Promise<ExtractedPolicy>;
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
