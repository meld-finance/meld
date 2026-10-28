import type { AccountType } from '@meld/shared';

import type { IconName } from '@/components/icon';

/** Sections of the accounts list, also its filter chips. */
export type AccountFilter = 'all' | 'banking' | 'credit' | 'investments' | 'loans' | 'insurance' | 'property';

export type AccountSection = {
  key: Exclude<AccountFilter, 'all'>;
  label: string;
  /** Chip label, when shorter than the section's. */
  chip?: string;
  icon: IconName;
  /** Plaid account types listed here; insurance and property list policies and manual assets instead. */
  types?: AccountType[];
};

export const SECTIONS: AccountSection[] = [
  { key: 'banking', label: 'Banking', icon: 'bank', types: ['depository'] },
  { key: 'credit', label: 'Credit cards', chip: 'Credit', icon: 'card', types: ['credit'] },
  { key: 'investments', label: 'Investments', icon: 'chart', types: ['investment'] },
  { key: 'loans', label: 'Loans & mortgages', chip: 'Loans', icon: 'home', types: ['mortgage', 'loan'] },
  { key: 'insurance', label: 'Insurance', icon: 'shield' },
  { key: 'property', label: 'Property & other', chip: 'Property', icon: 'wallet', types: ['other'] },
];
