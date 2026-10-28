import type { ChatModelList, ChatModelOption } from '@meld/shared';
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { OllamaProvider } from './ollama';
import type { AIProvider, ChatProvider } from './provider';

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

  /** The provider and model for an option ID, or the default when none is given. */
  async resolve(id: string | undefined): Promise<{ provider: ChatProvider; model: string }> {
    const { models, defaultId } = await this.list();
    const chosen = id ?? defaultId;
    if (!chosen) throw new HttpError(503, 'AI isn’t set up. Add ANTHROPIC_API_KEY or OLLAMA_URL to .env and restart the API.');
    const option = models.find((m) => m.id === chosen);
    const provider = this.providers.find((p) => p.name === option?.provider);
    if (!option || !provider) throw new HttpError(400, 'That model isn’t available. Pick another one.');
    return { provider, model: option.id.slice(provider.name.length + 1) };
  }
}

export function createChatModels(env: Env, ai: AIProvider | null): ChatModels {
  const ollama = env.OLLAMA_URL ? new OllamaProvider(env.OLLAMA_URL, env.OLLAMA_CHAT_MODELS, env.OLLAMA_CONTEXT_LENGTH) : null;
  const providers: (ChatProvider | null)[] = [ai, ollama];
  return new ChatModels(providers.filter((p): p is ChatProvider => p !== null));
}
