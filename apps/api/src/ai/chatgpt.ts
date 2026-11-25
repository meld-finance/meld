import { HttpError } from '../lib/http';
import { RESOURCE, type ChatGPTAuth } from './chatgpt-auth';
import { MAX_TOOL_ROUNDS, runTool, toolLabel, toToolJsonSchema, type ChatTool } from './chat-tools';
import type { ChatModelInfo, ChatProvider, ChatTurnInput, ChatTurnResult, StoredChatMessage } from './provider';

const PROVIDER = 'chatgpt';
const MODEL_LIST_TTL_MS = 5 * 60_000;
/** Plan-based requests may only use function tools grouped in a namespace. */
const TOOL_NAMESPACE = 'meld';
export const MANAGE_USAGE_URL = 'https://chatgpt.com/settings/usage';

/** A Responses API input or output item, replayed as is on later turns. */
type Item = { type?: string; id?: string; [key: string]: unknown };
type FunctionCall = { type: 'function_call'; call_id: string; name: string; arguments: string };
type ApiError = { code?: string; message?: string };
type StreamEvent = {
  type: string;
  delta?: string;
  item?: Item;
  response?: { output?: Item[]; incomplete_details?: { reason?: string }; error?: ApiError };
  code?: string;
  message?: string;
  error?: ApiError;
};

/** Messages for the plan errors OpenAI documents; others get a generic one. */
function planError(error: ApiError | undefined, status?: number): HttpError {
  switch (error?.code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new HttpError(429, `You’ve reached your ChatGPT plan’s limit for Meld. Manage usage at ${MANAGE_USAGE_URL}.`);
    case 'subscription_sharing_user_not_eligible':
      return new HttpError(403, 'This ChatGPT account can’t be used in other apps. It takes a Plus or Pro plan.');
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return new HttpError(503, 'ChatGPT plan usage isn’t available right now. Try again in a few minutes.');
    case 'subscription_sharing_unsupported_capability':
      return new HttpError(422, `ChatGPT can’t answer this kind of request${error.message ? `: ${error.message}` : '.'}`);
  }
  if (status === 401) return new HttpError(401, 'ChatGPT didn’t accept Meld’s sign-in. Sign in again in Settings → AI.');
  if (status === 429) return new HttpError(429, `ChatGPT is rate limiting Meld. Try again shortly, or check ${MANAGE_USAGE_URL}.`);
  return new HttpError(502, 'ChatGPT had a problem answering. Try again shortly.');
}

function toFunctionTool(t: ChatTool) {
  // Not strict: strict mode needs every property required, and Meld's tools have optional inputs.
  return { type: 'function', name: t.name, description: t.description, parameters: toToolJsonSchema(t.input), strict: false };
}

/** Earlier turns from another provider are replayed as plain text. */
function toItems(m: StoredChatMessage): Item[] {
  if (m.content.provider === PROVIDER) return m.content.native as Item[];
  return m.content.display?.text ? [{ role: m.role, content: m.content.display.text }] : [];
}

/** Item IDs point at stored responses, and nothing is stored (store: false), so they're left out when replaying. */
const forReplay = ({ id: _id, ...item }: Item): Item => item;

function parseArguments(args: string): unknown {
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** Reads a server-sent event stream's `data:` payloads. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (block: string) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data && data !== '[DONE]') yield JSON.parse(data) as StreamEvent;
  };
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) yield* parse(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield* parse(buffer);
}

/** Ask Meld on the user's ChatGPT plan, through Sign in with ChatGPT. */
export class ChatGPTProvider implements ChatProvider {
  readonly name = PROVIDER;
  private cached: { at: number; account: string; models: ChatModelInfo[] } | null = null;
  private noTuning = new Set<string>();

  constructor(private auth: ChatGPTAuth) {}

  /** Empty when not signed in, so the picker just leaves ChatGPT out. */
  async listChatModels(): Promise<ChatModelInfo[]> {
    const account = this.auth.accountId;
    if (!account) return [];
    if (this.cached?.account === account && Date.now() - this.cached.at < MODEL_LIST_TTL_MS) return this.cached.models;
    try {
      const res = await this.request('/models', undefined, AbortSignal.timeout(5_000));
      const body = (await res.json()) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
      const models = (body.models ?? [])
        .filter((m) => m.visibility === 'list')
        .map((m) => ({ model: m.slug, label: m.display_name ?? m.slug, note: 'ChatGPT plan', local: false }));
      this.cached = { at: Date.now(), account, models };
      return models;
    } catch {
      return [];
    }
  }

  private async rawRequest(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const token = await this.auth.accessToken();
    try {
      return await fetch(`${RESOURCE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new HttpError(503, 'Couldn’t reach ChatGPT. Check your internet connection.');
    }
  }

  private async handleError(res: Response): Promise<never> {
    const error = ((await res.json().catch(() => null)) as { error?: ApiError } | null)?.error;
    if (error?.code === 'subscription_sharing_invalid_user') await this.auth.signedOutRemotely();
    throw planError(error, res.status);
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await this.rawRequest(path, body, signal);
    if (!res.ok) await this.handleError(res);
    return res;
  }

  async chat({ model, system, snapshot, history, userText, tools, onEvent, signal }: ChatTurnInput): Promise<ChatTurnResult> {
    const toolDefs = [
      {
        type: 'namespace',
        name: TOOL_NAMESPACE,
        description: 'Read-only lookups over the user’s financial data and Meld feature guides.',
        tools: tools.map(toFunctionTool),
      },
    ];
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const userItem: Item = { role: 'user', content: userText };
    const input: Item[] = [...history.flatMap(toItems), userItem].map(forReplay);
    // Inject the dynamic per-session snapshot into the first user message so `instructions` stays static and cacheable across sessions.
    if (snapshot && input[0]?.role === 'user' && typeof input[0].content === 'string') {
      input[0] = { ...input[0], content: `${snapshot}\n\n${input[0].content}` };
    }
    const stored: StoredChatMessage[] = [
      { role: 'user', content: { provider: PROVIDER, native: [userItem], display: { text: userText, lookups: [] } } },
    ];
    let streamedText = false;

    for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
      const baseBody = {
        model,
        // System-role items are rejected on this route; instructions carry the static system prompt.
        instructions: system,
        input,
        tools: toolDefs,
        // Plan usage requires both. Encrypted reasoning lets later rounds pick up where this one left off.
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
      };
      const tuned = !this.noTuning.has(model);
      let res = await this.rawRequest(
        '/responses',
        tuned ? { ...baseBody, reasoning: { effort: 'low' }, prompt_cache_key: 'meld-ask-v1' } : baseBody,
        signal,
      );
      if (!res.ok && res.status === 400 && tuned) {
        this.noTuning.add(model);
        res = await this.rawRequest('/responses', baseBody, signal);
      }
      if (!res.ok) await this.handleError(res);

      let text = '';
      const output: Item[] = [];
      let outcome: ChatTurnResult['outcome'] | null = null;
      for await (const event of readEvents(res.body!)) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          // Separate answer text that resumes after a tool call.
          if (streamedText && !text) onEvent({ type: 'text', text: '\n\n' });
          text += event.delta;
          streamedText = true;
          onEvent({ type: 'text', text: event.delta });
        } else if (event.type === 'response.output_item.done' && event.item) {
          output.push(event.item);
          if (event.item.type === 'function_call') {
            const c = event.item as Item & FunctionCall;
            onEvent({ type: 'lookup', label: toolLabel(toolsByName.get(c.name), c.name, parseArguments(c.arguments)) });
          }
        } else if (event.type === 'response.completed') {
          if (!output.length) output.push(...(event.response?.output ?? []));
          outcome = 'complete';
        } else if (event.type === 'response.incomplete') {
          if (!output.length) output.push(...(event.response?.output ?? []));
          outcome = event.response?.incomplete_details?.reason === 'content_filter' ? 'refused' : 'truncated';
        } else if (event.type === 'response.failed') {
          throw planError(event.response?.error);
        } else if (event.type === 'error') {
          throw planError(event.error ?? { code: event.code, message: event.message });
        }
      }
      if (!outcome) throw new HttpError(502, 'ChatGPT’s answer was cut off. Try asking again.');

      const calls = output.filter((i): i is Item & FunctionCall => i.type === 'function_call');
      if (outcome === 'truncated' && calls.length) throw new HttpError(502, 'The answer was cut off. Try a narrower question.');
      const refused = output.some(
        (i) => i.type === 'message' && Array.isArray(i.content) && i.content.some((c: { type?: string }) => c.type === 'refusal'),
      );

      const lookups = calls.map((c) => toolLabel(toolsByName.get(c.name), c.name, parseArguments(c.arguments)));
      input.push(...output.map(forReplay));
      stored.push({ role: 'assistant', content: { provider: PROVIDER, native: output, display: { text, lookups } } });

      if (refused) return { messages: stored, outcome: 'refused' };
      if (outcome !== 'complete' || !calls.length) return { messages: stored, outcome };

      const results: Item[] = await Promise.all(
        calls.map(async (c) => {
          const r = await runTool(toolsByName.get(c.name), parseArguments(c.arguments));
          return { type: 'function_call_output', call_id: c.call_id, output: r.isError ? `Error: ${r.content}` : r.content };
        }),
      );
      input.push(...results);
      stored.push({ role: 'user', content: { provider: PROVIDER, native: results, display: null } });
    }
    return { messages: stored, outcome: 'step_limit' };
  }
}
