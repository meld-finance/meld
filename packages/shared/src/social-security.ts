/**
 * Social Security estimates in today's dollars. Benefits are wage-indexed, so holding today's pay steady
 * and using today's formula gives a benefit in roughly today's dollars.
 */

/** 2026 figures: the PIA formula's bend points (monthly) and the most earnings taxed in a year. */
export const SOCIAL_SECURITY_2026 = {
  bendPoints: [1286, 7749],
  wageBase: 184_500,
} as const;

/** Years of earnings the benefit averages over. */
const CAREER_YEARS = 35;
/** Assumed first year of full-time work. */
const START_WORK_AGE = 22;

/** Full retirement age in months: 66 for 1943–54, rising two months a year to 67 for 1960 and later. */
export function fullRetirementAgeMonths(birthYear: number): number {
  if (birthYear <= 1954) return 66 * 12;
  if (birthYear >= 1960) return 67 * 12;
  return 66 * 12 + (birthYear - 1954) * 2;
}

/** "67" or "66 and 4 months". */
export function formatFullRetirementAge(birthYear: number): string {
  const months = fullRetirementAgeMonths(birthYear);
  const years = Math.floor(months / 12);
  return months % 12 ? `${years} and ${months % 12} months` : String(years);
}

/**
 * The share of the full benefit received when claiming at `claimAge`: 5/9% less per month early for
 * the first 36 months and 5/12% beyond, or 2/3% more per month delayed, up to age 70.
 */
export function claimingFactor(birthYear: number, claimAge: number): number {
  const months = Math.min(claimAge, 70) * 12 - fullRetirementAgeMonths(birthYear);
  if (months >= 0) return 1 + (months * 2) / 3 / 100;
  const early = -months;
  return 1 - (Math.min(early, 36) * 5) / 9 / 100 - (Math.max(early - 36, 0) * 5) / 12 / 100;
}

/** Monthly benefit at full retirement age for average indexed monthly earnings `aime`. */
export function primaryInsuranceAmount(aime: number): number {
  const [b1, b2] = SOCIAL_SECURITY_2026.bendPoints;
  return 0.9 * Math.min(aime, b1) + 0.32 * Math.max(0, Math.min(aime, b2) - b1) + 0.15 * Math.max(0, aime - b2);
}

/** One earner's monthly benefit at full retirement age, working from 22 until `stopWorkAge` at `annualPay`. */
function earnerBenefit(annualPay: number, stopWorkAge: number): number {
  const years = Math.min(CAREER_YEARS, Math.max(0, stopWorkAge - START_WORK_AGE));
  const aime = (Math.min(annualPay, SOCIAL_SECURITY_2026.wageBase) * years) / CAREER_YEARS / 12;
  return primaryInsuranceAmount(aime);
}

/**
 * Estimated household benefit per month at full retirement age, from gross income and the age you stop
 * working. A couple's split of income is unknown, so it takes the lower of one earner (whose spouse
 * gets half their benefit) and two equal earners.
 */
export function estimateSocialSecurityMonthly(annualIncome: number, stopWorkAge: number, married: boolean): number {
  if (!married) return Math.round(earnerBenefit(annualIncome, stopWorkAge));
  const oneEarner = 1.5 * earnerBenefit(annualIncome, stopWorkAge);
  const twoEarners = 2 * earnerBenefit(annualIncome / 2, stopWorkAge);
  return Math.round(Math.min(oneEarner, twoEarners));
}
