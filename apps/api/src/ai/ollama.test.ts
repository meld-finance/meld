import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatTool } from './chat-tools';
import { OllamaProvider } from './ollama';
import type { ChatTurnEvent } from './provider';

/** A streamed /api/chat response, one JSON object per line, split mid-line to test buffering. */
function ndjson(chunks: object[]): Response {
  const text = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  const mid = Math.floor(text.length / 2);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text.slice(0, mid)));
      controller.enqueue(new TextEncoder().encode(text.slice(mid)));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const balanceTool: ChatTool = {
  name: 'get_balance',
  description: 'Balance of an account',
  input: z.object({ account: z.string() }),
  label: (input) => `Checked ${(input as { account: string }).account}`,
  run: async () => ({ balance: 1200, note: 'Card 4111 1111 1111 1234' }),
};

afterEach(() => vi.unstubAllGlobals());

describe('OllamaProvider.chat', () => {
  it('runs tool calls, streams the answer, and stores replayable messages', async () => {
    const requests: { messages: { role: string; content: string }[]; options: unknown }[] = [];
    const responses = [
      ndjson([
        { message: { role: 'assistant', content: '', thinking: 'Let me look.' }, done: false },
        { message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'get_balance', arguments: { account: 'checking' } } }] }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
      ndjson([
        { message: { role: 'assistant', content: 'You have ' }, done: false },
        { message: { role: 'assistant', content: '$1,200.' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ]),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        requests.push(JSON.parse(init.body as string));
        return responses.shift()!;
      }),
    );

    const events: ChatTurnEvent[] = [];
    const provider = new OllamaProvider('http://127.0.0.1:11434', [], 8192);
    const result = await provider.chat({
      model: 'qwen3.5:latest',
      system: 'SYSTEM',
      snapshot: 'SNAPSHOT',
      history: [
        { role: 'user', content: { provider: 'anthropic', native: [], display: { text: 'Earlier question', lookups: [] } } },
        { role: 'user', content: { provider: 'anthropic', native: [], display: null } },
      ],
      userText: 'What is my checking balance?',
      tools: [balanceTool],
      onEvent: (e) => events.push(e),
    });

    expect(result.outcome).toBe('complete');
    expect(events).toEqual([
      { type: 'lookup', label: 'Checked checking' },
      { type: 'text', text: 'You have ' },
      { type: 'text', text: '$1,200.' },
    ]);
    expect(requests[0]!.options).toEqual({ num_ctx: 8192 });
    expect(requests[0]).toMatchObject({ think: false });
    // Other providers' turns come through as text; internal ones are dropped.
    expect(requests[0]!.messages.map((m) => [m.role, m.content])).toEqual([
      ['system', 'SYSTEM\n\nSNAPSHOT'],
      ['user', 'Earlier question'],
      ['user', 'What is my checking balance?'],
    ]);
    const toolResult = requests[1]!.messages.at(-1)!;
    expect(toolResult).toMatchObject({ role: 'tool', tool_name: 'get_balance', tool_call_id: 'c1' });
    expect(toolResult.content).toContain('••••1234');

    expect(result.messages.map((m) => [m.role, m.content.display?.text ?? null])).toEqual([
      ['user', 'What is my checking balance?'],
      ['assistant', ''],
      ['user', null],
      ['assistant', 'You have $1,200.'],
    ]);
    expect(result.messages[1]!.content.display?.lookups).toEqual(['Checked checking']);
  });

  it('retries without think: false if Ollama rejects the option', async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        requests.push(body);
        if ('think' in body) {
          return Response.json({ error: 'model does not support think option' }, { status: 400 });
        }
        return ndjson([{ message: { role: 'assistant', content: 'Hi there.' }, done: true, done_reason: 'stop' }]);
      }),
    );

    const provider = new OllamaProvider('http://127.0.0.1:11434', [], 8192);
    const res = await provider.chat({
      model: 'llama3.2',
      system: 'SYS',
      snapshot: '',
      history: [],
      userText: 'Hi',
      tools: [],
      onEvent: () => {},
    });
    expect(res.outcome).toBe('complete');
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toHaveProperty('think');
  });

  it('says when Ollama isn’t reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const provider = new OllamaProvider('http://127.0.0.1:11434', [], 8192);
    await expect(
      provider.chat({ model: 'x', system: '', snapshot: '', history: [], userText: 'Hi', tools: [], onEvent: () => {} }),
    ).rejects.toThrow('Can’t reach Ollama');
    expect(await provider.listChatModels()).toEqual([]);
  });

  it('lists only installed models that support tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'qwen3.5:latest' }, { name: 'nomic-embed-text' }] });
        const { model } = JSON.parse(init.body as string);
        return Response.json({ capabilities: model === 'qwen3.5:latest' ? ['completion', 'tools'] : ['embedding'] });
      }),
    );
    expect(await new OllamaProvider('http://localhost:11434', [], 8192).listChatModels()).toEqual([
      { model: 'qwen3.5:latest', label: 'qwen3.5:latest', note: 'Local, free', local: true },
    ]);
  });
});
