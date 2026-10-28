import type { FilingStatus } from './profile';

/** Upper edges of each bracket; the last rate applies above the last edge. */
export type Brackets = { rate: number; upTo: number | null }[];

/** Filing statuses that share a table: a qualifying surviving spouse files with the joint numbers. */
export type TableStatus = 'single' | 'married_joint' | 'married_separate' | 'head_of_household';
export const tableStatus = (s: FilingStatus): TableStatus => (s === 'qualifying_widow' ? 'married_joint' : s);

type ByStatus<T> = Record<TableStatus, T>;

export type FederalTables = {
  year: number;
  brackets: ByStatus<Brackets>;
  standardDeduction: ByStatus<number>;
  /** Taxable income where long-term gains and qualified dividends leave the 0% and 15% rates. */
  capitalGains: ByStatus<{ zeroUpTo: number; fifteenUpTo: number }>;
  /** Net investment income tax (3.8%) applies above this MAGI. Not indexed. */
  niitThreshold: ByStatus<number>;
  /** Additional Medicare tax (0.9%) on wages and self-employment income above this. Not indexed. */
  additionalMedicareThreshold: ByStatus<number>;
  /** State and local tax deduction cap, cut by 30% of MAGI over the threshold, never below the floor. */
  salt: ByStatus<{ cap: number; phaseDownFrom: number; floor: number }>;
  childTaxCredit: { perChild: number; phaseOutFrom: ByStatus<number> };
  socialSecurityWageBase: number;
  limits: {
    /** Employee 401(k)/403(b)/457 deferrals, with the 50+ catch-up and the larger one at 60–63. */
    k401: number;
    k401CatchUp: number;
    k401CatchUp60to63: number;
    /** Everything into one person's defined contribution plans, employer money included (§415(c)). */
    totalDefinedContribution: number;
    ira: number;
    iraCatchUp: number;
    hsaSelf: number;
    hsaFamily: number;
    hsaCatchUp: number;
  };
  /** MAGI ranges over which the Roth IRA contribution phases out. */
  rothPhaseOut: ByStatus<[number, number]>;
  /** MAGI ranges over which a traditional IRA deduction phases out when you're covered by a workplace plan. */
  iraDeductionPhaseOut: ByStatus<[number, number]>;
};

const brackets = (rates: number[], edges: number[]): Brackets => rates.map((rate, i) => ({ rate, upTo: edges[i] ?? null }));
const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

// IRS Rev. Proc. 2024-40 as amended by the One Big Beautiful Bill Act; Notice 2024-80; Rev. Proc. 2024-25.
const FEDERAL_2025: FederalTables = {
  year: 2025,
  brackets: {
    single: brackets(RATES, [11_925, 48_475, 103_350, 197_300, 250_525, 626_350]),
    married_joint: brackets(RATES, [23_850, 96_950, 206_700, 394_600, 501_050, 751_600]),
    married_separate: brackets(RATES, [11_925, 48_475, 103_350, 197_300, 250_525, 375_800]),
    head_of_household: brackets(RATES, [17_000, 64_850, 103_350, 197_300, 250_500, 626_350]),
  },
  standardDeduction: { single: 15_750, married_joint: 31_500, married_separate: 15_750, head_of_household: 23_625 },
  capitalGains: {
    single: { zeroUpTo: 48_350, fifteenUpTo: 533_400 },
    married_joint: { zeroUpTo: 96_700, fifteenUpTo: 600_050 },
    married_separate: { zeroUpTo: 48_350, fifteenUpTo: 300_000 },
    head_of_household: { zeroUpTo: 64_750, fifteenUpTo: 566_700 },
  },
  niitThreshold: { single: 200_000, married_joint: 250_000, married_separate: 125_000, head_of_household: 200_000 },
  additionalMedicareThreshold: { single: 200_000, married_joint: 250_000, married_separate: 125_000, head_of_household: 200_000 },
  salt: {
    single: { cap: 40_000, phaseDownFrom: 500_000, floor: 10_000 },
    married_joint: { cap: 40_000, phaseDownFrom: 500_000, floor: 10_000 },
    married_separate: { cap: 20_000, phaseDownFrom: 250_000, floor: 5_000 },
    head_of_household: { cap: 40_000, phaseDownFrom: 500_000, floor: 10_000 },
  },
  childTaxCredit: {
    perChild: 2_200,
    phaseOutFrom: { single: 200_000, married_joint: 400_000, married_separate: 200_000, head_of_household: 200_000 },
  },
  socialSecurityWageBase: 176_100,
  limits: {
    k401: 23_500,
    k401CatchUp: 7_500,
    k401CatchUp60to63: 11_250,
    totalDefinedContribution: 70_000,
    ira: 7_000,
    iraCatchUp: 1_000,
    hsaSelf: 4_300,
    hsaFamily: 8_550,
    hsaCatchUp: 1_000,
  },
  rothPhaseOut: {
    single: [150_000, 165_000],
    married_joint: [236_000, 246_000],
    married_separate: [0, 10_000],
    head_of_household: [150_000, 165_000],
  },
  iraDeductionPhaseOut: {
    single: [79_000, 89_000],
    married_joint: [126_000, 146_000],
    married_separate: [0, 10_000],
    head_of_household: [79_000, 89_000],
  },
};

// IRS Rev. Proc. 2025-32 (IR-2025-103); Notice 2025-67 (IR-2025-111); Rev. Proc. 2025-19 (HSA).
const FEDERAL_2026: FederalTables = {
  year: 2026,
  brackets: {
    single: brackets(RATES, [12_400, 50_400, 105_700, 201_775, 256_225, 640_600]),
    married_joint: brackets(RATES, [24_800, 100_800, 211_400, 403_550, 512_450, 768_700]),
    married_separate: brackets(RATES, [12_400, 50_400, 105_700, 201_775, 256_225, 384_350]),
    head_of_household: brackets(RATES, [17_700, 67_450, 105_700, 201_750, 256_200, 640_600]),
  },
  standardDeduction: { single: 16_100, married_joint: 32_200, married_separate: 16_100, head_of_household: 24_150 },
  capitalGains: {
    single: { zeroUpTo: 49_450, fifteenUpTo: 545_500 },
    married_joint: { zeroUpTo: 98_900, fifteenUpTo: 613_700 },
    married_separate: { zeroUpTo: 49_450, fifteenUpTo: 306_850 },
    head_of_household: { zeroUpTo: 66_200, fifteenUpTo: 579_600 },
  },
  niitThreshold: FEDERAL_2025.niitThreshold,
  additionalMedicareThreshold: FEDERAL_2025.additionalMedicareThreshold,
  salt: {
    single: { cap: 40_400, phaseDownFrom: 505_000, floor: 10_000 },
    married_joint: { cap: 40_400, phaseDownFrom: 505_000, floor: 10_000 },
    married_separate: { cap: 20_200, phaseDownFrom: 252_500, floor: 5_000 },
    head_of_household: { cap: 40_400, phaseDownFrom: 505_000, floor: 10_000 },
  },
  childTaxCredit: FEDERAL_2025.childTaxCredit,
  socialSecurityWageBase: 184_500,
  limits: {
    k401: 24_500,
    k401CatchUp: 8_000,
    k401CatchUp60to63: 11_250,
    totalDefinedContribution: 72_000,
    ira: 7_500,
    iraCatchUp: 1_100,
    hsaSelf: 4_400,
    hsaFamily: 8_750,
    hsaCatchUp: 1_000,
  },
  rothPhaseOut: {
    single: [153_000, 168_000],
    married_joint: [242_000, 252_000],
    married_separate: [0, 10_000],
    head_of_household: [153_000, 168_000],
  },
  iraDeductionPhaseOut: {
    single: [81_000, 91_000],
    married_joint: [129_000, 149_000],
    married_separate: [0, 10_000],
    head_of_household: [81_000, 91_000],
  },
};

export type CaliforniaTables = {
  year: number;
  brackets: ByStatus<Brackets>;
  standardDeduction: ByStatus<number>;
  personalCredit: ByStatus<number>;
  dependentCredit: number;
  /** Exemption credits shrink by $6 each per $2,500 ($1,250 separately) of federal AGI over this. */
  creditPhaseOutFrom: ByStatus<number>;
  /** Mental Health Services Tax: 1% of taxable income over $1M, whatever the filing status. */
  surchargeFrom: number;
};

const CA_RATES = [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123];
const CA_SINGLE = brackets(CA_RATES, [11_079, 26_264, 41_452, 57_542, 72_724, 371_479, 445_771, 742_953]);

// FTB 2025 California Tax Rate Schedules and Form 540 instructions.
const CALIFORNIA_2025: CaliforniaTables = {
  year: 2025,
  brackets: {
    single: CA_SINGLE,
    married_separate: CA_SINGLE,
    married_joint: brackets(CA_RATES, [22_158, 52_528, 82_904, 115_084, 145_448, 742_958, 891_542, 1_485_906]),
    head_of_household: brackets(CA_RATES, [22_173, 52_530, 67_716, 83_805, 98_990, 505_208, 606_251, 1_010_417]),
  },
  standardDeduction: { single: 5_706, married_separate: 5_706, married_joint: 11_412, head_of_household: 11_412 },
  personalCredit: { single: 153, married_separate: 153, married_joint: 307, head_of_household: 153 },
  dependentCredit: 475,
  creditPhaseOutFrom: { single: 252_203, married_separate: 252_203, married_joint: 504_411, head_of_household: 378_310 },
  surchargeFrom: 1_000_000,
};

const FEDERAL = [FEDERAL_2025, FEDERAL_2026];
const CALIFORNIA = [CALIFORNIA_2025];

/** The tables for `year`, or the nearest year Meld has (`year` on the result says which). */
function nearest<T extends { year: number }>(tables: T[], year: number): T {
  return tables.find((t) => t.year === year) ?? (year < tables[0]!.year ? tables[0]! : tables.at(-1)!);
}
export const federalTables = (year: number) => nearest(FEDERAL, year);
export const californiaTables = (year: number) => nearest(CALIFORNIA, year);

/** States without a tax on wages and investment income. */
export const NO_INCOME_TAX_STATES = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']);

/** Tax on `income` through progressive brackets. */
export function bracketTax(table: Brackets, income: number): number {
  let tax = 0;
  let from = 0;
  for (const { rate, upTo } of table) {
    if (income <= from) break;
    tax += (Math.min(income, upTo ?? Infinity) - from) * rate;
    from = upTo ?? Infinity;
  }
  return tax;
}

/** The bracket `income` falls in: its rate, and its lower and upper edges. */
export function bracketAt(table: Brackets, income: number): { rate: number; from: number; upTo: number | null } {
  let from = 0;
  for (const { rate, upTo } of table) {
    if (upTo === null || income < upTo) return { rate, from, upTo };
    from = upTo;
  }
  const last = table.at(-1)!;
  return { rate: last.rate, from, upTo: null };
}
