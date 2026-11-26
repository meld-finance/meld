import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EquityExtractionSchema,
  MAX_EQUITY_UNION_FIELDS,
  normalizeEquityExtraction,
  type RawEquityExtraction,
} from './equity-extraction';

function countUnions(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const n = node as Record<string, unknown>;
  const self = Array.isArray(n.type) || Array.isArray(n.anyOf) || Array.isArray(n.oneOf) ? 1 : 0;
  return self + Object.values(n).reduce<number>((sum, v) => sum + (Array.isArray(v) ? v.reduce<number>((s, x) => s + countUnions(x), 0) : countUnions(v)), 0);
}

const raw: RawEquityExtraction = {
  employer: ' Acme Corp ',
  name: '2026 New Hire RSU',
  ticker: ' acme ',
  grantDate: '2026-02-01',
  grantNumberLast4: 'RSU-99887766',
  totalShares: 400,
  manualPrice: null,
  withholdingMethod: 'sell_to_cover',
  vests: [
    { vestDate: '2027-02-01', shares: 100, status: 'scheduled', vestPrice: null },
    { vestDate: '2028-02-01', shares: 100, status: 'scheduled', vestPrice: null },
  ],
  notes: '1-year cliff.',
  warnings: [],
};

describe('EquityExtractionSchema', () => {
  it('stays within Anthropic structured-output union limits', () => {
    expect(countUnions(z.toJSONSchema(EquityExtractionSchema))).toBeLessThanOrEqual(MAX_EQUITY_UNION_FIELDS);
  });
});

describe('normalizeEquityExtraction', () => {
  it('normalizes ticker, masks grant ID to last 4, and keeps valid tranches', () => {
    const { draft, warnings } = normalizeEquityExtraction(raw, '2026-10-01');
    expect(draft.employer).toBe('Acme Corp');
    expect(draft.ticker).toBe('ACME');
    expect(draft.grantNumberMask).toBe('7766');
    expect(draft.vests).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('recovers cleanly from missing/bad fields with warnings', () => {
    const { draft, warnings } = normalizeEquityExtraction(
      {
        ...raw,
        employer: ' ',
        name: '',
        ticker: '   ',
        grantDate: 'February 2026',
        totalShares: null,
        vests: [
          { vestDate: 'not-a-date', shares: 50, status: 'scheduled', vestPrice: null },
          { vestDate: '2026-05-01', shares: 25, status: 'vested', vestPrice: -10 },
        ],
      },
      '2026-10-01',
    );
    expect(draft.employer).toBe('Employer');
    expect(draft.name).toBe('RSU Grant');
    expect(draft.ticker).toBeNull();
    expect(draft.grantDate).toBe('2026-10-01');
    expect(draft.totalShares).toBe(25);
    expect(draft.vests).toEqual([
      { vestDate: '2026-05-01', shares: 25, status: 'vested', vestPrice: null, sharesWithheld: null, taxWithheld: null },
    ]);
    expect(draft.status).toBe('completed');
    expect(warnings.length).toBeGreaterThanOrEqual(5);
  });
});
