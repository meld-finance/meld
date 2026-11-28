/**
 * IRS Uniform Lifetime Table (Publication 590-B, Table III, effective 2022+)
 * and SECURE 2.0 RMD starting-age rules.
 */

/** IRS Uniform Lifetime Table distribution periods for ages 72–120. */
const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/**
 * The age when IRS Required Minimum Distributions (RMDs) begin under SECURE 2.0:
 * - Born 1950 or earlier: 72
 * - Born 1951–1959: 73
 * - Born 1960 or later: 75
 */
export function rmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

/** IRS Uniform Lifetime Table divisor for `age` (null below 72; clamped to 2.0 at 120+). */
export function rmdDistributionPeriod(age: number): number | null {
  const whole = Math.floor(age);
  if (whole < 72) return null;
  if (whole >= 120) return 2.0;
  return UNIFORM_LIFETIME_TABLE[whole] ?? null;
}

/** Required minimum distribution for `age`, given prior-year-end pre-tax balance and owner's `birthYear`. */
export function calculateRmd(priorYearEndBalance: number, age: number, birthYear: number): number {
  if (priorYearEndBalance <= 0) return 0;
  if (age < rmdStartAge(birthYear)) return 0;
  const period = rmdDistributionPeriod(age);
  if (!period) return 0;
  return Math.min(priorYearEndBalance, priorYearEndBalance / period);
}
