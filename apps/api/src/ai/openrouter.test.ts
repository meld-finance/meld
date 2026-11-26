import { AssetClass, BondType, Region, Sector } from '@meld/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '../env';
import { createChatModels } from './chat-models';
import type { ChatTool } from './chat-tools';
import { OpenRouterProvider, testOpenRouterKey } from './openrouter';
import { createAIProvider, type ChatTurnEvent, type ChatTurnInput } from './provider';

/** A streamed chat completion, with a keep-alive comment and split mid-event to test buffering. */
function sse(chunks: object[]): Response {
  const text = `: OPENROUTER PROCESSING\n\n${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`;
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

const delta = (d: object, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason }] });

const balanceTool: ChatTool = {
  name: 'get_balance',
  description: 'Balance of an account',
  input: z.object({ account: z.string() }),
  label: (input) => `Checked ${(input as { account: string }).account}`,
  run: async () => ({ balance: 1200, note: 'Card 4111 1111 1111 1234' }),
};

const turn = (events: ChatTurnEvent[] = []): ChatTurnInput => ({
  model: 'google/gemini-4-carbon',
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

type Request = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function stubFetch(responses: Response[]): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return responses.shift()!;
    }),
  );
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouterProvider.chat', () => {
  it('runs tool calls, streams the answer, and sends reasoning back with the call', async () => {
    const requests = stubFetch([
      sse([
        delta({ reasoning_details: [{ type: 'reasoning.text', index: 0, format: 'google-gemini-v1', text: 'Look up ' }] }),
        delta({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'checking.' }] }),
        delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_balance', arguments: '{"acc' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'ount":"checking"}' } }] }),
        delta({ reasoning_details: [{ type: 'reasoning.encrypted', index: 1, id: 'call_1', data: 'sig' }] }, 'tool_calls'),
      ]),
      sse([delta({ content: 'You have ' }), delta({ content: '$1,200.' }), delta({}, 'stop')]),
    ]);
    const events: ChatTurnEvent[] = [];
    const result = await new OpenRouterProvider('sk-or-key', ['google/gemini-4-carbon']).chat(turn(events));

    expect(result.outcome).toBe('complete');
    expect(events).toEqual([
      { type: 'lookup', label: 'Checked checking' },
      { type: 'text', text: 'You have ' },
      { type: 'text', text: '$1,200.' },
    ]);
    const first = requests[0]!;
    expect(first.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(first.headers.Authorization).toBe('Bearer sk-or-key');
    expect(first.body).toMatchObject({ model: 'google/gemini-4-carbon', stream: true, provider: { data_collection: 'deny' }, reasoning: { effort: 'low' } });
    // Other providers' turns come through as text; internal ones are dropped.
    expect((first.body.messages as { role: string; content: string }[]).map((m) => [m.role, m.content])).toEqual([
      ['system', 'SYSTEM\n\nSNAPSHOT'],
      ['user', 'Earlier question'],
      ['user', 'What is my checking balance?'],
    ]);

    const replay = (requests[1]!.body.messages as object[]).slice(-2);
    expect(replay[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_balance', arguments: '{"account":"checking"}' } }],
      reasoning_details: [
        { type: 'reasoning.text', index: 0, format: 'google-gemini-v1', text: 'Look up checking.' },
        { type: 'reasoning.encrypted', index: 1, id: 'call_1', data: 'sig' },
      ],
    });
    expect(replay[1]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    // Tool results are masked like every other provider's.
    expect((replay[1] as { content: string }).content).not.toContain('4111 1111 1111');

    expect(result.messages.map((m) => [m.role, m.content.display])).toEqual([
      ['user', { text: 'What is my checking balance?', lookups: [] }],
      ['assistant', { text: '', lookups: ['Checked checking'] }],
      ['user', null],
      ['assistant', { text: 'You have $1,200.', lookups: [] }],
    ]);
  });

  it('replays its own earlier turns as they were', async () => {
    const requests = stubFetch([sse([delta({ content: 'Still $1,200.' }, 'stop')])]);
    const native = [{ role: 'assistant', content: 'You have $1,200.', reasoning_details: [{ type: 'reasoning.encrypted', data: 'x' }] }];
    await new OpenRouterProvider('k', []).chat({
      ...turn(),
      history: [{ role: 'assistant', content: { provider: 'openrouter', native, display: { text: 'You have $1,200.', lookups: [] } } }],
    });
    expect((requests[0]!.body.messages as object[])[1]).toEqual(native[0]);
  });

  it('retries without the reasoning setting when a model rejects it', async () => {
    const requests = stubFetch([
      Response.json({ error: { code: 400, message: 'reasoning not supported' } }, { status: 400 }),
      sse([delta({ content: 'Hi' }, 'stop')]),
      sse([delta({ content: 'Hi again' }, 'stop')]),
    ]);
    const provider = new OpenRouterProvider('k', []);
    await provider.chat(turn());
    await provider.chat(turn());
    expect(requests.map((r) => 'reasoning' in r.body)).toEqual([true, false, false]);
  });

  it.each([
    [401, 'didn’t accept the API key'],
    [402, 'out of credits'],
    [404, 'doesn’t keep your data'],
    [429, 'rate limiting'],
  ])('explains a %i', async (status, message) => {
    stubFetch([Response.json({ error: { code: status, message: 'nope' } }, { status })]);
    await expect(new OpenRouterProvider('k', []).chat(turn())).rejects.toThrow(message);
  });

  it('reports an error sent mid-answer', async () => {
    stubFetch([sse([delta({ content: 'You ' }), { error: { code: 502, message: 'Provider disconnected' }, ...delta({ content: '' }, 'error') }])]);
    await expect(new OpenRouterProvider('k', []).chat(turn())).rejects.toThrow('Provider disconnected');
  });

  it('marks a cut-off or filtered answer', async () => {
    stubFetch([sse([delta({ content: 'Partial' }, 'length')]), sse([delta({}, 'content_filter')])]);
    const provider = new OpenRouterProvider('k', []);
    expect((await provider.chat(turn())).outcome).toBe('truncated');
    expect((await provider.chat(turn())).outcome).toBe('refused');
  });
});

describe('OpenRouterProvider.listChatModels', () => {
  it('offers the chosen models that can call tools, by name', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: 'google/gemini-4-carbon', name: 'Google: Gemini 4 Carbon', supported_parameters: ['tools', 'reasoning'] },
          { id: 'acme/no-tools', name: 'Acme: No Tools', supported_parameters: ['temperature'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = new OpenRouterProvider('k', ['google/gemini-4-carbon', 'acme/no-tools', 'gone/model']);
    const expected = [{ model: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon', note: 'OpenRouter', local: false }];
    expect(await provider.listChatModels()).toEqual(expected);
    expect(await provider.listChatModels()).toEqual(expected);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('falls back to the chosen IDs when the catalog can’t be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await new OpenRouterProvider('k', ['google/gemini-4-carbon']).listChatModels()).toEqual([
      { model: 'google/gemini-4-carbon', label: 'google/gemini-4-carbon', note: 'OpenRouter', local: false },
    ]);
  });
});

describe('testOpenRouterKey', () => {
  it('checks the key without spending credits', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ data: { label: 'meld' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await testOpenRouterKey('sk-or-good')).toEqual({ ok: true });
    expect(fetch.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/key');

    fetch.mockResolvedValueOnce(Response.json({ error: { code: 401 } }, { status: 401 }));
    expect(await testOpenRouterKey('sk-or-bad')).toEqual({ ok: false, error: 'OpenRouter didn’t accept that key.' });
    expect(await testOpenRouterKey('')).toMatchObject({ ok: false });
  });
});

describe('OpenRouterProvider tasks', () => {
  const tasks = { model: 'google/gemini-4-carbon', lookupModel: 'google/gemini-4-hydrogen' };
  const catalog = (inputs: string[]) =>
    Response.json({ data: [{ id: 'google/gemini-4-carbon', name: 'Gemini', architecture: { input_modalities: inputs } }] });
  const completion = (content: string, extra: object = {}) =>
    Response.json({ choices: [{ message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }] });
  const cited = { annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.zillow.com/homedetails/1' } }] };

  /** Answers catalog lookups with `catalogResponse` and chat completions in order, recording their bodies. */
  function stubTasks(completions: Response[], catalogResponse: () => Response = () => catalog(['text', 'file'])) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/models')) return catalogResponse();
        bodies.push(JSON.parse(init!.body as string));
        return completions.shift()!;
      }),
    );
    return bodies;
  }

  const policy = {
    type: 'life_term',
    carrier: 'Acme Life',
    policyNumberLast4: '1234',
    insuredName: 'Pat Doe',
    coverageAmount: 500_000,
    benefitPercentOfIncome: null,
    premiumAmount: 40,
    premiumFrequency: 'monthly',
    effectiveDate: '2020-01-01',
    termEndDate: '2040-01-01',
    eliminationPeriodDays: null,
    benefitPeriod: '',
    ownOccupation: null,
    employerProvided: false,
    cashValue: null,
    cashSurrenderValue: null,
    loanBalance: null,
    valuesAsOf: '',
    beneficiaries: [],
    notes: '',
    warnings: [],
  };

  it('reads a policy PDF with the model itself and structured output', async () => {
    const bodies = stubTasks([completion(JSON.stringify(policy))]);
    const result = await new OpenRouterProvider('k', [], tasks).extractInsurancePolicy(Buffer.from('%PDF-1.7'));

    expect(result.draft).toMatchObject({ carrier: 'Acme Life', coverageAmount: 500_000, premiumFrequency: 'monthly' });
    const body = bodies[0]!;
    expect(body.model).toBe('google/gemini-4-carbon');
    expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
    expect(body.provider).toEqual({ data_collection: 'deny', require_parameters: true });
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'policy', strict: true } });
    const [file] = (body.messages as { content: { type: string; file?: { file_data: string } }[] }[])[0]!.content;
    expect(file).toMatchObject({ type: 'file', file: { file_data: `data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}` } });
  });

  it('won’t send a PDF to a model that can’t read files', async () => {
    const bodies = stubTasks([], () => catalog(['text']));
    await expect(new OpenRouterProvider('k', [], tasks).extractInsurancePolicy(Buffer.from('%PDF'))).rejects.toThrow('can’t read PDFs');
    expect(bodies).toHaveLength(0);
  });

  it('explains a refused or unreadable document', async () => {
    stubTasks([completion('', { refusal: 'No.' }), completion('{"carrier": 5}')]);
    const provider = new OpenRouterProvider('k', [], tasks);
    await expect(provider.extractInsurancePolicy(Buffer.from('%PDF'))).rejects.toThrow('declined to read this document');
    await expect(provider.extractInsurancePolicy(Buffer.from('%PDF'))).rejects.toThrow('Enter them by hand');
  });

  it('extracts RSU grant PDFs and pasted vesting tables with structured output', async () => {
    const rawGrant = {
      employer: 'Acme Corp',
      name: '2026 New Hire',
      ticker: 'ACME',
      grantDate: '2026-01-15',
      grantNumberLast4: '4321',
      totalShares: 400,
      manualPrice: null,
      withholdingMethod: 'sell_to_cover',
      vests: [{ vestDate: '2027-01-15', shares: 400, status: 'scheduled', vestPrice: null }],
      notes: '',
      warnings: [],
    };
    const bodies = stubTasks([completion(JSON.stringify(rawGrant)), completion(JSON.stringify(rawGrant))]);
    const provider = new OpenRouterProvider('k', [], tasks);

    const pdfRes = await provider.extractEquityGrantFromPdf(Buffer.from('%PDF-1.7'));
    expect(pdfRes.draft).toMatchObject({ employer: 'Acme Corp', ticker: 'ACME', totalShares: 400 });
    expect(bodies[0]!.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
    expect(bodies[0]!.response_format).toMatchObject({ json_schema: { name: 'equity_grant', strict: true } });

    const textRes = await provider.extractEquityGrantFromText('2027-01-15 400 shares');
    expect(textRes.draft).toMatchObject({ employer: 'Acme Corp', totalShares: 400 });
    expect(bodies[1]!).not.toHaveProperty('plugins');
    expect(bodies[1]!.model).toBe('google/gemini-4-hydrogen');
  });

  const valuation = {
    matchedAddress: '9 Elm St, Springfield, IL',
    squareFeet: 1500,
    estimates: [
      { source: 'Zillow', value: 400_000, url: 'https://www.zillow.com/homedetails/1' },
      { source: 'Redfin', value: 420_000, url: null },
    ],
    comparables: [],
    warnings: [],
  };

  it('looks up a home value with the model’s own search and reads its JSON', async () => {
    const bodies = stubTasks([completion(`Here’s what I found:\n\`\`\`json\n${JSON.stringify(valuation)}\n\`\`\``, cited)]);
    const result = await new OpenRouterProvider('k', [], tasks).estimatePropertyValue('9 Elm St');

    expect(result).toMatchObject({ address: '9 Elm St, Springfield, IL', value: 410_000 });
    expect(bodies[0]).toMatchObject({
      model: 'google/gemini-4-hydrogen',
      plugins: [{ id: 'web', engine: 'native', max_results: 8 }],
      provider: { data_collection: 'deny' },
    });
    expect(bodies[0]).not.toHaveProperty('response_format');
  });

  it('turns an answer that isn’t JSON into structured output without searching again', async () => {
    const bodies = stubTasks([
      completion('Zillow says $400,000 and Redfin $420,000 for 9 Elm St, Springfield, IL.', cited),
      completion(JSON.stringify(valuation)),
    ]);
    const result = await new OpenRouterProvider('k', [], tasks).estimatePropertyValue('9 Elm St');

    expect(result).toMatchObject({ value: 410_000 });
    expect(bodies[1]).not.toHaveProperty('plugins');
    expect(bodies[1]).toMatchObject({ response_format: { json_schema: { name: 'valuation' } }, provider: { require_parameters: true } });
    expect(JSON.stringify(bodies[1]!.messages)).toContain('Zillow says $400,000');
  });

  it('won’t trust a value lookup that didn’t search', async () => {
    stubTasks([completion(JSON.stringify(valuation))]);
    await expect(new OpenRouterProvider('k', [], tasks).estimatePropertyValue('9 Elm St')).rejects.toThrow('didn’t search the web');
  });

  it('looks up a vehicle value the same way', async () => {
    const vehicle = { estimates: [{ source: 'Edmunds', value: 21_000, url: null }, { source: 'KBB', value: 23_000, url: null }], warnings: [] };
    stubTasks([completion(JSON.stringify(vehicle), cited)]);
    const result = await new OpenRouterProvider('k', [], tasks).estimateVehicleValue({
      year: 2021,
      make: 'Toyota',
      model: 'RAV4',
      trim: null,
      mileage: 30_000,
      zip: null,
    });
    expect(result).toMatchObject({ value: 22_000 });
  });

  it('works out what funds hold with structured output and no search', async () => {
    const zeros = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
    const profile = {
      id: 0,
      known: true,
      category: 'US large blend',
      assetClasses: { ...zeros(AssetClass.options), [AssetClass.options[0]!]: 100 },
      sectors: { ...zeros(Sector.options), [Sector.options[0]!]: 100 },
      regions: { ...zeros(Region.options), [Region.options[0]!]: 100 },
      bondTypes: zeros(BondType.options),
      secYield: 0,
      duration: 0,
    };
    const bodies = stubTasks([completion(JSON.stringify({ securities: [profile] }))]);
    const result = await new OpenRouterProvider('k', [], tasks).profileSecurities([
      { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf', subtype: null, sector: null, industry: null },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).not.toBeNull();
    expect(bodies[0]).toMatchObject({ model: 'google/gemini-4-hydrogen', response_format: { json_schema: { name: 'profiles' } } });
    expect(bodies[0]).not.toHaveProperty('plugins');
  });
});

describe('createAIProvider', () => {
  const env = (extra: NodeJS.ProcessEnv) =>
    loadEnv({
      DATABASE_URL: 'postgres://unused@127.0.0.1:5432/unused',
      SESSION_SECRET: 'x'.repeat(32),
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      ...extra,
    });

  it('uses whichever key is set, Anthropic first unless AI_PROVIDER says otherwise', () => {
    expect(createAIProvider(env({}))).toBeNull();
    expect(createAIProvider(env({ OPENROUTER_API_KEY: 'sk-or' }))?.name).toBe('openrouter');
    expect(createAIProvider(env({ ANTHROPIC_API_KEY: 'sk-ant', OPENROUTER_API_KEY: 'sk-or' }))?.name).toBe('anthropic');
    expect(createAIProvider(env({ ANTHROPIC_API_KEY: 'sk-ant', OPENROUTER_API_KEY: 'sk-or', AI_PROVIDER: 'openrouter' }))?.name).toBe('openrouter');
    expect(createAIProvider(env({ ANTHROPIC_API_KEY: 'sk-ant', AI_PROVIDER: 'openrouter' }))?.name).toBe('anthropic');
  });

  it('keeps a provider of another kind passed in as the AI provider', async () => {
    const fake = { ...new OpenRouterProvider('k', []), name: 'fake', listChatModels: async () => [{ model: 'big', label: 'Big', note: null, local: false }] };
    const list = await createChatModels(env({}), fake as never).list();
    expect(list.defaultId).toBe('fake:big');
  });

  it('keeps both cloud providers’ models in Ask Meld', async () => {
    const catalog = { data: [{ id: 'google/gemini-4-carbon', name: 'Google: Gemini 4 Carbon', supported_parameters: ['tools'] }] };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(catalog)));
    const e = env({ ANTHROPIC_API_KEY: 'sk-ant', OPENROUTER_API_KEY: 'sk-or', AI_PROVIDER: 'openrouter' });
    const providers = (await createChatModels(e, createAIProvider(e)).list()).models.map((m) => m.provider);
    expect(new Set(providers)).toEqual(new Set(['anthropic', 'openrouter']));
  });
});
