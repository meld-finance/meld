import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatTool } from './chat-tools';
import type { ChatTurnEvent } from './provider';

const { streamMock, paramsLog } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  paramsLog: [] as Record<string, unknown>[],
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class MockAnthropic {
    static AuthenticationError = actual.default.AuthenticationError;
    static PermissionDeniedError = actual.default.PermissionDeniedError;
    static RateLimitError = actual.default.RateLimitError;
    static BadRequestError = actual.default.BadRequestError;
    static APIUserAbortError = actual.default.APIUserAbortError;
    static APIError = actual.default.APIError;
    static AnthropicError = actual.default.AnthropicError;
    beta = {
      messages: {
        stream: (params: Record<string, unknown>) => {
          paramsLog.push(params);
          return streamMock(params);
        },
        parse: vi.fn(),
      },
    };
  }
  return { ...actual, default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic';

function makeStream(steps: (emit: EventEmitter) => Promise<Record<string, unknown>>) {
  const emitter = new EventEmitter();
  const promise = Promise.resolve().then(() => steps(emitter));
  return Object.assign(emitter, {
    finalMessage: () => promise,
  });
}

const coreTool: ChatTool = {
  name: 'get_balance',
  description: 'Get account balance',
  input: z.object({ account: z.string() }),
  label: (i) => `Checked ${(i as { account: string }).account}`,
  run: async () => ({ balance: 1200, card: '4111 1111 1111 1234' }),
};

const deferredTool: ChatTool = {
  name: 'get_tax_plan',
  description: 'Tax plan',
  deferLoading: true,
  input: z.object({}),
  label: () => 'Checked tax plan',
  run: async () => ({ totalTax: 5000 }),
};

beforeEach(() => {
  streamMock.mockReset();
  paramsLog.length = 0;
});

describe('AnthropicProvider.chat', () => {
  it('uses low effort for Sonnet/Haiku, medium for Opus, sets a static system cache breakpoint, and configures deferred tools', async () => {
    streamMock.mockImplementation(() =>
      makeStream(async (e) => {
        e.emit('text', 'Done.');
        return { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
      }),
    );

    const provider = new AnthropicProvider('sk-test', 'claude-opus-5-5', 'claude-haiku-5-5', ['claude-sonnet-5-5']);
    await provider.chat({
      model: 'claude-sonnet-5-5',
      system: 'STATIC_SYSTEM',
      snapshot: 'SNAPSHOT_1',
      history: [],
      userText: 'Hi',
      tools: [coreTool, deferredTool],
      onEvent: () => {},
    });
    expect(paramsLog[0]!.output_config).toEqual({ effort: 'low' });
    expect(paramsLog[0]!.system).toEqual([
      { type: 'text', text: 'STATIC_SYSTEM', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SNAPSHOT_1' },
    ]);
    expect(paramsLog[0]!.tools).toEqual([
      { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
      expect.objectContaining({ name: 'get_balance' }),
      expect.objectContaining({ name: 'get_tax_plan', defer_loading: true }),
    ]);

    await provider.chat({
      model: 'claude-opus-5-5',
      system: 'STATIC_SYSTEM',
      snapshot: 'SNAPSHOT_2',
      history: [],
      userText: 'Hi',
      tools: [coreTool],
      onEvent: () => {},
    });
    expect(paramsLog[1]!.output_config).toEqual({ effort: 'medium' });
  });

  it('emits lookup events immediately on contentBlock and resumes on pause_turn', async () => {
    const events: ChatTurnEvent[] = [];
    let call = 0;
    streamMock.mockImplementation(() =>
      makeStream(async (e) => {
        call++;
        if (call === 1) {
          const toolBlock = { type: 'tool_use', id: 'tu_1', name: 'get_balance', input: { account: 'checking' } };
          // Emit contentBlock while the response is still streaming (before finalMessage resolves).
          e.emit('contentBlock', toolBlock);
          expect(events).toEqual([{ type: 'lookup', label: 'Checked checking' }]);
          return { content: [toolBlock], stop_reason: 'tool_use' };
        }
        if (call === 2) {
          return { content: [{ type: 'server_tool_use', id: 'stu_1', name: 'tool_search_tool_bm25', input: {} }], stop_reason: 'pause_turn' };
        }
        e.emit('text', 'You have $1,200.');
        return { content: [{ type: 'text', text: 'You have $1,200.' }], stop_reason: 'end_turn' };
      }),
    );

    const provider = new AnthropicProvider('sk-test', 'claude-opus-5-5', 'claude-haiku-5-5', ['claude-sonnet-5-5']);
    const result = await provider.chat({
      model: 'claude-sonnet-5-5',
      system: 'SYS',
      snapshot: 'SNAP',
      history: [],
      userText: 'Checking?',
      tools: [coreTool, deferredTool],
      onEvent: (ev) => events.push(ev),
    });
    expect(result.outcome).toBe('complete');
    // Lookup emitted once (from contentBlock, not duplicated after finalMessage).
    expect(events).toEqual([
      { type: 'lookup', label: 'Checked checking' },
      { type: 'text', text: 'You have $1,200.' },
    ]);
  });

  it('falls back cleanly when a model rejects defer_loading / tool_search', async () => {
    let first = true;
    streamMock.mockImplementation(() =>
      makeStream(async (e) => {
        if (first) {
          first = false;
          throw new Anthropic.BadRequestError(
            400,
            { type: 'error', error: { type: 'invalid_request_error', message: 'defer_loading is not supported' } },
            'defer_loading is not supported',
            new Headers(),
          );
        }
        e.emit('text', 'Fallback worked.');
        return { content: [{ type: 'text', text: 'Fallback worked.' }], stop_reason: 'end_turn' };
      }),
    );

    const provider = new AnthropicProvider('sk-test', 'claude-opus-5-5', 'claude-haiku-5-5', ['custom-claude']);
    const res = await provider.chat({
      model: 'custom-claude',
      system: 'SYS',
      snapshot: 'SNAP',
      history: [],
      userText: 'Hi',
      tools: [coreTool, deferredTool],
      onEvent: () => {},
    });
    expect(res.outcome).toBe('complete');
    expect(paramsLog).toHaveLength(2);
    expect(paramsLog[1]!.tools).toHaveLength(2);
    expect((paramsLog[1]!.tools as Record<string, unknown>[]).every((t) => !('defer_loading' in t))).toBe(true);
  });
});
