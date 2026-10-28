import { z } from 'zod';
import { TaxTreatment } from './investments';

/**
 * Retirement assumptions. Every field is optional: null means "use the default" (see
 * RETIREMENT_DEFAULTS and RetirementSummary['defaults']). Amounts are yearly, in today's dollars.
 */
export const RetirementPlan = z.object({
  retirementAge: z.number().int().min(18).max(100).nullable(),
  lifeExpectancy: z.number().int().min(50).max(120).nullable(),
  /** What you and your employer put in each year, all accounts together. */
  annualContribution: z.number().nonnegative().nullable(),
  /** Yearly return after inflation, in percent. */
  expectedReturn: z.number().min(-5).max(15).nullable(),
  /** Yearly spending in retirement. */
  annualSpending: z.number().nonnegative().nullable(),
  socialSecurityAnnual: z.number().nonnegative().nullable(),
  socialSecurityAge: z.number().int().min(62).max(70).nullable(),
  pensionAnnual: z.number().nonnegative().nullable(),
  /** Savings outside investment accounts that you'll put toward retirement, e.g. earmarked cash. */
  otherSavings: z.number().nonnegative().nullable(),
  /** Investment accounts you've left out (e.g. saving for a house). */
  excludedAccountIds: z.array(z.string().uuid()),
});
export type RetirementPlan = z.infer<typeof RetirementPlan>;

export const EMPTY_RETIREMENT_PLAN: RetirementPlan = {
  retirementAge: null,
  lifeExpectancy: null,
  annualContribution: null,
  expectedReturn: null,
  annualSpending: null,
  socialSecurityAnnual: null,
  socialSecurityAge: null,
  pensionAnnual: null,
  otherSavings: null,
  excludedAccountIds: [],
};

export const RETIREMENT_DEFAULTS = {
  retirementAge: 65,
  lifeExpectancy: 95,
  expectedReturn: 5,
  socialSecurityAge: 67,
} as const;

export const RetirementAccount = z.object({
  id: z.string().uuid(),
  name: z.string(),
  institutionName: z.string().nullable(),
  subtype: z.string().nullable(),
  taxTreatment: TaxTreatment,
  /** Your share of the balance. */
  value: z.number(),
  included: z.boolean(),
  /** Education and custodial accounts are always left out; others only when you exclude them. */
  excludedReason: z.enum(['education', 'user']).nullable(),
});
export type RetirementAccount = z.infer<typeof RetirementAccount>;

export const RetirementSummary = z.object({
  plan: RetirementPlan,
  /** What Meld fills in when a field is left empty; null when it can't tell. */
  defaults: z.object({
    /** From the profile's birth year. */
    currentAge: z.number().nullable(),
    /** Spending over the last 12 months of cash flow. */
    annualSpending: z.number().nullable(),
    /** Household gross income from the profile. */
    annualIncome: z.number().nullable(),
  }),
  /** Visible investment accounts, largest first. */
  accounts: z.array(RetirementAccount),
});
export type RetirementSummary = z.infer<typeof RetirementSummary>;

const EDUCATION = new Set(['529', 'education savings account', 'coverdell', 'coverdell esa', 'resp', 'ugma', 'utma']);

/** College savings and custodial accounts belong to (or are earmarked for) someone else. */
export function isEducationAccount(subtype: string | null): boolean {
  return !!subtype && EDUCATION.has(subtype.toLowerCase());
}

/** Everything the projection needs, with defaults filled in. */
export type RetirementInputs = {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  startingBalance: number;
  annualContribution: number;
  /** Percent, after inflation. */
  expectedReturn: number;
  annualSpending: number;
  socialSecurityAnnual: number;
  socialSecurityAge: number;
  pensionAnnual: number;
};

export type MissingInput = 'birth year' | 'retirement spending';

/** `inputs` is null exactly when something in `missing` can't be defaulted. */
export type ResolvedPlan = { inputs: RetirementInputs | null; missing: MissingInput[] };

/** Counted balance: included accounts plus other savings. */
export function retirementBalance(summary: Pick<RetirementSummary, 'accounts'>, plan: Pick<RetirementPlan, 'otherSavings'>) {
  return summary.accounts.filter((a) => a.included).reduce((sum, a) => sum + a.value, 0) + (plan.otherSavings ?? 0);
}

/** Fills empty fields from defaults; null inputs when age or spending can't be known. */
export function resolvePlan(plan: RetirementPlan, summary: Pick<RetirementSummary, 'defaults' | 'accounts'>): ResolvedPlan {
  const currentAge = summary.defaults.currentAge;
  const annualSpending = plan.annualSpending ?? summary.defaults.annualSpending;
  const missing: MissingInput[] = [
    ...(currentAge === null ? (['birth year'] as const) : []),
    ...(annualSpending === null ? (['retirement spending'] as const) : []),
  ];
  if (currentAge === null || annualSpending === null) return { inputs: null, missing };
  const retirementAge = plan.retirementAge ?? Math.max(RETIREMENT_DEFAULTS.retirementAge, currentAge);
  return {
    inputs: {
      currentAge,
      retirementAge,
      // Plan at least a year past retirement, and past today.
      lifeExpectancy: Math.max(plan.lifeExpectancy ?? RETIREMENT_DEFAULTS.lifeExpectancy, retirementAge + 1, currentAge + 1),
      startingBalance: retirementBalance(summary, plan),
      annualContribution: plan.annualContribution ?? 0,
      expectedReturn: plan.expectedReturn ?? RETIREMENT_DEFAULTS.expectedReturn,
      annualSpending,
      socialSecurityAnnual: plan.socialSecurityAnnual ?? 0,
      socialSecurityAge: plan.socialSecurityAge ?? RETIREMENT_DEFAULTS.socialSecurityAge,
      pensionAnnual: plan.pensionAnnual ?? 0,
    },
    missing: [],
  };
}

export type RetirementProjection = {
  /** Balance at the start of each age, from today's age to life expectancy. */
  points: { age: number; balance: number }[];
  /** Projected balance on reaching retirement age. */
  atRetirement: number;
  /** Balance needed at retirement age for the money to last to life expectancy. */
  needed: number;
  /** needed − atRetirement; zero or less means on track. */
  gap: number;
  /** Extra monthly contribution that closes the gap; null when already retired (or no gap). */
  extraMonthly: number | null;
  /** First age the money can't cover that year's spending; null if it lasts. */
  depletionAge: number | null;
};

/** Spending the portfolio must cover at an age, after Social Security and pension. */
function withdrawalAt(i: RetirementInputs, age: number) {
  const income = i.pensionAnnual + (age >= i.socialSecurityAge ? i.socialSecurityAnnual : 0);
  return Math.max(0, i.annualSpending - income);
}

/**
 * Year-by-year projection in today's dollars. Before retirement, a year's growth is followed by that
 * year's contribution; in retirement, the year's withdrawal comes out first and the rest grows.
 */
export function projectRetirement(i: RetirementInputs): RetirementProjection {
  const r = i.expectedReturn / 100;
  const points: RetirementProjection['points'] = [];
  let balance = i.startingBalance;
  let atRetirement = i.startingBalance;
  let depletionAge: number | null = null;

  for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
    points.push({ age, balance: Math.round(balance) });
    if (age === i.retirementAge) atRetirement = balance;
    if (age === i.lifeExpectancy) break;
    if (age < i.retirementAge) {
      balance = balance * (1 + r) + i.annualContribution;
    } else {
      const need = withdrawalAt(i, age);
      if (need > balance + 0.005 && depletionAge === null) depletionAge = age;
      balance = Math.max(0, balance - need) * (1 + r);
    }
  }
  if (i.retirementAge <= i.currentAge) atRetirement = i.startingBalance;

  // Present value at retirement of each year's withdrawal, mirroring the loop above.
  const start = Math.max(i.retirementAge, i.currentAge);
  let needed = 0;
  for (let age = start; age < i.lifeExpectancy; age++) needed += withdrawalAt(i, age) / (1 + r) ** (age - start);

  // Whole dollars, with what's needed rounded up so saving exactly that much is enough.
  const neededDollars = Math.max(0, Math.ceil(needed - 0.005));
  const atRetirementDollars = Math.round(atRetirement);
  const gap = neededDollars - atRetirementDollars;
  const years = i.retirementAge - i.currentAge;
  let extraMonthly: number | null = null;
  if (gap > 0 && years > 0) {
    // Contributions at the end of each year grow to annual × ((1+r)^n − 1) / r.
    const growth = r === 0 ? years : ((1 + r) ** years - 1) / r;
    extraMonthly = Math.ceil(gap / growth / 12);
  }

  return {
    points,
    atRetirement: atRetirementDollars,
    needed: neededDollars,
    gap,
    extraMonthly,
    depletionAge,
  };
}
