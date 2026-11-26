import type { ChatModelList, ChatSessionDetail, ChatStreamEvent } from '@meld/shared';
import type { PlaidApi } from 'plaid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { maskNumbers } from '../ai/chat-tools';
import type { AIProvider, ChatTurnInput } from '../ai/provider';
import { loadEnv } from '../env';
import { buildServer } from '../server';
import type { DocumentStorage } from '../storage';
import { setupTestDb, testDatabaseUrl } from '../test/db';
import { toViews } from './chat';

describe('maskNumbers', () => {
  it('masks long digit runs but leaves dates and amounts alone', () => {
    expect(
      maskNumbers({
        name: 'ACH PAYMENT 1234567890123 THANK YOU',
        card: 'Card 4111 1111 1111 1234',
        date: '2026-10-26',
        amount: 1234567890,
      }),
    ).toEqual({ name: 'ACH PAYMENT ••••0123 THANK YOU', card: 'Card ••••1234', date: '2026-10-26', amount: 1234567890 });
  });
});

describe('toViews', () => {
  const row = (role: 'user' | 'assistant', display: { text: string; lookups: string[] } | null, i: number) => ({
    id: `m${i}`,
    role,
    content: { provider: 'x', native: [], display },
    createdAt: new Date(2026, 0, 1, 0, 0, i),
  });

  it('folds tool rounds into one assistant message and skips tool results', () => {
    const views = toViews([
      row('user', { text: 'Q', lookups: [] }, 0),
      row('assistant', { text: '', lookups: ['A'] }, 1),
      row('user', null, 2),
      row('assistant', { text: 'Answer', lookups: ['B'] }, 3),
      row('user', { text: 'Q2', lookups: [] }, 4),
    ]);
    expect(views.map((v) => [v.role, v.text, v.lookups])).toEqual([
      ['user', 'Q', []],
      ['assistant', 'Answer', ['A', 'B']],
      ['user', 'Q2', []],
    ]);
  });
});

/** Answers with one lookup, recording what it was given. */
function fakeProvider(calls: ChatTurnInput[]): AIProvider {
  return {
    name: 'fake',
    listChatModels: async () => [
      { model: 'big', label: 'Big', note: null, local: false },
      { model: 'small', label: 'Small', note: 'Cheap', local: false },
    ],
    extractInsurancePolicy: () => Promise.reject(new Error('not used')),
    extractEquityGrantFromPdf: () => Promise.reject(new Error('not used')),
    extractEquityGrantFromText: () => Promise.reject(new Error('not used')),
    estimatePropertyValue: () => Promise.reject(new Error('not used')),
    estimateVehicleValue: () => Promise.reject(new Error('not used')),
    profileSecurities: () => Promise.reject(new Error('not used')),
    async chat(input) {
      calls.push(input);
      input.onEvent({ type: 'lookup', label: 'Checked accounts' });
      input.onEvent({ type: 'text', text: 'Hello ' });
      input.onEvent({ type: 'text', text: 'there' });
      return {
        outcome: 'complete',
        messages: [
          { role: 'user', content: { provider: 'fake', native: input.userText, display: { text: input.userText, lookups: [] } } },
          { role: 'assistant', content: { provider: 'fake', native: 'call', display: { text: '', lookups: ['Checked accounts'] } } },
          { role: 'user', content: { provider: 'fake', native: 'result', display: null } },
          { role: 'assistant', content: { provider: 'fake', native: 'answer', display: { text: 'Hello there', lookups: [] } } },
        ],
      };
    },
  };
}

function parseSse(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

describe.skipIf(!testDatabaseUrl)('chat routes (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let headers: Record<string, string>;
  const calls: ChatTurnInput[] = [];

  beforeAll(async () => {
    ctx = await setupTestDb();
    const env = loadEnv({ ...process.env, DATABASE_URL: testDatabaseUrl, OLLAMA_URL: '' });
    const plaid = {} as PlaidApi;
    app = await buildServer({
      env,
      db: ctx.db,
      plaid,
      sync: { db: ctx.db, plaid, encryptionKey: env.ENCRYPTION_KEY },
      ai: fakeProvider(calls),
      storage: {} as DocumentStorage,
    });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { passphrase: env.APP_PASSPHRASE } });
    headers = { authorization: `Bearer ${login.json().token}` };
  });
  afterAll(async () => {
    await app?.close();
    await ctx?.sql.end();
  });
  beforeEach(async () => {
    await ctx.reset();
    calls.length = 0;
  });

  it('streams an answer, saves the turn in order, and replays history next time', async () => {
    const session = (await app.inject({ method: 'POST', url: '/chat/sessions', headers })).json();
    const send = (text: string) =>
      app.inject({ method: 'POST', url: `/chat/sessions/${session.id}/messages`, headers, payload: { text } });

    const first = await send('How am I doing?');
    expect(first.headers['content-type']).toBe('text/event-stream');
    const events = parseSse(first.body);
    expect(events.map((e) => e.type)).toEqual(['lookup', 'text', 'text', 'done']);
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: 'done' }>;
    expect(done.message).toMatchObject({ role: 'assistant', text: 'Hello there', lookups: ['Checked accounts'] });
    expect(done.title).toBe('How am I doing?');
    expect(calls[0]!.snapshot).toContain('Snapshot of the person');
    expect(calls[0]!.model).toBe('big');

    await send('And next month?');
    expect(calls[1]!.history.map((m) => m.content.native)).toEqual(['How am I doing?', 'call', 'result', 'answer']);

    const detail = (await app.inject({ method: 'GET', url: `/chat/sessions/${session.id}`, headers })).json<ChatSessionDetail>();
    expect(detail.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'How am I doing?'],
      ['assistant', 'Hello there'],
      ['user', 'And next month?'],
      ['assistant', 'Hello there'],
    ]);

    const list = (await app.inject({ method: 'GET', url: '/chat/sessions', headers })).json();
    expect(list).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/chat/sessions/${session.id}`, headers });
    expect((await app.inject({ method: 'GET', url: '/chat/sessions', headers })).json()).toEqual([]);
  });

  it('lists chat models and answers with the one picked', async () => {
    const list = (await app.inject({ method: 'GET', url: '/chat/models', headers })).json<ChatModelList>();
    expect(list.defaultId).toBe('fake:big');
    expect(list.models.map((m) => [m.id, m.label, m.note])).toEqual([
      ['fake:big', 'Big', null],
      ['fake:small', 'Small', 'Cheap'],
    ]);

    const session = (await app.inject({ method: 'POST', url: '/chat/sessions', headers, payload: { page: 'your retirement plan', model: 'fake:small' } })).json();
    const send = (model: string) =>
      app.inject({ method: 'POST', url: `/chat/sessions/${session.id}/messages`, headers, payload: { text: 'Hi', model } });
    await send('fake:small');
    expect(calls.at(-1)!.model).toBe('small');
    expect(calls.at(-1)!.snapshot).toContain('your retirement plan');

    const unknown = await send('fake:huge');
    expect(unknown.statusCode).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('saves and validates the profile', async () => {
    const profile = {
      displayName: 'Alex',
      birthYear: 1988,
      filingStatus: 'married_joint',
      state: 'ca',
      dependents: 2,
      children: [{ id: 'k1', name: 'Sam', birthYear: 2019 }],
      annualGrossIncome: 240000,
      occupation: 'Engineer',
      employerBenefits: '401k match 4%',
      goals: null,
    };
    const saved = await app.inject({ method: 'PUT', url: '/profile', headers, payload: profile });
    expect(saved.json()).toEqual({ ...profile, state: 'CA' });
    expect((await app.inject({ method: 'GET', url: '/profile', headers })).json().state).toBe('CA');
    const bad = await app.inject({ method: 'PUT', url: '/profile', headers, payload: { ...profile, state: 'California' } });
    expect(bad.statusCode).toBe(400);
  });
});
