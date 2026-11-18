import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ChatGPTProvider } from './chatgpt';
import { ChatGPTAuth } from './chatgpt-auth';
import type { ChatTool } from './chat-tools';
import type { ChatTurnEvent } from './provider';

const key = randomBytes(32).toString('base64');
const jwt = (claims: object) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'meld-chatgpt-')), 'chatgpt.json');

/** A streamed Responses API answer, split mid-event to test buffering. */
function sse(events: object[]): Response {
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const mid = Math.floor(text.length / 2);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text.slice(0, mid)));
      controller.enqueue(new TextEncoder().encode(text.slice(mid)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Signs in through the pasted-address path, with OpenAI's token endpoint stubbed. */
async function signIn(auth: ChatGPTAuth, claims: Record<string, unknown> = {}) {
  const url = new URL(await auth.startSignIn());
  const state = url.searchParams.get('state')!;
  const nonce = url.searchParams.get('nonce')!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        id_token: jwt({ iss: 'https://auth.openai.com', aud: 'oaiapp_1', nonce, sub: 'user-1', email: 'me@example.com', ...claims }),
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      }),
    ),
  );
  await auth.finishFromUrl(`http://127.0.0.1:1455/auth/callback?code=c1&state=${state}&client_id=oaiapp_1`);
  return url;
}

const balanceTool: ChatTool = {
  name: 'get_balance',
  description: 'Balance of an account',
  input: z.object({ account: z.string() }),
  label: (input) => `Checked ${(input as { account: string }).account}`,
  run: async () => ({ balance: 1200, note: 'Card 4111 1111 1111 1234' }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ChatGPTAuth', () => {
  it('registers on first sign-in, stores the session encrypted, and reuses the registration', async () => {
    const file = tempFile();
    const auth = new ChatGPTAuth(file, key);
    const url = await signIn(auth);
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('agent_name_hint')).toBe('Meld');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(auth.status()).toEqual({ state: 'signed-in', email: 'me@example.com' });
    expect(readFileSync(file, 'utf8')).not.toContain('access-1');

    const reloaded = new ChatGPTAuth(file, key);
    expect(await reloaded.accessToken()).toBe('access-1');
    const again = new URL(await reloaded.startSignIn());
    expect(again.searchParams.get('client_id')).toBe('oaiapp_1');
    expect(again.searchParams.has('agent_name_hint')).toBe(false);
    reloaded.close();
  });

  it('explains a refused code exchange and keeps the registration for the retry', async () => {
    const file = tempFile();
    const auth = new ChatGPTAuth(file, key);
    const url = new URL(await auth.startSignIn());
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      auth.finishFromUrl(`http://127.0.0.1:1455/auth/callback?code=c1&state=${url.searchParams.get('state')}&client_id=oaiapp_1`),
    ).rejects.toThrow('Free can’t share usage');
    expect(auth.status()).toMatchObject({ state: 'signed-out', error: expect.stringContaining('Go, Plus, Pro or Business') });

    const reloaded = new ChatGPTAuth(file, key);
    const retry = new URL(await reloaded.startSignIn());
    expect(retry.searchParams.get('client_id')).toBe('oaiapp_1');
    expect(retry.searchParams.has('agent_name_hint')).toBe(false);
    reloaded.close();
  });

  it('rejects a sign-in whose ID token doesn’t match the request', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    await expect(signIn(auth, { nonce: 'other' })).rejects.toThrow('didn’t check out');
    expect(auth.status()).toMatchObject({ state: 'signed-out' });
  });

  it('refreshes an expiring token once, even when asked twice at the same time', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    await signIn(auth);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3600_000);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new URLSearchParams(init.body as URLSearchParams).get('refresh_token')).toBe('refresh-1');
      return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await Promise.all([auth.accessToken(), auth.accessToken()])).toEqual(['access-2', 'access-2']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh token is no longer accepted', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    await signIn(auth);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3600_000);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'refresh_token_reused' }, { status: 400 })));
    await expect(auth.accessToken()).rejects.toThrow('Sign in again');
    expect(auth.status()).toMatchObject({ state: 'signed-out', error: expect.stringContaining('ended') });
  });
});

describe('ChatGPTProvider', () => {
  it('runs tool calls, streams the answer, and stores replayable items', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    await signIn(auth);
    const requests: Record<string, unknown>[] = [];
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' };
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_balance', namespace: 'meld', arguments: '{"account":"checking"}' };
    const message = { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'You have $1,200.' }] };
    const responses = [
      sse([
        { type: 'response.output_item.done', item: reasoning },
        { type: 'response.output_item.done', item: call },
        { type: 'response.completed', response: { output: [] } },
      ]),
      sse([
        { type: 'response.output_text.delta', delta: 'You have ' },
        { type: 'response.output_text.delta', delta: '$1,200.' },
        { type: 'response.output_item.done', item: message },
        { type: 'response.completed', response: { output: [] } },
      ]),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.openai.com/v1/responses');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
        requests.push(JSON.parse(init.body as string));
        return responses.shift()!;
      }),
    );

    const events: ChatTurnEvent[] = [];
    const result = await new ChatGPTProvider(auth).chat({
      model: 'gpt-6.1-sol',
      system: 'SYSTEM',
      snapshot: 'SNAPSHOT',
      history: [{ role: 'user', content: { provider: 'anthropic', native: [], display: { text: 'Earlier question', lookups: [] } } }],
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
    expect(requests[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'SYSTEM\n\nSNAPSHOT',
      store: false,
      stream: true,
      input: [
        { role: 'user', content: 'Earlier question' },
        { role: 'user', content: 'What is my checking balance?' },
      ],
      tools: [{ type: 'namespace', name: 'meld', tools: [{ type: 'function', name: 'get_balance', strict: false }] }],
    });
    // The second round replays this round's items without their IDs, then the masked tool result.
    const replayed = (requests[1]!.input as Record<string, unknown>[]).slice(2);
    expect(replayed[0]).toEqual({ type: 'reasoning', summary: [], encrypted_content: 'enc' });
    expect(replayed[1]).not.toHaveProperty('id');
    expect(replayed[2]).toMatchObject({ type: 'function_call_output', call_id: 'call_1' });
    expect(replayed[2]!.output).toContain('••••1234');

    expect(result.messages.map((m) => [m.role, m.content.display?.text ?? null])).toEqual([
      ['user', 'What is my checking balance?'],
      ['assistant', ''],
      ['user', null],
      ['assistant', 'You have $1,200.'],
    ]);
  });

  it('explains a plan usage limit', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    await signIn(auth);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])),
    );
    await expect(
      new ChatGPTProvider(auth).chat({ model: 'm', system: '', snapshot: '', history: [], userText: 'Hi', tools: [], onEvent: () => {} }),
    ).rejects.toThrow('chatgpt.com/settings/usage');
  });

  it('lists listed models while signed in, and none otherwise', async () => {
    const auth = new ChatGPTAuth(tempFile(), key);
    expect(await new ChatGPTProvider(auth).listChatModels()).toEqual([]);
    await signIn(auth);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          models: [
            { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
            { slug: 'internal', display_name: 'Internal', visibility: 'hide' },
          ],
        }),
      ),
    );
    expect(await new ChatGPTProvider(auth).listChatModels()).toEqual([
      { model: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'ChatGPT plan', local: false },
    ]);
  });
});
