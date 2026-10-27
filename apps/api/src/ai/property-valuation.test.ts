import { describe, expect, it } from 'vitest';
import { median, normalizeValuation } from './property-valuation';

const empty = { matchedAddress: null, squareFeet: null, estimates: [], comparables: [], warnings: [] };

describe('normalizeValuation', () => {
  it('takes the median of usable sources and drops bad ones', () => {
    const result = normalizeValuation(
      {
        matchedAddress: '123 Main St, Springfield, IL 62701',
        squareFeet: 1800,
        comparables: [],
        estimates: [
          { source: 'Zillow', value: 510_000, url: 'https://www.zillow.com/homedetails/1' },
          { source: 'Redfin', value: 495_400.4, url: 'javascript:alert(1)' },
          { source: 'Realtor.com', value: 530_000, url: null },
          { source: 'zillow', value: 900_000, url: null },
          { source: 'Rent site', value: 2_400, url: null },
        ],
        warnings: [],
      },
      '123 main st springfield',
    );
    expect(result).toEqual({
      address: '123 Main St, Springfield, IL 62701',
      value: 510_000,
      basis: 'direct',
      sources: [
        { name: 'Zillow', value: 510_000, url: 'https://www.zillow.com/homedetails/1' },
        { name: 'Redfin', value: 495_400, url: null },
        { name: 'Realtor.com', value: 530_000, url: null },
      ],
      warnings: [],
    });
  });

  it('warns on a single source and explains when there are none', () => {
    const one = normalizeValuation(
      { ...empty, estimates: [{ source: 'Zillow', value: 400_000, url: null }] },
      '9 Elm St',
    );
    expect(one).toMatchObject({ address: '9 Elm St', value: 400_000, warnings: ['Only one source (Zillow) had an estimate.'] });

    expect(normalizeValuation(empty, '9 Elm St')).toEqual({
      warnings: ['Couldn’t find a value estimate for this address.'],
    });
  });

  it('scales comparable units to this unit’s size when it has no estimates', () => {
    const result = normalizeValuation(
      {
        ...empty,
        squareFeet: 1135,
        comparables: [
          { label: 'Unit 204, Zillow estimate', value: 1_261_300, squareFeet: 1_200, url: null },
          { label: 'Unit 303, Redfin estimate', value: 1_080_202, squareFeet: 1_000, url: null },
          { label: 'Unit 101, no size', value: 900_000, squareFeet: 0, url: null },
        ],
      },
      '1 Bay St #203',
    );
    expect(result).toMatchObject({
      basis: 'comparables',
      // 1,261,300 / 1,200 × 1,135 = 1,192,980; 1,080,202 / 1,000 × 1,135 = 1,226,029
      value: 1_209_505,
      sources: [
        { name: 'Unit 204, Zillow estimate', value: 1_192_980 },
        { name: 'Unit 303, Redfin estimate', value: 1_226_029 },
      ],
    });
    expect('warnings' in result && result.warnings[0]).toMatch(/2 similar units/);
  });

  it('ignores comparables when the unit’s size is unknown', () => {
    const comps = [{ label: 'Unit 204', value: 1_261_300, squareFeet: 1_200, url: null }];
    expect(normalizeValuation({ ...empty, comparables: comps }, '1 Bay St #203')).not.toHaveProperty('value');
  });

  it('averages the middle two for an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
