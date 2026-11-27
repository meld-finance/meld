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

export type StateYearTable = {
  year: number;
  brackets: ByStatus<Brackets>;
  /** Fixed per-status standard deduction, 0 (as `{ single: 0, ... }`), or `'federal'` to mirror federal standard deduction for that year. */
  standardDeduction: ByStatus<number> | 'federal';
  /** Deducted from state AGI for filer/spouse before brackets. */
  personalExemption?: ByStatus<number>;
  /** Deducted from state AGI per dependent before brackets. */
  dependentExemption?: number;
  /** Non-refundable personal tax credit subtracted after bracket tax. */
  personalCredit?: ByStatus<number>;
  /** Non-refundable per-dependent tax credit subtracted after bracket tax. */
  dependentCredit?: number;
  /** Federal AGI threshold above which personal/dependent credits phase out by $6/step per $2,500 ($1,250 MFS) — CA FTB rule. */
  creditPhaseOutFrom?: ByStatus<number>;
  /** Flat surtax above taxable income threshold (e.g., CA 1% over $1M, MA 4% over $1,083,150 / $1,107,750). */
  surcharge?: { rate: number; from: number };
  /** Utah-style non-refundable taxpayer tax credit equal to `rate * federalDeduction` (phased out above status thresholds). */
  deductionCredit?: { rate: number; phaseOutRate: number; phaseOutFrom: ByStatus<number> };
  /** Whether state allows itemizing propertyTax + otherItemized (excluding SALT) when larger than standard deduction. Defaults to true when standardDeduction is non-zero, false otherwise. */
  allowsItemized?: boolean;
  /** State does not conform to federal HSA deduction (CA, NJ): add HSA contributions back into state AGI. */
  hsaTaxable?: boolean;
  /** State has widespread local/city/county income taxes not modeled in built-in tables (NY, MD, PA, OH, IN, KY, MI, MO, OR). */
  localTaxNote?: boolean;
};

/** All 50 US states plus the District of Columbia, sorted alphabetically by name. */
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
] as const;

export type UsStateCode = (typeof US_STATES)[number]['code'];
export const US_STATE_CODES: ReadonlySet<string> = new Set(US_STATES.map((s) => s.code));
export const isUsStateCode = (s: string): s is UsStateCode => US_STATE_CODES.has(s);
const STATE_NAMES = new Map<string, string>(US_STATES.map((s) => [s.code, s.name]));
export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_NAMES.get(code.trim().toUpperCase()) ?? null;
}

const same = <T>(v: T): ByStatus<T> => ({ single: v, married_joint: v, married_separate: v, head_of_household: v });
const std = (single: number, joint = single * 2, hoh = single, separate = single): ByStatus<number> => ({
  single,
  married_joint: joint,
  married_separate: separate,
  head_of_household: hoh,
});
const flat = (rate: number): ByStatus<Brackets> => same([{ rate, upTo: null }]);
const sameBrackets = (b: Brackets): ByStatus<Brackets> => same(b);

const CA_RATES = [0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123];
const CA_SINGLE_2025 = brackets(CA_RATES, [11_079, 26_264, 41_452, 57_542, 72_724, 371_479, 445_771, 742_953]);
const CA_SINGLE_2026 = brackets(CA_RATES, [11_456, 27_157, 42_861, 59_498, 75_197, 384_109, 460_927, 768_213]);

const NY_RATES_2025 = [0.04, 0.045, 0.0525, 0.055, 0.06, 0.0685, 0.0965, 0.103, 0.109];
const NY_RATES_2026 = [0.039, 0.044, 0.0515, 0.054, 0.059, 0.0685, 0.0965, 0.103, 0.109];
const NY_EDGES_SINGLE = [8_500, 11_700, 13_900, 80_650, 215_400, 1_077_550, 5_000_000, 25_000_000];
const NY_EDGES_JOINT = [17_150, 23_600, 27_900, 161_550, 323_200, 2_155_350, 5_000_000, 25_000_000];
const NY_EDGES_HOH = [12_800, 17_650, 20_900, 107_650, 269_300, 1_616_450, 5_000_000, 25_000_000];

const NJ_SINGLE = brackets([0.014, 0.0175, 0.035, 0.05525, 0.0637, 0.0897, 0.1075], [20_000, 35_000, 40_000, 75_000, 500_000, 1_000_000]);
const NJ_JOINT = brackets([0.014, 0.0175, 0.0245, 0.035, 0.05525, 0.0637, 0.0897, 0.1075], [20_000, 50_000, 70_000, 80_000, 150_000, 500_000, 1_000_000]);

const CT_RATES = [0.02, 0.045, 0.055, 0.06, 0.065, 0.069, 0.0699];
const CT_SINGLE = brackets(CT_RATES, [10_000, 50_000, 100_000, 200_000, 250_000, 500_000]);
const CT_JOINT = brackets(CT_RATES, [20_000, 100_000, 200_000, 400_000, 500_000, 1_000_000]);
const CT_HOH = brackets(CT_RATES, [16_000, 80_000, 160_000, 320_000, 400_000, 800_000]);

const HI_RATES = [0.014, 0.032, 0.055, 0.064, 0.068, 0.072, 0.076, 0.079, 0.0825, 0.09, 0.1, 0.11];
const HI_SINGLE = brackets(HI_RATES, [9_600, 14_400, 19_200, 24_000, 36_000, 48_000, 125_000, 175_000, 225_000, 275_000, 325_000]);
const HI_JOINT = brackets(HI_RATES, [19_200, 28_800, 38_400, 48_000, 72_000, 96_000, 250_000, 350_000, 450_000, 550_000, 650_000]);
const HI_HOH = brackets(HI_RATES, [14_400, 21_600, 28_800, 36_000, 54_000, 72_000, 187_500, 262_500, 337_500, 412_500, 487_500]);

const MD_RATES = [0.02, 0.03, 0.04, 0.0475, 0.05, 0.0525, 0.055, 0.0575, 0.0625, 0.065];
const MD_SINGLE = brackets(MD_RATES, [1_000, 2_000, 3_000, 100_000, 125_000, 150_000, 250_000, 500_000, 1_000_000]);
const MD_JOINT = brackets(MD_RATES, [1_000, 2_000, 3_000, 150_000, 175_000, 225_000, 300_000, 600_000, 1_200_000]);

const DC_BRACKETS = sameBrackets(brackets([0.04, 0.06, 0.065, 0.085, 0.0925, 0.0975, 0.1075], [10_000, 40_000, 60_000, 250_000, 500_000, 1_000_000]));
const DE_BRACKETS = sameBrackets(brackets([0, 0.022, 0.039, 0.048, 0.052, 0.0555, 0.066], [2_000, 5_000, 10_000, 20_000, 25_000, 60_000]));
const MO_BRACKETS = sameBrackets(brackets([0, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.047], [1_313, 2_626, 3_939, 5_252, 6_565, 7_878, 9_191]));
const NM_BRACKETS: ByStatus<Brackets> = {
  single: brackets([0.015, 0.032, 0.043, 0.047, 0.049, 0.059], [5_500, 16_500, 33_500, 66_500, 210_000]),
  married_joint: brackets([0.015, 0.032, 0.043, 0.047, 0.049, 0.059], [8_250, 24_750, 50_250, 99_750, 315_000]),
  head_of_household: brackets([0.015, 0.032, 0.043, 0.047, 0.049, 0.059], [8_250, 24_750, 50_250, 99_750, 315_000]),
  married_separate: brackets([0.015, 0.032, 0.043, 0.047, 0.049, 0.059], [4_125, 12_375, 25_125, 49_875, 157_500]),
};
const VA_BRACKETS = sameBrackets(brackets([0.02, 0.03, 0.05, 0.0575], [3_000, 5_000, 17_000]));

// State 2025 & 2026 rate schedules, standard deductions, and exemptions for all 42 taxing jurisdictions (41 states + DC).
const STATE_TABLES: Record<string, StateYearTable[]> = {
  AL: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        married_separate: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        head_of_household: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        married_joint: brackets([0.02, 0.04, 0.05], [1_000, 6_000]),
      },
      standardDeduction: std(3_000, 8_500, 5_200),
      personalExemption: std(1_500, 3_000, 3_000),
      dependentExemption: 500,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        married_separate: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        head_of_household: brackets([0.02, 0.04, 0.05], [500, 3_000]),
        married_joint: brackets([0.02, 0.04, 0.05], [1_000, 6_000]),
      },
      standardDeduction: std(3_000, 8_500, 5_200),
      personalExemption: std(1_500, 3_000, 3_000),
      dependentExemption: 500,
    },
  ],
  AR: [
    { year: 2025, brackets: sameBrackets(brackets([0.02, 0.039], [4_600])), standardDeduction: std(2_470, 4_940, 2_470) },
    { year: 2026, brackets: sameBrackets(brackets([0.02, 0.039], [4_600])), standardDeduction: std(2_470, 4_940, 2_470) },
  ],
  AZ: [
    { year: 2025, brackets: flat(0.025), standardDeduction: 'federal' },
    { year: 2026, brackets: flat(0.025), standardDeduction: 'federal' },
  ],
  CA: [
    // FTB 2025 California Tax Rate Schedules and Form 540 instructions.
    {
      year: 2025,
      brackets: {
        single: CA_SINGLE_2025,
        married_separate: CA_SINGLE_2025,
        married_joint: brackets(CA_RATES, [22_158, 52_528, 82_904, 115_084, 145_448, 742_958, 891_542, 1_485_906]),
        head_of_household: brackets(CA_RATES, [22_173, 52_530, 67_716, 83_805, 98_990, 505_208, 606_251, 1_010_417]),
      },
      standardDeduction: std(5_706, 11_412, 11_412),
      personalCredit: std(153, 307, 153),
      dependentCredit: 475,
      creditPhaseOutFrom: { single: 252_203, married_separate: 252_203, married_joint: 504_411, head_of_household: 378_310 },
      surcharge: { rate: 0.01, from: 1_000_000 },
      hsaTaxable: true,
    },
    // FTB 2026 indexed California schedules (3.4% CCPI).
    {
      year: 2026,
      brackets: {
        single: CA_SINGLE_2026,
        married_separate: CA_SINGLE_2026,
        married_joint: brackets(CA_RATES, [22_912, 54_314, 85_722, 118_996, 150_394, 768_218, 921_854, 1_536_426]),
        head_of_household: brackets(CA_RATES, [22_927, 54_316, 70_018, 86_654, 102_356, 522_385, 626_864, 1_044_771]),
      },
      standardDeduction: std(5_900, 11_800, 11_800),
      personalCredit: std(158, 316, 158),
      dependentCredit: 491,
      creditPhaseOutFrom: { single: 260_778, married_separate: 260_778, married_joint: 521_561, head_of_household: 391_173 },
      surcharge: { rate: 0.01, from: 1_000_000 },
      hsaTaxable: true,
    },
  ],
  CO: [
    { year: 2025, brackets: flat(0.044), standardDeduction: 'federal' },
    { year: 2026, brackets: flat(0.044), standardDeduction: 'federal' },
  ],
  CT: [
    {
      year: 2025,
      brackets: { single: CT_SINGLE, married_separate: CT_SINGLE, married_joint: CT_JOINT, head_of_household: CT_HOH },
      standardDeduction: same(0),
      allowsItemized: false,
    },
    {
      year: 2026,
      brackets: { single: CT_SINGLE, married_separate: CT_SINGLE, married_joint: CT_JOINT, head_of_household: CT_HOH },
      standardDeduction: same(0),
      allowsItemized: false,
    },
  ],
  DC: [
    { year: 2025, brackets: DC_BRACKETS, standardDeduction: 'federal' },
    { year: 2026, brackets: DC_BRACKETS, standardDeduction: 'federal' },
  ],
  DE: [
    { year: 2025, brackets: DE_BRACKETS, standardDeduction: std(3_250, 6_500, 3_250), personalCredit: std(110, 220, 110), dependentCredit: 110 },
    { year: 2026, brackets: DE_BRACKETS, standardDeduction: std(3_250, 6_500, 3_250), personalCredit: std(110, 220, 110), dependentCredit: 110 },
  ],
  GA: [
    { year: 2025, brackets: flat(0.0519), standardDeduction: std(12_000, 24_000, 12_000), dependentExemption: 4_000 },
    { year: 2026, brackets: flat(0.0499), standardDeduction: std(15_000, 30_000, 15_000), dependentExemption: 5_000 },
  ],
  HI: [
    {
      year: 2025,
      brackets: { single: HI_SINGLE, married_separate: HI_SINGLE, married_joint: HI_JOINT, head_of_household: HI_HOH },
      standardDeduction: std(4_400, 8_800, 6_424),
      personalExemption: std(1_144, 2_288, 1_144),
      dependentExemption: 1_144,
    },
    {
      year: 2026,
      brackets: { single: HI_SINGLE, married_separate: HI_SINGLE, married_joint: HI_JOINT, head_of_household: HI_HOH },
      standardDeduction: std(8_000, 16_000, 11_680),
      personalExemption: std(1_144, 2_288, 1_144),
      dependentExemption: 1_144,
    },
  ],
  IA: [
    { year: 2025, brackets: flat(0.038), standardDeduction: 'federal', personalCredit: std(40, 80, 40), dependentCredit: 40 },
    { year: 2026, brackets: flat(0.038), standardDeduction: 'federal', personalCredit: std(40, 80, 40), dependentCredit: 40 },
  ],
  ID: [
    { year: 2025, brackets: flat(0.05695), standardDeduction: 'federal' },
    { year: 2026, brackets: flat(0.053), standardDeduction: 'federal' },
  ],
  IL: [
    { year: 2025, brackets: flat(0.0495), standardDeduction: same(0), allowsItemized: false, personalExemption: std(2_850, 5_700, 2_850), dependentExemption: 2_850 },
    { year: 2026, brackets: flat(0.0495), standardDeduction: same(0), allowsItemized: false, personalExemption: std(2_925, 5_850, 2_925), dependentExemption: 2_925 },
  ],
  IN: [
    { year: 2025, brackets: flat(0.03), standardDeduction: same(0), allowsItemized: false, personalExemption: std(1_000, 2_000, 1_000), dependentExemption: 1_500, localTaxNote: true },
    { year: 2026, brackets: flat(0.0295), standardDeduction: same(0), allowsItemized: false, personalExemption: std(1_000, 2_000, 1_000), dependentExemption: 1_500, localTaxNote: true },
  ],
  KS: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.052, 0.0558], [23_000]),
        married_separate: brackets([0.052, 0.0558], [23_000]),
        head_of_household: brackets([0.052, 0.0558], [23_000]),
        married_joint: brackets([0.052, 0.0558], [46_000]),
      },
      standardDeduction: std(3_605, 8_240, 6_180),
      personalExemption: std(9_160, 18_320, 9_160),
      dependentExemption: 2_320,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.052, 0.0558], [23_000]),
        married_separate: brackets([0.052, 0.0558], [23_000]),
        head_of_household: brackets([0.052, 0.0558], [23_000]),
        married_joint: brackets([0.052, 0.0558], [46_000]),
      },
      standardDeduction: std(3_805, 8_640, 6_480),
      personalExemption: std(9_160, 18_320, 9_160),
      dependentExemption: 2_320,
    },
  ],
  KY: [
    { year: 2025, brackets: flat(0.04), standardDeduction: std(3_270, 6_540, 3_270), allowsItemized: false, localTaxNote: true },
    { year: 2026, brackets: flat(0.035), standardDeduction: std(3_360, 6_720, 3_360), allowsItemized: false, localTaxNote: true },
  ],
  LA: [
    { year: 2025, brackets: flat(0.03), standardDeduction: std(12_500, 25_000, 25_000) },
    { year: 2026, brackets: flat(0.03), standardDeduction: std(12_875, 25_750, 25_750) },
  ],
  MA: [
    {
      year: 2025,
      brackets: flat(0.05),
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(4_400, 8_800, 6_800),
      dependentExemption: 1_000,
      surcharge: { rate: 0.04, from: 1_083_150 },
    },
    {
      year: 2026,
      brackets: flat(0.05),
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(4_400, 8_800, 6_800),
      dependentExemption: 1_000,
      surcharge: { rate: 0.04, from: 1_107_750 },
    },
  ],
  MD: [
    {
      year: 2025,
      brackets: { single: MD_SINGLE, married_separate: MD_SINGLE, married_joint: MD_JOINT, head_of_household: MD_JOINT },
      standardDeduction: std(3_350, 6_700, 6_700),
      localTaxNote: true,
    },
    {
      year: 2026,
      brackets: { single: MD_SINGLE, married_separate: MD_SINGLE, married_joint: MD_JOINT, head_of_household: MD_JOINT },
      standardDeduction: std(3_350, 6_700, 6_700),
      localTaxNote: true,
    },
  ],
  ME: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.058, 0.0675, 0.0715], [26_800, 63_450]),
        married_separate: brackets([0.058, 0.0675, 0.0715], [26_800, 63_450]),
        married_joint: brackets([0.058, 0.0675, 0.0715], [53_600, 126_900]),
        head_of_household: brackets([0.058, 0.0675, 0.0715], [40_200, 95_150]),
      },
      standardDeduction: std(15_000, 30_000, 22_500),
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.058, 0.0675, 0.0715], [27_400, 64_850]),
        married_separate: brackets([0.058, 0.0675, 0.0715], [27_400, 64_850]),
        married_joint: brackets([0.058, 0.0675, 0.0715], [54_850, 129_750]),
        head_of_household: brackets([0.058, 0.0675, 0.0715], [41_150, 97_300]),
      },
      standardDeduction: std(15_700, 31_400, 23_550),
    },
  ],
  MI: [
    { year: 2025, brackets: flat(0.0425), standardDeduction: same(0), allowsItemized: false, personalExemption: std(5_800, 11_600, 5_800), dependentExemption: 5_800, localTaxNote: true },
    { year: 2026, brackets: flat(0.0425), standardDeduction: same(0), allowsItemized: false, personalExemption: std(5_900, 11_800, 5_900), dependentExemption: 5_900, localTaxNote: true },
  ],
  MN: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0535, 0.068, 0.0785, 0.0985], [32_570, 106_990, 198_630]),
        married_joint: brackets([0.0535, 0.068, 0.0785, 0.0985], [47_620, 189_180, 330_410]),
        married_separate: brackets([0.0535, 0.068, 0.0785, 0.0985], [23_810, 94_590, 165_205]),
        head_of_household: brackets([0.0535, 0.068, 0.0785, 0.0985], [40_100, 161_130, 264_050]),
      },
      standardDeduction: std(14_950, 29_900, 22_500),
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.0535, 0.068, 0.0785, 0.0985], [33_310, 109_430, 203_150]),
        married_joint: brackets([0.0535, 0.068, 0.0785, 0.0985], [48_700, 193_480, 337_930]),
        married_separate: brackets([0.0535, 0.068, 0.0785, 0.0985], [24_350, 96_740, 168_965]),
        head_of_household: brackets([0.0535, 0.068, 0.0785, 0.0985], [41_010, 164_790, 270_050]),
      },
      standardDeduction: std(15_300, 30_600, 23_025),
    },
  ],
  MO: [
    { year: 2025, brackets: MO_BRACKETS, standardDeduction: 'federal', localTaxNote: true },
    { year: 2026, brackets: MO_BRACKETS, standardDeduction: 'federal', localTaxNote: true },
  ],
  MS: [
    {
      year: 2025,
      brackets: sameBrackets(brackets([0, 0.044], [10_000])),
      standardDeduction: std(2_300, 4_600, 3_400),
      personalExemption: std(6_000, 12_000, 8_000),
      dependentExemption: 1_500,
    },
    {
      year: 2026,
      brackets: sameBrackets(brackets([0, 0.04], [10_000])),
      standardDeduction: std(2_300, 4_600, 3_400),
      personalExemption: std(6_000, 12_000, 8_000),
      dependentExemption: 1_500,
    },
  ],
  MT: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.047, 0.059], [21_100]),
        married_separate: brackets([0.047, 0.059], [21_100]),
        married_joint: brackets([0.047, 0.059], [42_200]),
        head_of_household: brackets([0.047, 0.059], [31_650]),
      },
      standardDeduction: 'federal',
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.047, 0.0565], [47_500]),
        married_separate: brackets([0.047, 0.0565], [47_500]),
        married_joint: brackets([0.047, 0.0565], [95_000]),
        head_of_household: brackets([0.047, 0.0565], [71_250]),
      },
      standardDeduction: 'federal',
    },
  ],
  NC: [
    { year: 2025, brackets: flat(0.0425), standardDeduction: std(12_750, 25_500, 19_125) },
    { year: 2026, brackets: flat(0.0399), standardDeduction: std(12_750, 25_500, 19_125) },
  ],
  ND: [
    {
      year: 2025,
      brackets: {
        single: brackets([0, 0.0195, 0.025], [48_475, 244_825]),
        married_joint: brackets([0, 0.0195, 0.025], [80_975, 298_075]),
        married_separate: brackets([0, 0.0195, 0.025], [40_487, 149_037]),
        head_of_household: brackets([0, 0.0195, 0.025], [64_850, 271_450]),
      },
      standardDeduction: 'federal',
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0, 0.0195, 0.025], [49_575, 250_400]),
        married_joint: brackets([0, 0.0195, 0.025], [82_800, 304_850]),
        married_separate: brackets([0, 0.0195, 0.025], [41_400, 152_425]),
        head_of_household: brackets([0, 0.0195, 0.025], [66_300, 277_625]),
      },
      standardDeduction: 'federal',
    },
  ],
  NE: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0246, 0.0351, 0.0501, 0.052], [4_030, 24_120, 38_870]),
        married_separate: brackets([0.0246, 0.0351, 0.0501, 0.052], [4_030, 24_120, 38_870]),
        married_joint: brackets([0.0246, 0.0351, 0.0501, 0.052], [8_060, 48_240, 77_730]),
        head_of_household: brackets([0.0246, 0.0351, 0.0501, 0.052], [7_500, 38_600, 57_260]),
      },
      standardDeduction: std(8_600, 17_200, 12_600),
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.0246, 0.0351, 0.0455], [4_130, 24_760]),
        married_separate: brackets([0.0246, 0.0351, 0.0455], [4_130, 24_760]),
        married_joint: brackets([0.0246, 0.0351, 0.0455], [8_250, 49_530]),
        head_of_household: brackets([0.0246, 0.0351, 0.0455], [7_690, 39_620]),
      },
      standardDeduction: std(8_850, 17_700, 13_000),
    },
  ],
  NJ: [
    {
      year: 2025,
      brackets: { single: NJ_SINGLE, married_separate: NJ_SINGLE, married_joint: NJ_JOINT, head_of_household: NJ_JOINT },
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(1_000, 2_000, 1_000),
      dependentExemption: 1_500,
      hsaTaxable: true,
    },
    {
      year: 2026,
      brackets: { single: NJ_SINGLE, married_separate: NJ_SINGLE, married_joint: NJ_JOINT, head_of_household: NJ_JOINT },
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(1_000, 2_000, 1_000),
      dependentExemption: 1_500,
      hsaTaxable: true,
    },
  ],
  NM: [
    { year: 2025, brackets: NM_BRACKETS, standardDeduction: 'federal' },
    { year: 2026, brackets: NM_BRACKETS, standardDeduction: 'federal' },
  ],
  NY: [
    {
      year: 2025,
      brackets: {
        single: brackets(NY_RATES_2025, NY_EDGES_SINGLE),
        married_separate: brackets(NY_RATES_2025, NY_EDGES_SINGLE),
        married_joint: brackets(NY_RATES_2025, NY_EDGES_JOINT),
        head_of_household: brackets(NY_RATES_2025, NY_EDGES_HOH),
      },
      standardDeduction: std(8_000, 16_050, 11_200),
      dependentExemption: 1_000,
      localTaxNote: true,
    },
    {
      year: 2026,
      brackets: {
        single: brackets(NY_RATES_2026, NY_EDGES_SINGLE),
        married_separate: brackets(NY_RATES_2026, NY_EDGES_SINGLE),
        married_joint: brackets(NY_RATES_2026, NY_EDGES_JOINT),
        head_of_household: brackets(NY_RATES_2026, NY_EDGES_HOH),
      },
      standardDeduction: std(8_000, 16_050, 11_200),
      dependentExemption: 1_000,
      localTaxNote: true,
    },
  ],
  OH: [
    {
      year: 2025,
      brackets: sameBrackets(brackets([0, 0.0275, 0.03125], [26_050, 100_000])),
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(2_400, 4_800, 2_400),
      dependentExemption: 2_150,
      localTaxNote: true,
    },
    {
      year: 2026,
      brackets: sameBrackets(brackets([0, 0.0275], [26_050])),
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(2_400, 4_800, 2_400),
      dependentExemption: 2_150,
      localTaxNote: true,
    },
  ],
  OK: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0025, 0.0075, 0.0175, 0.0275, 0.0375, 0.0475], [1_000, 2_500, 3_750, 4_900, 7_200]),
        married_separate: brackets([0.0025, 0.0075, 0.0175, 0.0275, 0.0375, 0.0475], [1_000, 2_500, 3_750, 4_900, 7_200]),
        married_joint: brackets([0.0025, 0.0075, 0.0175, 0.0275, 0.0375, 0.0475], [2_000, 5_000, 7_500, 9_800, 14_400]),
        head_of_household: brackets([0.0025, 0.0075, 0.0175, 0.0275, 0.0375, 0.0475], [2_000, 5_000, 7_500, 9_800, 14_400]),
      },
      standardDeduction: std(6_350, 12_700, 9_350),
      personalExemption: std(1_000, 2_000, 1_000),
      dependentExemption: 1_000,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0, 0.025, 0.035, 0.045], [3_750, 4_900, 7_200]),
        married_separate: brackets([0, 0.025, 0.035, 0.045], [3_750, 4_900, 7_200]),
        married_joint: brackets([0, 0.025, 0.035, 0.045], [7_500, 9_800, 14_400]),
        head_of_household: brackets([0, 0.025, 0.035, 0.045], [7_500, 9_800, 14_400]),
      },
      standardDeduction: std(6_350, 12_700, 9_350),
      personalExemption: std(1_000, 2_000, 1_000),
      dependentExemption: 1_000,
    },
  ],
  OR: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0475, 0.0675, 0.0875, 0.099], [4_400, 11_100, 125_000]),
        married_separate: brackets([0.0475, 0.0675, 0.0875, 0.099], [4_400, 11_100, 125_000]),
        married_joint: brackets([0.0475, 0.0675, 0.0875, 0.099], [8_800, 22_200, 250_000]),
        head_of_household: brackets([0.0475, 0.0675, 0.0875, 0.099], [8_800, 22_200, 250_000]),
      },
      standardDeduction: std(2_835, 5_670, 4_560),
      personalCredit: std(256, 512, 256),
      dependentCredit: 256,
      localTaxNote: true,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.0475, 0.0675, 0.0875, 0.099], [4_550, 11_400, 125_000]),
        married_separate: brackets([0.0475, 0.0675, 0.0875, 0.099], [4_550, 11_400, 125_000]),
        married_joint: brackets([0.0475, 0.0675, 0.0875, 0.099], [9_100, 22_800, 250_000]),
        head_of_household: brackets([0.0475, 0.0675, 0.0875, 0.099], [9_100, 22_800, 250_000]),
      },
      standardDeduction: std(2_910, 5_820, 4_685),
      personalCredit: std(256, 512, 256),
      dependentCredit: 256,
      localTaxNote: true,
    },
  ],
  PA: [
    { year: 2025, brackets: flat(0.0307), standardDeduction: same(0), allowsItemized: false, localTaxNote: true },
    { year: 2026, brackets: flat(0.0307), standardDeduction: same(0), allowsItemized: false, localTaxNote: true },
  ],
  RI: [
    { year: 2025, brackets: sameBrackets(brackets([0.0375, 0.0475, 0.0599], [79_900, 181_650])), standardDeduction: std(10_900, 21_800, 16_350) },
    { year: 2026, brackets: sameBrackets(brackets([0.0375, 0.0475, 0.0599], [82_050, 186_450])), standardDeduction: std(11_200, 22_400, 16_800) },
  ],
  SC: [
    { year: 2025, brackets: sameBrackets(brackets([0, 0.03, 0.06], [3_560, 17_830])), standardDeduction: 'federal' },
    { year: 2026, brackets: sameBrackets(brackets([0.0199, 0.0521], [30_000])), standardDeduction: std(15_000, 30_000, 22_500) },
  ],
  UT: [
    {
      year: 2025,
      brackets: flat(0.0455),
      standardDeduction: same(0),
      allowsItemized: false,
      deductionCredit: { rate: 0.06, phaseOutRate: 0.013, phaseOutFrom: { single: 17_844, married_separate: 17_844, head_of_household: 26_766, married_joint: 35_688 } },
    },
    {
      year: 2026,
      brackets: flat(0.045),
      standardDeduction: same(0),
      allowsItemized: false,
      deductionCredit: { rate: 0.06, phaseOutRate: 0.013, phaseOutFrom: { single: 17_844, married_separate: 17_844, head_of_household: 26_766, married_joint: 35_688 } },
    },
  ],
  VA: [
    { year: 2025, brackets: VA_BRACKETS, standardDeduction: std(8_750, 17_500, 8_750), personalExemption: std(930, 1_860, 930), dependentExemption: 930 },
    { year: 2026, brackets: VA_BRACKETS, standardDeduction: std(8_750, 17_500, 8_750), personalExemption: std(930, 1_860, 930), dependentExemption: 930 },
  ],
  VT: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0335, 0.066, 0.076, 0.0875], [49_400, 119_700, 249_700]),
        married_joint: brackets([0.0335, 0.066, 0.076, 0.0875], [82_500, 199_450, 304_000]),
        married_separate: brackets([0.0335, 0.066, 0.076, 0.0875], [41_250, 99_725, 152_000]),
        head_of_household: brackets([0.0335, 0.066, 0.076, 0.0875], [66_100, 170_850, 276_750]),
      },
      standardDeduction: std(7_650, 15_300, 11_475),
      personalExemption: std(5_300, 10_600, 5_300),
      dependentExemption: 5_300,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.0335, 0.066, 0.076, 0.0875], [50_750, 122_850, 256_300]),
        married_joint: brackets([0.0335, 0.066, 0.076, 0.0875], [84_700, 204_750, 312_050]),
        married_separate: brackets([0.0335, 0.066, 0.076, 0.0875], [42_350, 102_375, 156_025]),
        head_of_household: brackets([0.0335, 0.066, 0.076, 0.0875], [67_900, 175_450, 284_200]),
      },
      standardDeduction: std(7_850, 15_700, 11_775),
      personalExemption: std(5_300, 10_600, 5_300),
      dependentExemption: 5_300,
    },
  ],
  WI: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.035, 0.044, 0.053, 0.0765], [14_680, 50_480, 323_290]),
        head_of_household: brackets([0.035, 0.044, 0.053, 0.0765], [14_680, 50_480, 323_290]),
        married_joint: brackets([0.035, 0.044, 0.053, 0.0765], [19_580, 67_300, 431_060]),
        married_separate: brackets([0.035, 0.044, 0.053, 0.0765], [9_790, 33_650, 215_530]),
      },
      standardDeduction: std(13_530, 25_310, 17_500, 12_020),
      personalExemption: std(700, 1_400, 700),
      dependentExemption: 700,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.035, 0.044, 0.053, 0.0765], [15_110, 51_950, 332_720]),
        head_of_household: brackets([0.035, 0.044, 0.053, 0.0765], [15_110, 51_950, 332_720]),
        married_joint: brackets([0.035, 0.044, 0.053, 0.0765], [20_150, 69_260, 443_630]),
        married_separate: brackets([0.035, 0.044, 0.053, 0.0765], [10_075, 34_630, 221_815]),
      },
      standardDeduction: std(13_960, 26_120, 18_060, 12_400),
      personalExemption: std(700, 1_400, 700),
      dependentExemption: 700,
    },
  ],
  WV: [
    {
      year: 2025,
      brackets: {
        single: brackets([0.0222, 0.0296, 0.0333, 0.0444, 0.0482], [10_000, 25_000, 40_000, 60_000]),
        married_joint: brackets([0.0222, 0.0296, 0.0333, 0.0444, 0.0482], [10_000, 25_000, 40_000, 60_000]),
        head_of_household: brackets([0.0222, 0.0296, 0.0333, 0.0444, 0.0482], [10_000, 25_000, 40_000, 60_000]),
        married_separate: brackets([0.0222, 0.0296, 0.0333, 0.0444, 0.0482], [5_000, 12_500, 20_000, 30_000]),
      },
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(2_000, 4_000, 2_000),
      dependentExemption: 2_000,
    },
    {
      year: 2026,
      brackets: {
        single: brackets([0.0211, 0.0281, 0.0316, 0.0422, 0.0458], [10_000, 25_000, 40_000, 60_000]),
        married_joint: brackets([0.0211, 0.0281, 0.0316, 0.0422, 0.0458], [10_000, 25_000, 40_000, 60_000]),
        head_of_household: brackets([0.0211, 0.0281, 0.0316, 0.0422, 0.0458], [10_000, 25_000, 40_000, 60_000]),
        married_separate: brackets([0.0211, 0.0281, 0.0316, 0.0422, 0.0458], [5_000, 12_500, 20_000, 30_000]),
      },
      standardDeduction: same(0),
      allowsItemized: false,
      personalExemption: std(2_000, 4_000, 2_000),
      dependentExemption: 2_000,
    },
  ],
};

const FEDERAL = [FEDERAL_2025, FEDERAL_2026];

/** The tables for `year`, or the nearest year Meld has (`year` on the result says which). */
function nearest<T extends { year: number }>(tables: T[], year: number): T {
  return tables.find((t) => t.year === year) ?? (year < tables[0]!.year ? tables[0]! : tables.at(-1)!);
}
export const federalTables = (year: number) => nearest(FEDERAL, year);

/** States without a tax on wages and investment income. */
export const NO_INCOME_TAX_STATES = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']);

/** Built-in state income tax tables for `state` and `year`, or null for no-tax/unknown states. */
export function stateTables(state: string | null | undefined, year: number): StateYearTable | null {
  if (!state) return null;
  const code = state.trim().toUpperCase();
  if (NO_INCOME_TAX_STATES.has(code)) return null;
  const tables = STATE_TABLES[code];
  return tables ? nearest(tables, year) : null;
}

/** @deprecated Use `stateTables('CA', year)` instead. */
export const californiaTables = (year: number) => stateTables('CA', year)!;

/** Computes state taxable income, tax liability, and top marginal rate from a `StateYearTable`. */
export function calculateStateTax({
  table,
  year,
  status,
  federalAgi,
  hsa = 0,
  itemizedNonSalt = 0,
  dependents = 0,
}: {
  table: StateYearTable;
  year: number;
  status: TableStatus;
  federalAgi: number;
  hsa?: number;
  itemizedNonSalt?: number;
  dependents?: number;
}): { taxableIncome: number; total: number; bracketRate: number } {
  const stateAgi = federalAgi + (table.hsaTaxable ? hsa : 0);
  const fedStd = federalTables(year).standardDeduction[status];
  const stdDed = table.standardDeduction === 'federal' ? fedStd : table.standardDeduction[status];
  const canItemize = table.allowsItemized ?? stdDed > 0;
  const deduction = canItemize ? Math.max(stdDed, itemizedNonSalt) : stdDed;
  const exemptions = (table.personalExemption?.[status] ?? 0) + dependents * (table.dependentExemption ?? 0);
  const taxable = Math.max(0, stateAgi - deduction - exemptions);
  const surcharge = table.surcharge ? table.surcharge.rate * Math.max(0, taxable - table.surcharge.from) : 0;

  let credits = 0;
  if (table.personalCredit || table.dependentCredit) {
    if (table.creditPhaseOutFrom) {
      const steps = Math.ceil(
        Math.max(0, federalAgi - table.creditPhaseOutFrom[status]) / (status === 'married_separate' ? 1_250 : 2_500),
      );
      const people = status === 'married_joint' ? 2 : 1;
      credits +=
        Math.max(0, (table.personalCredit?.[status] ?? 0) - 6 * steps * people) +
        dependents * Math.max(0, (table.dependentCredit ?? 0) - 6 * steps);
    } else {
      credits += (table.personalCredit?.[status] ?? 0) + dependents * (table.dependentCredit ?? 0);
    }
  }
  if (table.deductionCredit) {
    const baseCredit = table.deductionCredit.rate * Math.max(fedStd, itemizedNonSalt);
    credits += Math.max(
      0,
      baseCredit - table.deductionCredit.phaseOutRate * Math.max(0, stateAgi - table.deductionCredit.phaseOutFrom[status]),
    );
  }

  const total = Math.max(0, bracketTax(table.brackets[status], taxable) + surcharge - credits);
  const bracketRate =
    bracketAt(table.brackets[status], taxable).rate + (table.surcharge && taxable > table.surcharge.from ? table.surcharge.rate : 0);
  return { taxableIncome: taxable, total, bracketRate };
}

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

/**
 * Rough after-tax annual take-home pay for one still-working earner during a staggered-retirement
 * bridge year, used to estimate how much of household spending their paycheck covers.
 */
export function estimateAfterTaxIncome(
  grossAnnual: number,
  filingStatus: FilingStatus | null,
  state: string | null,
): number {
  if (grossAnnual <= 0) return 0;
  const fed = federalTables(2026);
  const status = tableStatus(filingStatus ?? 'married_joint');
  const fedTaxable = Math.max(0, grossAnnual - fed.standardDeduction[status]);
  const federalTax = bracketTax(fed.brackets[status], fedTaxable);
  const fica =
    0.062 * Math.min(grossAnnual, fed.socialSecurityWageBase) +
    0.0145 * grossAnnual +
    0.009 * Math.max(0, grossAnnual - fed.additionalMedicareThreshold[status]);
  const st = state?.trim().toUpperCase();
  let stateTax = 0;
  if (st && !NO_INCOME_TAX_STATES.has(st)) {
    const tbl = stateTables(st, 2026);
    if (tbl) {
      stateTax = calculateStateTax({ table: tbl, year: 2026, status, federalAgi: grossAnnual }).total;
    } else {
      stateTax = 0.05 * fedTaxable;
    }
  }
  return Math.max(0, Math.round(grossAnnual - federalTax - fica - stateTax));
}
