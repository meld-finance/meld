import type { ChatModelList, ChatModelOption } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { ChatGPTProvider } from './chatgpt';
import type { ChatGPTAuth } from './chatgpt-auth';
import { OllamaProvider } from './ollama';
import { createAnthropicProvider, createOpenRouterProvider, type AIProvider, type ChatProvider } from './provider';

const NO_AI_ERROR = 'AI isn’t set up. Sign in with ChatGPT, or add an Anthropic or OpenRouter API key or Ollama, in Settings → AI.';

/** Every model the Ask chat can use, across providers. The first one listed is the default. */
export class ChatModels {
  constructor(private providers: ChatProvider[]) {}

  async list(): Promise<ChatModelList> {
    const lists = await Promise.all(
      this.providers.map(async (p) =>
        (await p.listChatModels()).map(
          (m): ChatModelOption => ({ id: `${p.name}:${m.model}`, provider: p.name, label: m.label, note: m.note, local: m.local }),
        ),
      ),
    );
    const models = lists.flat();
    return { models, defaultId: models[0]?.id ?? null };
  }

  /**
   * The provider and model for an option ID, or the default when none is given.
   * Only queries the targeted provider (or short-circuits on default) to avoid waiting on other providers.
   */
  async resolve(id: string | undefined): Promise<{ provider: ChatProvider; model: string }> {
    if (id !== undefined) {
      const provider = this.providers.find((p) => id.startsWith(`${p.name}:`));
      if (!provider) {
        // Distinguish "no AI set up at all" from "unknown model ID".
        const anyConfigured = (await Promise.all(this.providers.map((p) => p.listChatModels()))).some((m) => m.length > 0);
        throw new HttpError(anyConfigured ? 400 : 503, anyConfigured ? 'That model isn’t available. Pick another one.' : NO_AI_ERROR);
      }
      const model = id.slice(provider.name.length + 1);
      const models = await provider.listChatModels();
      if (!models.some((m) => m.model === model)) {
        throw new HttpError(400, 'That model isn’t available. Pick another one.');
      }
      return { provider, model };
    }

    for (const provider of this.providers) {
      const models = await provider.listChatModels();
      if (models.length > 0) return { provider, model: models[0]!.model };
    }
    throw new HttpError(503, NO_AI_ERROR);
  }
}

export function createChatModels(env: Env, ai: AIProvider | null, chatgpt?: ChatGPTAuth | null): ChatModels {
  const ollama = env.OLLAMA_URL
    ? new OllamaProvider(env.OLLAMA_URL, env.OLLAMA_CHAT_MODELS, env.OLLAMA_CONTEXT_LENGTH, env.OLLAMA_THINK)
    : null;
  // `ai` runs the other AI features; chat also offers the cloud provider it didn't pick.
  const anthropic = ai?.name === 'anthropic' ? ai : createAnthropicProvider(env);
  const openrouter = ai?.name === 'openrouter' ? ai : createOpenRouterProvider(env);
  // Any other provider (e.g. one passed in by tests) comes first, as `ai` always did.
  const other = ai && ai !== anthropic && ai !== openrouter ? ai : null;
  // ChatGPT offers models only while signed in, so it's always listed and signing in needs no restart.
  const providers: (ChatProvider | null)[] = [other, anthropic, chatgpt ? new ChatGPTProvider(chatgpt) : null, openrouter, ollama];
  return new ChatModels(providers.filter((p): p is ChatProvider => p !== null));
}
