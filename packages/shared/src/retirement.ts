import { z } from 'zod';
import { TaxTreatment } from './investments';
import { remainingLoanBalance } from './liabilities';
import { claimingFactor, estimateSocialSecurityMonthly } from './social-security';

/** A property you plan to sell to help fund retirement. Properties not listed aren't counted. */
export const PropertySale = z.object({
  /** A manual asset of kind `home`. */
  assetId: z.string().uuid(),
  sellAge: z.number().int().min(18).max(120),
  /** The mortgage on it, paid off from the sale. */
  mortgageAccountId: z.string().uuid().nullable(),
  /** Rent minus costs per year until the sale; negative if it costs more than it earns. */
  netRentAnnual: z.number().nullable(),
});
export type PropertySale = z.infer<typeof PropertySale>;

/** A change to yearly spending over a span of ages, e.g. kids leaving home or a mortgage paid off. */
export const SpendingChange = z.object({
  label: z.string().trim().min(1).max(60),
  startAge: z.number().int().min(18).max(120),
  /** The first age it no longer applies; null if it never ends. */
  endAge: z.number().int().min(18).max(120).nullable(),
  /** Added to yearly spending, in today's dollars; negative for spending less. */
  annualChange: z.number(),
});
export type SpendingChange = z.infer<typeof SpendingChange>;

/**
 * Retirement assumptions. Every number is optional: null means "use the default" (see
 * RETIREMENT_DEFAULTS and RetirementSummary['defaults']). Amounts are yearly, in today's dollars.
 */
export const RetirementPlan = z.object({
  retirementAge: z.number().int().min(18).max(100).nullable(),
  lifeExpectancy: z.number().int().min(50).max(120).nullable(),
  /** What you and your employer put in each year, all accounts together. */
  annualContribution: z.number().nonnegative().nullable(),
  /** Yearly return after inflation, in percent. */
  expectedReturn: z.number().min(-5).max(15).nullable(),
  /** Yearly spending today; spending changes and the slowdown with age adjust it from there. */
  annualSpending: z.number().nonnegative().nullable(),
  /** How much less you spend each year after SPENDING_DECLINE_AGE, in percent. */
  spendingDeclinePercent: z.number().min(0).max(5).nullable(),
  /** Yearly benefit at full retirement age (the statement's figure); empty estimates it from income. */
  socialSecurityAnnual: z.number().nonnegative().nullable(),
  /** When you claim; the benefit shrinks before full retirement age and grows after, up to 70. */
  socialSecurityAge: z.number().int().min(62).max(70).nullable(),
  pensionAnnual: z.number().nonnegative().nullable(),
  /** Savings outside investment accounts that you'll put toward retirement, e.g. earmarked cash. */
  otherSavings: z.number().nonnegative().nullable(),
  /** Yearly rise in property values after inflation, in percent. */
  propertyAppreciation: z.number().min(-5).max(10).nullable(),
  /** Agent fees and closing costs on a sale, as a percent of the price. */
  sellingCostPercent: z.number().min(0).max(20).nullable(),
  /** Investment accounts you've left out (e.g. saving for a house). */
  excludedAccountIds: z.array(z.string().uuid()),
  properties: z.array(PropertySale),
  spendingChanges: z.array(SpendingChange),
});
export type RetirementPlan = z.infer<typeof RetirementPlan>;

export const EMPTY_RETIREMENT_PLAN: RetirementPlan = {
  retirementAge: null,
  lifeExpectancy: null,
  annualContribution: null,
  expectedReturn: null,
  annualSpending: null,
  spendingDeclinePercent: null,
  socialSecurityAnnual: null,
  socialSecurityAge: null,
  pensionAnnual: null,
  otherSavings: null,
  propertyAppreciation: null,
  sellingCostPercent: null,
  excludedAccountIds: [],
  properties: [],
  spendingChanges: [],
};

export const RETIREMENT_DEFAULTS = {
  retirementAge: 65,
  lifeExpectancy: 95,
  expectedReturn: 5,
  socialSecurityAge: 67,
  /** Roughly the long-run rise in US home prices above inflation. */
  propertyAppreciation: 1,
  sellingCostPercent: 6,
  /** Households 75 and older spend about a fifth less than those 65–74 (BLS Consumer Expenditure Survey). */
  spendingDeclinePercent: 1,
} as const;

/** The age spending starts to slow. */
export const SPENDING_DECLINE_AGE = 75;

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

export const RetirementProperty = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  /** Your share of today's value. */
  value: z.number(),
});
export type RetirementProperty = z.infer<typeof RetirementProperty>;

export const RetirementMortgage = z.object({
  id: z.string().uuid(),
  name: z.string(),
  institutionName: z.string().nullable(),
  /** Your share of what's owed. */
  balance: z.number(),
  interestRatePct: z.number().nullable(),
  /** Your share of the monthly payment; may include escrow. */
  monthlyPayment: z.number().nullable(),
});
export type RetirementMortgage = z.infer<typeof RetirementMortgage>;

export const RetirementSummary = z.object({
  plan: RetirementPlan,
  /** What Meld fills in when a field is left empty; null when it can't tell. */
  defaults: z.object({
    /** From the profile's birth year. */
    currentAge: z.number().nullable(),
    birthYear: z.number().nullable(),
    /** Married, from the filing status: the Social Security estimate counts a spouse. */
    married: z.boolean(),
    /** Spending over the last 12 months of cash flow. */
    annualSpending: z.number().nullable(),
    /** Household gross income from the profile. */
    annualIncome: z.number().nullable(),
    /** From the profile, to suggest when spending on kids ends. */
    dependents: z.number().nullable(),
  }),
  /** Visible investment accounts, largest first. */
  accounts: z.array(RetirementAccount),
  /** Homes entered on the Accounts tab, largest first. */
  properties: z.array(RetirementProperty),
  /** Visible mortgage accounts, to pair with a property. */
  mortgages: z.array(RetirementMortgage),
});
export type RetirementSummary = z.infer<typeof RetirementSummary>;

const EDUCATION = new Set(['529', 'education savings account', 'coverdell', 'coverdell esa', 'resp', 'ugma', 'utma']);

/** College savings and custodial accounts belong to (or are earmarked for) someone else. */
export function isEducationAccount(subtype: string | null): boolean {
  return !!subtype && EDUCATION.has(subtype.toLowerCase());
}

/** A property sale as the projection sees it. */
export type SaleEvent = {
  name: string;
  age: number;
  /** Your share of the price after appreciation and selling costs, less the mortgage left. */
  proceeds: number;
  /** Net rent each year until the sale. */
  netRentAnnual: number;
};

/** Everything the projection needs, with defaults filled in. */
export type RetirementInputs = {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  startingBalance: number;
  annualContribution: number;
  /** Percent, after inflation. */
  expectedReturn: number;
  /** Today's; see spendingAt. */
  annualSpending: number;
  spendingChanges: SpendingChange[];
  /** Percent a year after SPENDING_DECLINE_AGE. */
  spendingDeclinePercent: number;
  /** Yearly, as received from the claiming age. */
  socialSecurityAnnual: number;
  socialSecurityAge: number;
  pensionAnnual: number;
  sales: SaleEvent[];
};

/** Social Security at full retirement age, yearly: from the plan, else estimated from income. */
export function socialSecurityAtFullAge(
  plan: Pick<RetirementPlan, 'socialSecurityAnnual'>,
  defaults: Pick<RetirementSummary['defaults'], 'annualIncome' | 'married'>,
  retirementAge: number,
): { annual: number; estimated: boolean } {
  if (plan.socialSecurityAnnual !== null) return { annual: plan.socialSecurityAnnual, estimated: false };
  if (!defaults.annualIncome) return { annual: 0, estimated: false };
  return { annual: 12 * estimateSocialSecurityMonthly(defaults.annualIncome, retirementAge, defaults.married), estimated: true };
}

export type MissingInput = 'birth year' | 'retirement spending';

/** `inputs` is null exactly when something in `missing` can't be defaulted. */
export type ResolvedPlan = { inputs: RetirementInputs | null; missing: MissingInput[] };

type SummaryParts = Pick<RetirementSummary, 'defaults' | 'accounts' | 'properties' | 'mortgages'>;

/** Counted balance: included accounts plus other savings. */
export function retirementBalance(summary: Pick<RetirementSummary, 'accounts'>, plan: Pick<RetirementPlan, 'otherSavings'>) {
  return summary.accounts.filter((a) => a.included).reduce((sum, a) => sum + a.value, 0) + (plan.otherSavings ?? 0);
}

/**
 * Net proceeds of selling a property `years` from now. The price is in today's dollars; the mortgage
 * left is in future dollars, which overstates it a little and keeps the estimate conservative.
 */
export function saleProceeds(
  property: Pick<RetirementProperty, 'value'>,
  mortgage: Pick<RetirementMortgage, 'balance' | 'interestRatePct' | 'monthlyPayment'> | null,
  years: number,
  appreciationPct: number,
  sellingCostPct: number,
): number {
  const price = property.value * (1 + appreciationPct / 100) ** years;
  const owed = mortgage ? remainingLoanBalance(mortgage.balance, mortgage.interestRatePct, mortgage.monthlyPayment, years * 12) : 0;
  return Math.round(price * (1 - sellingCostPct / 100) - owed);
}

/** Fills empty fields from defaults; null inputs when age or spending can't be known. */
export function resolvePlan(plan: RetirementPlan, summary: SummaryParts): ResolvedPlan {
  const { currentAge, birthYear } = summary.defaults;
  const annualSpending = plan.annualSpending ?? summary.defaults.annualSpending;
  const missing: MissingInput[] = [
    ...(currentAge === null || birthYear === null ? (['birth year'] as const) : []),
    ...(annualSpending === null ? (['retirement spending'] as const) : []),
  ];
  if (currentAge === null || birthYear === null || annualSpending === null) return { inputs: null, missing };
  const retirementAge = plan.retirementAge ?? Math.max(RETIREMENT_DEFAULTS.retirementAge, currentAge);
  const appreciation = plan.propertyAppreciation ?? RETIREMENT_DEFAULTS.propertyAppreciation;
  const sellingCost = plan.sellingCostPercent ?? RETIREMENT_DEFAULTS.sellingCostPercent;
  const socialSecurityAge = plan.socialSecurityAge ?? RETIREMENT_DEFAULTS.socialSecurityAge;
  const fullSocialSecurity = socialSecurityAtFullAge(plan, summary.defaults, retirementAge).annual;

  const sales = plan.properties.flatMap((p): SaleEvent[] => {
    // A property or mortgage removed since the plan was saved drops out.
    const property = summary.properties.find((x) => x.id === p.assetId);
    if (!property) return [];
    const mortgage = summary.mortgages.find((m) => m.id === p.mortgageAccountId) ?? null;
    const age = Math.max(p.sellAge, currentAge);
    return [
      {
        name: property.name,
        age,
        proceeds: saleProceeds(property, mortgage, age - currentAge, appreciation, sellingCost),
        netRentAnnual: p.netRentAnnual ?? 0,
      },
    ];
  });

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
      spendingChanges: plan.spendingChanges,
      spendingDeclinePercent: plan.spendingDeclinePercent ?? RETIREMENT_DEFAULTS.spendingDeclinePercent,
      socialSecurityAnnual: Math.round(fullSocialSecurity * claimingFactor(birthYear, socialSecurityAge)),
      socialSecurityAge,
      pensionAnnual: plan.pensionAnnual ?? 0,
      sales,
    },
    missing: [],
  };
}

export type RetirementProjection = {
  /** Balance at the start of each age (after any sale that year), from today's age to life expectancy. */
  points: { age: number; balance: number }[];
  /** Property sales within the plan, by age. */
  sales: { name: string; age: number; proceeds: number }[];
  /** Yearly spending in the first year of retirement. */
  spendingAtRetirement: number;
  /** Projected balance on reaching retirement age. */
  atRetirement: number;
  /** Balance needed at retirement age for the money to last to life expectancy, after later sales. */
  needed: number;
  /** needed − atRetirement; zero or less means on track. */
  gap: number;
  /** Extra monthly contribution that closes the gap; null when already retired (or no gap). */
  extraMonthly: number | null;
  /** First age the money can't cover that year's spending; null if it lasts. */
  depletionAge: number | null;
};

/** Net rent in a year from properties not yet sold. */
function rentAt(i: RetirementInputs, age: number) {
  return i.sales.reduce((sum, s) => sum + (age < s.age ? s.netRentAnnual : 0), 0);
}

/** Proceeds from properties sold at an age. */
function salesAt(i: RetirementInputs, age: number) {
  return i.sales.reduce((sum, s) => sum + (s.age === age ? s.proceeds : 0), 0);
}

/** Yearly spending at an age: today's, plus the changes under way, slowing after SPENDING_DECLINE_AGE. */
export function spendingAt(
  i: Pick<RetirementInputs, 'annualSpending' | 'spendingChanges' | 'spendingDeclinePercent'>,
  age: number,
): number {
  const changes = i.spendingChanges.reduce(
    (sum, c) => sum + (age >= c.startAge && (c.endAge === null || age < c.endAge) ? c.annualChange : 0),
    0,
  );
  const slowdown = (1 - i.spendingDeclinePercent / 100) ** Math.max(0, age - SPENDING_DECLINE_AGE);
  return Math.max(0, i.annualSpending + changes) * slowdown;
}

/** Spending the portfolio must cover at an age, after Social Security, pension and rent. */
function withdrawalAt(i: RetirementInputs, age: number) {
  const income = i.pensionAnnual + (age >= i.socialSecurityAge ? i.socialSecurityAnnual : 0) + rentAt(i, age);
  return Math.max(0, spendingAt(i, age) - income);
}

/**
 * Year-by-year projection in today's dollars. A property sold at an age adds its proceeds at the start
 * of that year. Before retirement, a year's growth is followed by that year's contribution and rent; in
 * retirement, the year's withdrawal comes out first and the rest grows.
 */
export function projectRetirement(i: RetirementInputs): RetirementProjection {
  const r = i.expectedReturn / 100;
  const start = Math.max(i.retirementAge, i.currentAge);
  const points: RetirementProjection['points'] = [];
  let balance = i.startingBalance;
  let atRetirement = i.startingBalance;
  let depletionAge: number | null = null;

  for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
    balance += salesAt(i, age);
    points.push({ age, balance: Math.round(balance) });
    if (age === start) atRetirement = balance;
    if (age === i.lifeExpectancy) break;
    if (age < i.retirementAge) {
      balance = balance * (1 + r) + i.annualContribution + rentAt(i, age);
    } else {
      const need = withdrawalAt(i, age);
      if (need > balance + 0.005 && depletionAge === null) depletionAge = age;
      balance = Math.max(0, balance - need) * (1 + r);
    }
  }

  // Present value at retirement of each year's withdrawal, less sales after retirement, mirroring the loop.
  let needed = 0;
  for (let age = start; age < i.lifeExpectancy; age++) {
    needed += (withdrawalAt(i, age) - (age > start ? salesAt(i, age) : 0)) / (1 + r) ** (age - start);
  }

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
    sales: i.sales
      .filter((s) => s.age < i.lifeExpectancy)
      .map(({ name, age, proceeds }) => ({ name, age, proceeds }))
      .sort((a, b) => a.age - b.age),
    spendingAtRetirement: Math.round(spendingAt(i, start)),
    atRetirement: atRetirementDollars,
    needed: neededDollars,
    gap,
    extraMonthly,
    depletionAge,
  };
}

/**
 * The age a mortgage is paid off on its current payment, given today's age; null without terms, or
 * when the payment never pays it down.
 */
export function mortgagePayoffAge(
  mortgage: Pick<RetirementMortgage, 'balance' | 'interestRatePct' | 'monthlyPayment'>,
  currentAge: number,
): number | null {
  const { balance, interestRatePct, monthlyPayment } = mortgage;
  if (balance <= 0) return currentAge;
  if (interestRatePct === null || !monthlyPayment || monthlyPayment <= (balance * interestRatePct) / 1200) return null;
  // Whole years: the first birthday by which it's gone, capped at 50 years out.
  for (let years = 1; years <= 50; years++) {
    if (remainingLoanBalance(balance, interestRatePct, monthlyPayment, years * 12) < 1) return currentAge + years;
  }
  return null;
}
