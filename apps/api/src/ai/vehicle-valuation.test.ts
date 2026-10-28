import { describe, expect, it } from 'vitest';
import { normalizeVehicleValuation, vehicleValuationPrompt } from './vehicle-valuation';

describe('normalizeVehicleValuation', () => {
  it('takes the median of usable sources and drops bad ones', () => {
    const result = normalizeVehicleValuation({
      estimates: [
        { source: 'Kelley Blue Book', value: 24_100, url: 'https://www.kbb.com/toyota/rav4/2021/' },
        { source: 'Edmunds', value: 23_400.6, url: 'javascript:alert(1)' },
        { source: 'CarGurus', value: 25_000, url: null },
        { source: 'edmunds', value: 40_000, url: null },
        { source: 'Payment site', value: 389, url: null },
      ],
      warnings: [],
    });
    expect(result).toEqual({
      value: 24_100,
      sources: [
        { name: 'Kelley Blue Book', value: 24_100, url: 'https://www.kbb.com/toyota/rav4/2021/' },
        { name: 'Edmunds', value: 23_401, url: null },
        { name: 'CarGurus', value: 25_000, url: null },
      ],
      warnings: [],
    });
  });

  it('warns on a single source and explains when there are none', () => {
    expect(normalizeVehicleValuation({ estimates: [{ source: 'Edmunds', value: 9_000, url: null }], warnings: [] })).toMatchObject({
      value: 9_000,
      warnings: ['Only one source (Edmunds) had a value.'],
    });
    expect(normalizeVehicleValuation({ estimates: [], warnings: [] })).toEqual({
      warnings: ['Couldn’t find a value for this vehicle.'],
    });
  });
});

describe('vehicleValuationPrompt', () => {
  it('includes the details it was given', () => {
    const prompt = vehicleValuationPrompt({ year: 2021, make: 'Toyota', model: 'RAV4', trim: 'XLE', mileage: 32000, zip: '94110' }, '2026-10-27');
    expect(prompt).toContain('Vehicle: 2021 Toyota RAV4 XLE');
    expect(prompt).toContain('Mileage: 32,000 miles');
    expect(prompt).toContain('ZIP code: 94110');
  });
});
