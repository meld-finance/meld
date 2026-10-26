import { describe, expect, it } from 'vitest';
import { mapAccountType } from './mappers';

describe('mapAccountType', () => {
  it.each([
    ['loan', 'mortgage', 'mortgage'],
    ['loan', 'student', 'loan'],
    ['brokerage', null, 'investment'],
    ['investment', '401k', 'investment'],
    ['depository', 'checking', 'depository'],
    ['credit', 'credit card', 'credit'],
    ['payroll', null, 'other'],
  ])('%s/%s → %s', (type, subtype, expected) => {
    expect(mapAccountType(type, subtype)).toBe(expected);
  });
});
