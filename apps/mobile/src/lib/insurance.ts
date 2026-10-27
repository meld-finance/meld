import { isDisabilityPolicy, isLifePolicy, type InsurancePolicyType, type PremiumFrequency } from '@meld/shared';

export const POLICY_TYPE_LABELS: Record<InsurancePolicyType, string> = {
  life_term: 'Term life',
  life_whole: 'Whole life',
  life_universal: 'Universal life',
  disability_short: 'Short-term disability',
  disability_long: 'Long-term disability',
  other: 'Other',
};

export const FREQUENCY_LABELS: Record<PremiumFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Twice a year',
  annual: 'Yearly',
};

export const FREQUENCY_SUFFIX: Record<PremiumFrequency, string> = {
  monthly: '/mo',
  quarterly: '/qtr',
  semiannual: '/6 mo',
  annual: '/yr',
};

export function coverageLabel(type: InsurancePolicyType): string {
  if (isLifePolicy(type)) return 'Death benefit';
  if (isDisabilityPolicy(type)) return 'Monthly benefit';
  return 'Coverage amount';
}
