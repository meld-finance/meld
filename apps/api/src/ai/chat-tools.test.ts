import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Db } from '../db/client';
import { createChatTools, maskNumbers, runTool, toToolJsonSchema, type ChatTool } from './chat-tools';
import { MELD_DOC_SECTIONS } from './meld-docs.generated';

describe('toToolJsonSchema', () => {
  it('strips $schema and verbose date/uuid regexes while keeping short patterns', () => {
    const schema = z.object({
      id: z.uuid(),
      from: z.iso.date(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    });
    const json = toToolJsonSchema(schema) as {
      $schema?: string;
      properties: Record<string, { type: string; format?: string; pattern?: string }>;
    };
    expect(json.$schema).toBeUndefined();
    expect(json.properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(json.properties.from).toEqual({ type: 'string', format: 'date' });
    expect(json.properties.month).toEqual({ type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' });
  });

  it('keeps total and core tool definitions compact', () => {
    const tools = createChatTools({} as Db);
    const defs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toToolJsonSchema(t.input),
      defer: Boolean(t.deferLoading),
    }));
    const core = defs.filter((d) => !d.defer);
    expect(JSON.stringify(defs).length).toBeLessThan(9000);
    expect(JSON.stringify(core).length).toBeLessThan(4500);
    expect(defs.some((d) => d.name === 'get_financial_overview' && !d.defer)).toBe(true);
    expect(defs.some((d) => d.name === 'get_retirement_plan' && d.defer)).toBe(true);
    expect(defs.some((d) => d.name === 'get_meld_docs' && d.defer)).toBe(true);
  });
});

describe('runTool', () => {
  const sampleTool: ChatTool = {
    name: 'sample',
    description: 'Sample tool',
    input: z.object({ id: z.uuid(), from: z.iso.date() }),
    label: () => 'Ran sample',
    run: async (input) => ({ ...input, card: '4111 1111 1111 1234', account: '987654321012' }),
  };

  it('validates dates and UUIDs with full Zod even when JSON schema regexes are stripped', async () => {
    const badDate = await runTool(sampleTool, { id: '00000000-0000-4000-8000-000000000001', from: '2026-02-30' });
    expect(badDate.isError).toBe(true);
    expect(badDate.content).toContain('Invalid input');

    const badUuid = await runTool(sampleTool, { id: 'not-a-uuid', from: '2026-10-01' });
    expect(badUuid.isError).toBe(true);
  });

  it('masks long digit runs and preserves UUIDs and ISO dates on valid input', async () => {
    const ok = await runTool(sampleTool, { id: '00000000-0000-4000-8000-000000000001', from: '2026-10-01' });
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.content)).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      from: '2026-10-01',
      card: '••••1234',
      account: '••••1012',
    });
  });

  it('handles unknown tools and runtime errors safely', async () => {
    expect((await runTool(undefined, {})).isError).toBe(true);
    const broken: ChatTool = {
      name: 'broken',
      description: 'Broken',
      input: z.object({}),
      label: () => 'Broken',
      run: async () => {
        throw new Error('boom');
      },
    };
    const res = await runTool(broken, {});
    expect(res.isError).toBe(true);
    expect(res.content).not.toContain('boom');
  });

  it('masks numbers in nested structures without touching ISO dates', () => {
    expect(maskNumbers({ date: '2026-11-25', text: 'ACCT 1234-5678-9012' })).toEqual({
      date: '2026-11-25',
      text: 'ACCT ••••9012',
    });
  });

  it('runs get_meld_docs without corrupting doc content via digit masking', async () => {
    const docsTool = createChatTools({} as Db).find((t) => t.name === 'get_meld_docs');
    const res = await runTool(docsTool, { query: 'autopay' });
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.content) as { sections: { id: string }[] };
    expect(parsed.sections[0]!.id.startsWith('features/recurring-and-alerts#')).toBe(true);
    expect(maskNumbers(MELD_DOC_SECTIONS)).toEqual(MELD_DOC_SECTIONS);
  });
});
