import { describe, expect, it } from 'vitest';
import { normalizeProfiles, profilesPrompt, type RawProfiles } from './security-profiles';

type RawEntry = RawProfiles['securities'][number];

const none = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const entry = (overrides: Partial<RawEntry>): RawEntry => ({
  id: 0,
  known: true,
  category: 'US total market',
  assetClasses: { ...none(['us_stocks', 'intl_stocks', 'bonds', 'cash', 'other']), us_stocks: 100 },
  sectors: {
    ...none([
      'technology', 'financials', 'healthcare', 'consumer_discretionary', 'industrials', 'communication_services',
      'consumer_staples', 'energy', 'utilities', 'real_estate', 'materials',
    ]),
    technology: 30,
    financials: 20,
  },
  regions: { ...none(['united_states', 'canada', 'europe', 'japan', 'asia_pacific', 'emerging_markets', 'other']), united_states: 100 },
  bondTypes: { ...none(['treasury', 'government_related', 'mortgage_backed', 'corporate', 'municipal', 'international', 'other']), corporate: 40 },
  ...overrides,
});

describe('normalizeProfiles', () => {
  it('turns percents into fractions and drops groups the security has no part in', () => {
    const [p] = normalizeProfiles({ securities: [entry({})] }, 1);
    expect(p!.assetClasses).toEqual({ us_stocks: 1 });
    // Sectors that don't sum to 100 are rescaled.
    expect(p!.sectors.technology).toBeCloseTo(0.6);
    expect(p!.sectors.financials).toBeCloseTo(0.4);
    expect(p!.regions).toEqual({ united_states: 1 });
    // No bonds, so the bond weights are noise.
    expect(p!.bondTypes).toEqual({});
  });

  it('places results by id and leaves unknown, empty or out-of-range entries null', () => {
    const result = normalizeProfiles(
      {
        securities: [
          entry({ id: 2, category: '  Total bond market  ', assetClasses: { ...entry({}).assetClasses, us_stocks: 0, bonds: 100 } }),
          entry({ id: 0, known: false }),
          entry({ id: 1, assetClasses: none(['us_stocks', 'intl_stocks', 'bonds', 'cash', 'other']) }),
          entry({ id: 7 }),
        ],
      },
      3,
    );
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toMatchObject({ category: 'Total bond market', assetClasses: { bonds: 1 }, sectors: {}, bondTypes: { corporate: 1 } });
  });
});

describe('profilesPrompt', () => {
  it('numbers securities by position', () => {
    const prompt = profilesPrompt([
      { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf', subtype: null, sector: null, industry: null },
      { ticker: 'AAPL', name: 'Apple Inc', type: 'equity', subtype: 'common stock', sector: 'Electronic Technology', industry: null },
    ]);
    expect(prompt).toContain('{"id":0,"ticker":"VTI"');
    expect(prompt).toContain('"id":1,"ticker":"AAPL","name":"Apple Inc","type":"equity / common stock","sector":"Electronic Technology"');
  });
});
