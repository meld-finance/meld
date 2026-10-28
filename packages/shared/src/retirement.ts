import { z } from 'zod';
import { TaxTreatment } from './investments';
import { remainingLoanBalance } from './liabilities';
import { Child } from './profile';
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
  /** Whose ages startAge and endAge are: a child's id from the profile, or null for yours. */
  childId: z.string().min(1).max(40).nullable().default(null),
  startAge: z.number().int().min(0).max(120),
  /** The first age it no longer applies; null if it never ends. */
  endAge: z.number().int().min(0).max(120).nullable(),
  /** Added to yearly spending, in today's dollars; negative for spending less. */
  annualChange: z.number(),
  /** Entered per month; annualChange is still yearly. */
  monthly: z.boolean().default(false),
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

/** A named version of the plan. One is active: the one Ask Meld and the rest of Meld use. */
export const RetirementScenario = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
});
export type RetirementScenario = z.infer<typeof RetirementScenario>;

export const ScenarioName = z.string().trim().min(1).max(60);

export const CreateScenario = z.object({
  name: ScenarioName,
  /** A scenario whose plan to copy; empty starts from scratch. */
  copyFrom: z.string().uuid().nullable().default(null),
});
export type CreateScenario = z.infer<typeof CreateScenario>;

export const UpdateScenario = z.object({
  name: ScenarioName.optional(),
  /** Only true: making another scenario active is how this one stops being. */
  active: z.literal(true).optional(),
});
export type UpdateScenario = z.infer<typeof UpdateScenario>;

export const RetirementSummary = z.object({
  /** The scenario `plan` belongs to. */
  scenario: RetirementScenario,
  /** Every scenario with its plan, oldest first, for comparing. */
  scenarios: z.array(RetirementScenario.extend({ plan: RetirementPlan })),
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
    /** From the profile, for spending changes that follow a child's age. */
    children: z.array(Child),
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
  /** In your ages: changes that follow a child are converted. */
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

/** The summary's accounts as another scenario's plan counts them. */
export function withPlan<T extends Pick<RetirementSummary, 'accounts'>>(summary: T, plan: Pick<RetirementPlan, 'excludedAccountIds'>): T {
  const excluded = new Set(plan.excludedAccountIds);
  return {
    ...summary,
    accounts: summary.accounts.map((a) => {
      if (a.excludedReason === 'education') return a;
      const out = excluded.has(a.id);
      return { ...a, included: !out, excludedReason: out ? 'user' : null };
    }),
  };
}

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
      spendingChanges: inYourAges(plan.spendingChanges, summary.defaults.children, birthYear),
      spendingDeclinePercent: plan.spendingDeclinePercent ?? RETIREMENT_DEFAULTS.spendingDeclinePercent,
      socialSecurityAnnual: Math.round(fullSocialSecurity * claimingFactor(birthYear, socialSecurityAge)),
      socialSecurityAge,
      pensionAnnual: plan.pensionAnnual ?? 0,
      sales,
    },
    missing: [],
  };
}

/** Changes that follow a child, moved to your ages; those for a child no longer in the profile drop out. */
export function inYourAges(changes: SpendingChange[], children: Child[], birthYear: number): SpendingChange[] {
  return changes.flatMap((c) => {
    if (c.childId === null) return [c];
    const child = children.find((k) => k.id === c.childId);
    if (!child) return [];
    const shift = child.birthYear - birthYear;
    return [{ ...c, childId: null, startAge: c.startAge + shift, endAge: c.endAge === null ? null : c.endAge + shift }];
  });
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
 * One year from `age` to the next, at return `r`. Before retirement the balance grows, then the year's
 * contribution and rent go in; in retirement the year's withdrawal comes out first and the rest grows.
 * `short` when the balance can't cover the withdrawal. Sales are added by the caller at the start of a year.
 */
function stepYear(i: RetirementInputs, age: number, balance: number, r: number): { balance: number; short: boolean } {
  if (age < i.retirementAge) return { balance: balance * (1 + r) + i.annualContribution + rentAt(i, age), short: false };
  const need = withdrawalAt(i, age);
  return { balance: Math.max(0, balance - need) * (1 + r), short: need > balance + 0.005 };
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
    const step = stepYear(i, age, balance, r);
    if (step.short && depletionAge === null) depletionAge = age;
    balance = step.balance;
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

// --- Monte Carlo -------------------------------------------------------------

export const SimulationSettings = z.object({
  trials: z.number().int().min(100).max(10_000),
  /** Standard deviation of yearly returns, in percent. */
  volatility: z.number().min(0).max(40),
  /** The same seed and inputs always give the same result. */
  seed: z.number().int().min(0).max(0xffffffff),
});
export type SimulationSettings = z.infer<typeof SimulationSettings>;

export const SIMULATION_DEFAULTS: SimulationSettings = {
  trials: 1000,
  /** Roughly a stock-heavy mix; about 6–8 for a balanced one. */
  volatility: 12,
  seed: 1,
};

export const Percentiles = z.object({
  p10: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
});
export type Percentiles = z.infer<typeof Percentiles>;

export const SimulationResult = z.object({
  /** Share of trials, 0–1, where the money covers every year's spending to life expectancy. */
  successRate: z.number(),
  /** Balance at the start of each age across trials, like RetirementProjection['points']. */
  bands: z.array(Percentiles.extend({ age: z.number() })),
  /** Balance on reaching retirement age. */
  atRetirement: Percentiles,
  /** Balance left at life expectancy. */
  endingBalance: Percentiles,
  /** Median first age the money runs short, among trials where it does; null if none do. */
  medianDepletionAge: z.number().nullable(),
});
export type SimulationResult = z.infer<typeof SimulationResult>;

/** A saved run: what it was given and what it found, as of the day it ran. */
export type SavedSimulation = {
  id: string;
  scenarioId: string;
  settings: SimulationSettings;
  inputs: RetirementInputs;
  result: SimulationResult;
  createdAt: string;
};

/** Seeded uniform numbers in [0, 1) (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal numbers from uniform ones (Box–Muller). */
function normal(uniform: () => number) {
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Linear-interpolated percentile of sorted values. */
function percentile(sorted: Float64Array, q: number) {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

function percentiles(values: Float64Array): Percentiles {
  const sorted = values.slice().sort();
  const p = (q: number) => Math.round(percentile(sorted, q));
  return { p10: p(0.1), p25: p(0.25), p50: p(0.5), p75: p(0.75), p90: p(0.9) };
}

/**
 * Runs the projection many times with a random return each year. Returns are lognormal with an average
 * of `expectedReturn` and a standard deviation of about `volatility`, so a run of bad years early in
 * retirement shows up the way it does in real markets. With no volatility it matches projectRetirement.
 */
export function simulateRetirement(i: RetirementInputs, settings: SimulationSettings): SimulationResult {
  const m = i.expectedReturn / 100;
  // Lognormal with mean m and standard deviation s: ln(1+R) ~ N(μ, σ²).
  const s = settings.volatility / 100;
  const sigma = Math.sqrt(Math.log(1 + (s / (1 + m)) ** 2));
  const mu = Math.log(1 + m) - sigma ** 2 / 2;
  const z = normal(random(settings.seed));
  const draw = sigma === 0 ? () => m : () => Math.exp(mu + sigma * z()) - 1;

  const years = i.lifeExpectancy - i.currentAge + 1;
  const start = Math.max(i.retirementAge, i.currentAge);
  // balances[y][t]: balance at the start of year y in trial t.
  const balances = Array.from({ length: years }, () => new Float64Array(settings.trials));
  const depletions: number[] = [];

  for (let t = 0; t < settings.trials; t++) {
    let balance = i.startingBalance;
    let depleted: number | null = null;
    for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
      balance += salesAt(i, age);
      balances[age - i.currentAge]![t] = balance;
      if (age === i.lifeExpectancy) break;
      const step = stepYear(i, age, balance, draw());
      if (step.short && depleted === null) depleted = age;
      balance = step.balance;
    }
    if (depleted !== null) depletions.push(depleted);
  }

  const bands = balances.map((b, y) => ({ age: i.currentAge + y, ...percentiles(b) }));
  depletions.sort((a, b) => a - b);
  return {
    successRate: 1 - depletions.length / settings.trials,
    bands,
    atRetirement: percentiles(balances[start - i.currentAge]!),
    endingBalance: percentiles(balances[years - 1]!),
    medianDepletionAge: depletions.length ? depletions[Math.floor((depletions.length - 1) / 2)]! : null,
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
