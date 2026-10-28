import { z } from 'zod';
import { HttpError } from '../lib/http';
import { MAX_TOOL_ROUNDS, runTool, toolLabel, type ChatTool } from './chat-tools';
import type { ChatModelInfo, ChatProvider, ChatTurnInput, ChatTurnResult, StoredChatMessage } from './provider';

const PROVIDER = 'ollama';
/** How long the installed-model list is reused before asking Ollama again. */
const MODEL_LIST_TTL_MS = 60_000;
const MODEL_LIST_TIMEOUT_MS = 3_000;

type ToolCall = { id?: string; function: { name: string; arguments: unknown } };
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
  tool_call_id?: string;
};
/** One line of a streamed /api/chat response. Thinking arrives in `message.thinking` and isn't kept. */
type ChatChunk = {
  message?: { content?: string; tool_calls?: ToolCall[] };
  done?: boolean;
  done_reason?: string;
  error?: string;
};

function toToolDefinition(t: ChatTool) {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.input, { io: 'input' }) },
  };
}

/** Earlier turns from another provider are replayed as plain text. */
function toMessages(m: StoredChatMessage): Message[] {
  if (m.content.provider === PROVIDER) return m.content.native as Message[];
  return m.content.display?.text ? [{ role: m.role, content: m.content.display.text }] : [];
}

/** Some models send arguments as a JSON string rather than an object. */
function parseArguments(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** Reads a newline-delimited JSON stream. */
async function* readLines<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as T;
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

function isLoopback(url: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
}

/** Chat through a local (or self-hosted) Ollama server. Only models that support tool calling can answer. */
export class OllamaProvider implements ChatProvider {
  readonly name = PROVIDER;
  private local: boolean;
  private cached: { at: number; models: ChatModelInfo[] } | null = null;

  /** `models` empty means every installed model that supports tools. */
  constructor(
    private baseUrl: string,
    private models: string[],
    private contextLength: number,
  ) {
    this.local = isLoopback(baseUrl);
  }

  /** Empty when Ollama isn't running, so the picker just leaves it out. */
  async listChatModels(): Promise<ChatModelInfo[]> {
    if (this.cached && Date.now() - this.cached.at < MODEL_LIST_TTL_MS) return this.cached.models;
    try {
      const names = this.models.length ? this.models : await this.toolCapableModels();
      const models = names.map((model) => ({ model, label: model, note: this.local ? 'Local, free' : 'Ollama', local: this.local }));
      this.cached = { at: Date.now(), models };
      return models;
    } catch {
      return [];
    }
  }

  private async toolCapableModels(): Promise<string[]> {
    const signal = AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS);
    const tags = (await (await this.request('/api/tags', undefined, signal)).json()) as { models: { name: string }[] };
    const shown = await Promise.all(
      tags.models.map(async ({ name }) => {
        const res = await this.request('/api/show', { model: name }, signal).catch(() => null);
        const info = (await res?.json()) as { capabilities?: string[] } | undefined;
        return info?.capabilities?.includes('tools') ? name : null;
      }),
    );
    return shown.filter((n): n is string => n !== null).sort();
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new HttpError(503, `Can’t reach Ollama at ${this.baseUrl}. Is it running?`);
    }
    if (!res.ok) {
      const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new HttpError(502, error ? `Ollama: ${error}` : `Ollama request failed (${res.status}).`);
    }
    return res;
  }

  async chat({ model, system, snapshot, history, userText, tools, onEvent, signal }: ChatTurnInput): Promise<ChatTurnResult> {
    const toolDefs = tools.map(toToolDefinition);
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const userMessage: Message = { role: 'user', content: userText };
    const messages: Message[] = [{ role: 'system', content: `${system}\n\n${snapshot}` }, ...history.flatMap(toMessages), userMessage];
    const stored: StoredChatMessage[] = [
      { role: 'user', content: { provider: PROVIDER, native: [userMessage], display: { text: userText, lookups: [] } } },
    ];
    let streamedText = false;

    for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
      const res = await this.request(
        '/api/chat',
        { model, messages, tools: toolDefs, stream: true, options: { num_ctx: this.contextLength } },
        signal,
      );
      let text = '';
      const toolCalls: ToolCall[] = [];
      let doneReason: string | undefined;
      for await (const chunk of readLines<ChatChunk>(res.body!)) {
        if (chunk.error) throw new HttpError(502, `Ollama: ${chunk.error}`);
        const piece = chunk.message?.content;
        if (piece) {
          // Separate answer text that resumes after a tool call.
          if (streamedText && !text) onEvent({ type: 'text', text: '\n\n' });
          text += piece;
          streamedText = true;
          onEvent({ type: 'text', text: piece });
        }
        if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls);
        if (chunk.done) doneReason = chunk.done_reason;
      }

      if (doneReason === 'length' && toolCalls.length) throw new HttpError(502, 'The answer was cut off. Try a narrower question.');

      const calls = toolCalls.map((c) => ({ ...c, input: parseArguments(c.function.arguments) }));
      const lookups = calls.map((c) => toolLabel(toolsByName.get(c.function.name), c.function.name, c.input));
      const assistant: Message = { role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
      messages.push(assistant);
      stored.push({ role: 'assistant', content: { provider: PROVIDER, native: [assistant], display: { text, lookups } } });

      if (doneReason === 'length') return { messages: stored, outcome: 'truncated' };
      if (!calls.length) return { messages: stored, outcome: 'complete' };

      lookups.forEach((label) => onEvent({ type: 'lookup', label }));
      const results: Message[] = await Promise.all(
        calls.map(async (c) => {
          const r = await runTool(toolsByName.get(c.function.name), c.input);
          return {
            role: 'tool' as const,
            tool_name: c.function.name,
            ...(c.id ? { tool_call_id: c.id } : {}),
            content: r.isError ? `Error: ${r.content}` : r.content,
          };
        }),
      );
      messages.push(...results);
      stored.push({ role: 'user', content: { provider: PROVIDER, native: results, display: null } });
    }
    return { messages: stored, outcome: 'step_limit' };
  }
}
