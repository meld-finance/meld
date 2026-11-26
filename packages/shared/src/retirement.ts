import { z } from 'zod';
import { TaxTreatment } from './investments';
import { remainingLoanBalance } from './liabilities';
import { Child, FilingStatus, partnerName } from './profile';
import { claimingFactor, estimateSocialSecurityMonthly, resolveCoupleSocialSecurity } from './social-security';
import { estimateAfterTaxIncome } from './tax-tables';

/** Special `childId` value indicating a life event is timed to your partner's age. */
export const PARTNER_AGE_ID = 'partner' as const;

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

/**
 * What a life event changes:
 * - `spending`: yearly spending in retirement, e.g. kids leaving home or a mortgage paid off.
 * - `income`: money coming in, e.g. part-time work; it covers spending in retirement and is saved before.
 * - `saving`: what you put away each year before retiring, e.g. a raise or catch-up contributions.
 * - `once`: a one-time sum in (positive) or out (negative) of savings at `startAge`, e.g. an inheritance.
 */
export const LifeEventKind = z.enum(['spending', 'income', 'saving', 'once']);
export type LifeEventKind = z.infer<typeof LifeEventKind>;

/** A life event: a change to spending, income or saving over a span of ages, or a one-time sum. */
export const SpendingChange = z.object({
  label: z.string().trim().min(1).max(60),
  kind: LifeEventKind.default('spending'),
  /** Whose ages startAge and endAge are: a child's id from the profile, or null for yours. */
  childId: z.string().min(1).max(40).nullable().default(null),
  startAge: z.number().int().min(0).max(120),
  /** The first age it no longer applies; null if it never ends. Ignored for `once`. */
  endAge: z.number().int().min(0).max(120).nullable(),
  /** Yearly, in today's dollars; negative for less. For `once`, the sum itself. */
  annualChange: z.number(),
  /** Entered per month; annualChange is still yearly. Never set for `once`. */
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
  /** Partner's retirement age (in partner's own ages); used when a partner is on the profile. */
  partnerRetirementAge: z.number().int().min(18).max(100).nullable(),
  /** Partner's plan-to age (in partner's own ages); plan extends to the later of both horizons. */
  partnerLifeExpectancy: z.number().int().min(50).max(120).nullable(),
  /** What your partner and their employer put in each year while working. */
  partnerAnnualContribution: z.number().nonnegative().nullable(),
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
  /** Partner's yearly Social Security benefit at their full retirement age; empty estimates from their income. */
  partnerSocialSecurityAnnual: z.number().nonnegative().nullable(),
  /** When partner claims Social Security (62–70). */
  partnerSocialSecurityAge: z.number().int().min(62).max(70).nullable(),
  pensionAnnual: z.number().nonnegative().nullable(),
  /** Partner's yearly pension once retired. */
  partnerPensionAnnual: z.number().nonnegative().nullable(),
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
  partnerRetirementAge: null,
  partnerLifeExpectancy: null,
  partnerAnnualContribution: null,
  expectedReturn: null,
  annualSpending: null,
  spendingDeclinePercent: null,
  socialSecurityAnnual: null,
  socialSecurityAge: null,
  partnerSocialSecurityAnnual: null,
  partnerSocialSecurityAge: null,
  pensionAnnual: null,
  partnerPensionAnnual: null,
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
    /** Married, from the filing status: enables spousal Social Security rules. */
    married: z.boolean(),
    /** Spending over the last 12 months of cash flow. */
    annualSpending: z.number().nullable(),
    /** Household gross income from the profile (yours + partner's). */
    annualIncome: z.number().nullable(),
    /** Your own gross income from the profile. */
    yourIncome: z.number().nullable(),
    /** Tax filing status from the profile, for estimating after-tax bridge income. */
    filingStatus: FilingStatus.nullable(),
    /** Two-letter US state code from the profile, for estimating after-tax bridge income. */
    state: z.string().nullable(),
    /** Partner details from the profile, when present. */
    partner: z
      .object({
        name: z.string().nullable(),
        currentAge: z.number().nullable(),
        birthYear: z.number().nullable(),
        annualIncome: z.number().nullable(),
      })
      .nullable(),
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

/** Resolved partner parameters mapped onto both their own ages and your timeline ages. */
export type ResolvedPartner = {
  name: string;
  currentAge: number;
  birthYear: number;
  /** Partner's retirement age (in partner's ages). */
  retirementAge: number;
  /** Partner's retirement age expressed in your ages. */
  retirementAgeInYours: number;
  /** Partner's plan-to age (in partner's ages). */
  lifeExpectancy: number;
  /** Partner's yearly retirement savings while working. */
  annualContribution: number;
  /** Partner's estimated after-tax annual pay if still working during bridge years. */
  bridgeIncomeAnnual: number;
  /** Partner's yearly Social Security benefit as received from their claiming age. */
  socialSecurityAnnual: number;
  /** Partner's Social Security claiming age (in partner's ages). */
  socialSecurityAge: number;
  /** Partner's Social Security claiming age expressed in your ages. */
  socialSecurityAgeInYours: number;
  /** Partner's yearly pension once retired. */
  pensionAnnual: number;
};

export type RetirementPhase = 'working' | 'bridge' | 'retired';

/** Everything the projection needs, with defaults filled in. */
export type RetirementInputs = {
  currentAge: number;
  retirementAge: number;
  /** Effective joint plan-to age in your ages (extended when a younger partner plans further out). */
  lifeExpectancy: number;
  /** Your own plan-to age (same as `lifeExpectancy` unless a younger partner extends the horizon). */
  yourLifeExpectancy?: number;
  startingBalance: number;
  annualContribution: number;
  /** Your estimated after-tax annual pay if still working while your partner is retired. */
  bridgeIncomeAnnual?: number;
  /** Percent, after inflation. */
  expectedReturn: number;
  /** Today's; see spendingAt. */
  annualSpending: number;
  /** Life events of every kind, in your ages: events that follow a child or partner are converted. */
  spendingChanges: SpendingChange[];
  /** Percent a year after SPENDING_DECLINE_AGE. */
  spendingDeclinePercent: number;
  /** Yearly, as received from the claiming age. */
  socialSecurityAnnual: number;
  socialSecurityAge: number;
  pensionAnnual: number;
  sales: SaleEvent[];
  /** Partner inputs when a partner with a birth year is configured; null/undefined otherwise. */
  partner?: ResolvedPartner | null;
};

/** Your age when the first spouse/person retires (when withdrawals or bridge cash flows begin). */
export function firstRetireAge(i: Pick<RetirementInputs, 'retirementAge' | 'partner'>): number {
  return i.partner ? Math.min(i.retirementAge, i.partner.retirementAgeInYours) : i.retirementAge;
}

/** Your age when both partners (or just you) are retired. */
export function fullRetireAge(i: Pick<RetirementInputs, 'retirementAge' | 'partner'>): number {
  return i.partner ? Math.max(i.retirementAge, i.partner.retirementAgeInYours) : i.retirementAge;
}

/** Household retirement phase at your `age`. */
export function yearPhase(i: Pick<RetirementInputs, 'retirementAge' | 'partner'>, age: number): RetirementPhase {
  const youWorking = age < i.retirementAge;
  if (!i.partner) return youWorking ? 'working' : 'retired';
  const partnerWorking = age < i.partner.retirementAgeInYours;
  if (youWorking && partnerWorking) return 'working';
  if (!youWorking && !partnerWorking) return 'retired';
  return 'bridge';
}

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

type SummaryParts = {
  defaults: Omit<RetirementSummary['defaults'], 'yourIncome' | 'filingStatus' | 'state' | 'partner'> &
    Partial<Pick<RetirementSummary['defaults'], 'yourIncome' | 'filingStatus' | 'state' | 'partner'>>;
  accounts: RetirementAccount[];
  properties: RetirementProperty[];
  mortgages: RetirementMortgage[];
};

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

/** Breakdown of a future property sale in today's dollars. */
export type SaleBreakdown = {
  futurePrice: number;
  sellingCosts: number;
  mortgageLeft: number;
  proceeds: number;
};

/**
 * Breakdown and net proceeds of selling a property `years` from now. The price is in today's
 * dollars; the mortgage left is in future dollars, which overstates it a little and keeps the estimate conservative.
 */
export function saleBreakdown(
  property: Pick<RetirementProperty, 'value'>,
  mortgage: Pick<RetirementMortgage, 'balance' | 'interestRatePct' | 'monthlyPayment'> | null,
  years: number,
  appreciationPct: number,
  sellingCostPct: number,
): SaleBreakdown {
  const price = property.value * (1 + appreciationPct / 100) ** years;
  const owed = mortgage ? remainingLoanBalance(mortgage.balance, mortgage.interestRatePct, mortgage.monthlyPayment, years * 12) : 0;
  return {
    futurePrice: Math.round(price),
    sellingCosts: Math.round(price * (sellingCostPct / 100)),
    mortgageLeft: Math.round(owed),
    proceeds: Math.round(price * (1 - sellingCostPct / 100) - owed),
  };
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
  return saleBreakdown(property, mortgage, years, appreciationPct, sellingCostPct).proceeds;
}

/** Fills empty fields from defaults; null inputs when age or spending can't be known. */
export function resolvePlan(plan: RetirementPlan, summary: SummaryParts): ResolvedPlan {
  const d = summary.defaults;
  const { currentAge, birthYear } = d;
  const annualSpending = plan.annualSpending ?? d.annualSpending;
  const missing: MissingInput[] = [
    ...(currentAge === null || birthYear === null ? (['birth year'] as const) : []),
    ...(annualSpending === null ? (['retirement spending'] as const) : []),
  ];
  if (currentAge === null || birthYear === null || annualSpending === null) return { inputs: null, missing };
  const retirementAge = plan.retirementAge ?? Math.max(RETIREMENT_DEFAULTS.retirementAge, currentAge);
  const appreciation = plan.propertyAppreciation ?? RETIREMENT_DEFAULTS.propertyAppreciation;
  const sellingCost = plan.sellingCostPercent ?? RETIREMENT_DEFAULTS.sellingCostPercent;
  const socialSecurityAge = plan.socialSecurityAge ?? RETIREMENT_DEFAULTS.socialSecurityAge;
  const yourEnd = Math.max(plan.lifeExpectancy ?? RETIREMENT_DEFAULTS.lifeExpectancy, retirementAge + 1, currentAge + 1);
  const yourIncome = 'yourIncome' in d ? (d.yourIncome ?? null) : d.annualIncome;
  const partnerInput = d.partner ?? null;
  const filingStatus = d.filingStatus ?? (d.married ? 'married_joint' : 'single');
  const state = d.state ?? null;

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

  const hasPartner = !!(partnerInput && partnerInput.birthYear !== null && partnerInput.currentAge !== null);
  let resolvedPartner: ResolvedPartner | null = null;
  let lifeExpectancy = yourEnd;
  let socialSecurityAnnual: number;

  if (hasPartner && partnerInput && partnerInput.birthYear !== null && partnerInput.currentAge !== null) {
    const ageShift = partnerInput.birthYear - birthYear;
    const partnerRetirementAge =
      plan.partnerRetirementAge ?? Math.max(RETIREMENT_DEFAULTS.retirementAge, partnerInput.currentAge);
    const partnerRetirementAgeInYours = partnerRetirementAge + ageShift;
    const partnerEndOwn = Math.max(
      plan.partnerLifeExpectancy ?? RETIREMENT_DEFAULTS.lifeExpectancy,
      partnerRetirementAge + 1,
      partnerInput.currentAge + 1,
    );
    lifeExpectancy = Math.max(yourEnd, partnerEndOwn + ageShift);
    const partnerSocialSecurityAge = plan.partnerSocialSecurityAge ?? RETIREMENT_DEFAULTS.socialSecurityAge;
    const coupleSS = resolveCoupleSocialSecurity({
      married: d.married,
      yourBirthYear: birthYear,
      yourIncome,
      yourRetireAge: retirementAge,
      yourOverrideAnnual: plan.socialSecurityAnnual,
      yourClaimAge: socialSecurityAge,
      partnerBirthYear: partnerInput.birthYear,
      partnerIncome: partnerInput.annualIncome,
      partnerRetireAge: partnerRetirementAge,
      partnerOverrideAnnual: plan.partnerSocialSecurityAnnual,
      partnerClaimAge: partnerSocialSecurityAge,
    });
    socialSecurityAnnual = coupleSS.yours.claimedAnnual;
    resolvedPartner = {
      name: partnerName(partnerInput),
      currentAge: partnerInput.currentAge,
      birthYear: partnerInput.birthYear,
      retirementAge: partnerRetirementAge,
      retirementAgeInYours: partnerRetirementAgeInYours,
      lifeExpectancy: partnerEndOwn,
      annualContribution: plan.partnerAnnualContribution ?? 0,
      bridgeIncomeAnnual: partnerInput.annualIncome ? estimateAfterTaxIncome(partnerInput.annualIncome, filingStatus, state) : 0,
      socialSecurityAnnual: coupleSS.partner.claimedAnnual,
      socialSecurityAge: partnerSocialSecurityAge,
      socialSecurityAgeInYours: partnerSocialSecurityAge + ageShift,
      pensionAnnual: plan.partnerPensionAnnual ?? 0,
    };
  } else {
    const fullSocialSecurity = socialSecurityAtFullAge(plan, d, retirementAge).annual;
    socialSecurityAnnual = Math.round(fullSocialSecurity * claimingFactor(birthYear, socialSecurityAge));
  }

  return {
    inputs: {
      currentAge,
      retirementAge,
      lifeExpectancy,
      yourLifeExpectancy: yourEnd,
      startingBalance: retirementBalance(summary, plan),
      annualContribution: plan.annualContribution ?? 0,
      bridgeIncomeAnnual: yourIncome ? estimateAfterTaxIncome(yourIncome, filingStatus, state) : 0,
      expectedReturn: plan.expectedReturn ?? RETIREMENT_DEFAULTS.expectedReturn,
      annualSpending,
      spendingChanges: inYourAges(plan.spendingChanges, d.children, birthYear, partnerInput),
      spendingDeclinePercent: plan.spendingDeclinePercent ?? RETIREMENT_DEFAULTS.spendingDeclinePercent,
      socialSecurityAnnual,
      socialSecurityAge,
      pensionAnnual: plan.pensionAnnual ?? 0,
      sales,
      partner: resolvedPartner,
    },
    missing: [],
  };
}

/**
 * Changes that follow a child or partner, moved to your ages; those for a child or partner no
 * longer in the profile drop out.
 */
export function inYourAges(
  changes: SpendingChange[],
  children: Child[],
  birthYear: number,
  partner?: { birthYear: number | null } | null,
): SpendingChange[] {
  return changes.flatMap((c) => {
    if (c.childId === null) return [c];
    if (c.childId === PARTNER_AGE_ID) {
      if (!partner || partner.birthYear === null) return [];
      const shift = partner.birthYear - birthYear;
      return [{ ...c, childId: null, startAge: c.startAge + shift, endAge: c.endAge === null ? null : c.endAge + shift }];
    }
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

/** The yearly amounts of one kind of life event under way at an age. */
function eventsAt(i: Pick<RetirementInputs, 'spendingChanges'>, kind: Exclude<LifeEventKind, 'once'>, age: number) {
  return i.spendingChanges.reduce(
    (sum, c) =>
      sum + ((c.kind ?? 'spending') === kind && age >= c.startAge && (c.endAge === null || age < c.endAge) ? c.annualChange : 0),
    0,
  );
}

/** One-time sums at an age, in or out. */
function onceAt(i: RetirementInputs, age: number) {
  return i.spendingChanges.reduce((sum, c) => sum + (c.kind === 'once' && c.startAge === age ? c.annualChange : 0), 0);
}

/** Yearly spending at an age: today's, plus the changes under way, slowing after SPENDING_DECLINE_AGE. */
export function spendingAt(
  i: Pick<RetirementInputs, 'annualSpending' | 'spendingChanges' | 'spendingDeclinePercent'>,
  age: number,
): number {
  const changes = eventsAt(i, 'spending', age);
  const slowdown = (1 - i.spendingDeclinePercent / 100) ** Math.max(0, age - SPENDING_DECLINE_AGE);
  return Math.max(0, i.annualSpending + changes) * slowdown;
}

/** Social Security received at your `age` (yours plus partner's, each from their claiming age). */
function socialSecurityAt(i: RetirementInputs, age: number): number {
  return (
    (age >= i.socialSecurityAge ? i.socialSecurityAnnual : 0) +
    (i.partner && age >= i.partner.socialSecurityAgeInYours ? i.partner.socialSecurityAnnual : 0)
  );
}

/** Pension received at your `age` (each partner's pension starts when that partner retires). */
function pensionAt(i: RetirementInputs, age: number): number {
  return (
    (age >= i.retirementAge ? i.pensionAnnual : 0) +
    (i.partner && age >= i.partner.retirementAgeInYours ? i.partner.pensionAnnual : 0)
  );
}

/**
 * Spending the portfolio must cover once both partners are retired, after Social Security,
 * pensions, rent and income from life events. Income beyond spending goes back into savings.
 */
function withdrawalAt(i: RetirementInputs, age: number) {
  const income = pensionAt(i, age) + socialSecurityAt(i, age) + rentAt(i, age);
  return Math.max(0, spendingAt(i, age) - income) - eventsAt(i, 'income', age);
}

/** Added to savings in a working year (both working): contributions, saving changes, rent and event income. */
function savedAt(i: RetirementInputs, age: number) {
  return (
    i.annualContribution +
    (i.partner?.annualContribution ?? 0) +
    eventsAt(i, 'saving', age) +
    eventsAt(i, 'income', age) +
    rentAt(i, age)
  );
}

/**
 * Cash flow in a staggered-retirement bridge year (one partner retired, the other still working).
 * Working partner's estimated after-tax pay plus any active SS/pensions/rent covers household
 * spending; a shortfall draws from savings, while a surplus funds up to their planned contribution.
 */
function bridgeFlowAt(i: RetirementInputs, age: number): { workNet: number; saving: number; withdrawal: number } {
  const youWorking = age < i.retirementAge;
  const workNet = youWorking ? (i.bridgeIncomeAnnual ?? 0) : (i.partner?.bridgeIncomeAnnual ?? 0);
  const workContrib = youWorking ? i.annualContribution : (i.partner?.annualContribution ?? 0);
  const covered = workNet + socialSecurityAt(i, age) + pensionAt(i, age) + rentAt(i, age);
  const surplus = covered - spendingAt(i, age);
  const eventInc = eventsAt(i, 'income', age);
  const saveDelta = eventsAt(i, 'saving', age);
  if (surplus >= 0) {
    const net = Math.min(workContrib, surplus) + saveDelta + eventInc;
    return net >= 0 ? { workNet, saving: net, withdrawal: 0 } : { workNet, saving: 0, withdrawal: -net };
  }
  const need = -surplus - eventInc;
  return need <= 0 ? { workNet, saving: -need, withdrawal: 0 } : { workNet, saving: 0, withdrawal: need };
}

/** Property sales and one-time sums at the start of a year; `short` when a sum out is more than there is. */
function lumpsAt(i: RetirementInputs, age: number, balance: number): { balance: number; short: boolean } {
  const next = balance + salesAt(i, age) + onceAt(i, age);
  return { balance: Math.max(0, next), short: next < -0.005 };
}

/**
 * One year from `age` to the next, at return `r`. In working years (or surplus bridge years), the
 * balance grows, then savings go in; in drawdown years (retired, or shortfall bridge years), the
 * withdrawal comes out first and the rest grows. `short` when the balance can't cover the withdrawal.
 */
function stepYear(i: RetirementInputs, age: number, balance: number, r: number): { balance: number; short: boolean } {
  const phase = yearPhase(i, age);
  if (phase === 'working') return { balance: Math.max(0, balance * (1 + r) + savedAt(i, age)), short: false };
  if (phase === 'bridge') {
    const b = bridgeFlowAt(i, age);
    if (b.withdrawal > 0) return { balance: Math.max(0, balance - b.withdrawal) * (1 + r), short: b.withdrawal > balance + 0.005 };
    return { balance: Math.max(0, balance * (1 + r) + b.saving), short: false };
  }
  const need = withdrawalAt(i, age);
  return { balance: Math.max(0, balance - need) * (1 + r), short: need > balance + 0.005 };
}

/**
 * Year-by-year projection in today's dollars. A property sold at an age adds its proceeds at the start
 * of that year, as does a one-time sum. Before the first retirement age, a year's growth is followed
 * by contributions and rent; during bridge years, the working partner's after-tax pay covers spending
 * first; once both are retired, each year's withdrawal comes out first and the rest grows.
 */
export function projectRetirement(i: RetirementInputs): RetirementProjection {
  const r = i.expectedReturn / 100;
  const firstRetire = firstRetireAge(i);
  const start = Math.max(firstRetire, i.currentAge);
  const points: RetirementProjection['points'] = [];
  let balance = i.startingBalance;
  let atRetirement = i.startingBalance;
  let depletionAge: number | null = null;

  for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
    const lump = lumpsAt(i, age, balance);
    if (lump.short && depletionAge === null) depletionAge = age;
    balance = lump.balance;
    points.push({ age, balance: Math.round(balance) });
    if (age === start) atRetirement = balance;
    if (age === i.lifeExpectancy) break;
    const step = stepYear(i, age, balance, r);
    if (step.short && depletionAge === null) depletionAge = age;
    balance = step.balance;
  }

  // Present value at `start` of each post-start net draw (or end-of-year surplus saving), less later lumps.
  let needed = 0;
  for (let age = start; age < i.lifeExpectancy; age++) {
    const lumpPv = age > start ? (salesAt(i, age) + onceAt(i, age)) / (1 + r) ** (age - start) : 0;
    const phase = yearPhase(i, age);
    if (phase === 'bridge') {
      const b = bridgeFlowAt(i, age);
      const flowPv = b.withdrawal > 0 ? b.withdrawal / (1 + r) ** (age - start) : -b.saving / (1 + r) ** (age - start + 1);
      needed += flowPv - lumpPv;
    } else {
      needed += withdrawalAt(i, age) / (1 + r) ** (age - start) - lumpPv;
    }
  }

  // Whole dollars, with what's needed rounded up so saving exactly that much is enough.
  const neededDollars = Math.max(0, Math.ceil(needed - 0.005));
  const atRetirementDollars = Math.round(atRetirement);
  const gap = neededDollars - atRetirementDollars;
  const years = firstRetire - i.currentAge;
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

export type RetirementCashFlowYear = {
  age: number;
  phase: RetirementPhase;
  partnerAge: number | null;
  retired: boolean;
  spending: number;
  workingIncome: number;
  socialSecurity: number;
  pension: number;
  rent: number;
  eventIncome: number;
  saving: number;
  withdrawal: number;
  lump: number;
};

/** Year-by-year cash flow breakdown across working, bridge (staggered), and fully retired phases. */
export function retirementCashFlow(i: RetirementInputs): RetirementCashFlowYear[] {
  const out: RetirementCashFlowYear[] = [];
  for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
    const phase = yearPhase(i, age);
    const retired = phase !== 'working';
    const partnerAge = i.partner ? i.partner.currentAge + (age - i.currentAge) : null;
    const ss = socialSecurityAt(i, age);
    const pension = pensionAt(i, age);
    const rent = Math.round(rentAt(i, age));
    const eventIncome = Math.round(eventsAt(i, 'income', age));
    const lump = Math.round(salesAt(i, age) + onceAt(i, age));
    if (phase === 'working') {
      out.push({
        age,
        phase,
        partnerAge,
        retired: false,
        spending: 0,
        workingIncome: 0,
        socialSecurity: ss,
        pension: 0,
        rent,
        eventIncome,
        saving: Math.round(savedAt(i, age)),
        withdrawal: 0,
        lump,
      });
    } else if (phase === 'bridge') {
      const b = bridgeFlowAt(i, age);
      out.push({
        age,
        phase,
        partnerAge,
        retired: true,
        spending: Math.round(spendingAt(i, age)),
        workingIncome: Math.round(b.workNet),
        socialSecurity: ss,
        pension,
        rent,
        eventIncome,
        saving: Math.round(b.saving),
        withdrawal: Math.round(b.withdrawal),
        lump,
      });
    } else {
      out.push({
        age,
        phase,
        partnerAge,
        retired: true,
        spending: Math.round(spendingAt(i, age)),
        workingIncome: 0,
        socialSecurity: ss,
        pension,
        rent,
        eventIncome,
        saving: 0,
        withdrawal: Math.round(withdrawalAt(i, age)),
        lump,
      });
    }
  }
  return out;
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
  const start = Math.max(firstRetireAge(i), i.currentAge);
  // balances[y][t]: balance at the start of year y in trial t.
  const balances = Array.from({ length: years }, () => new Float64Array(settings.trials));
  const depletions: number[] = [];

  for (let t = 0; t < settings.trials; t++) {
    let balance = i.startingBalance;
    let depleted: number | null = null;
    for (let age = i.currentAge; age <= i.lifeExpectancy; age++) {
      const lump = lumpsAt(i, age, balance);
      if (lump.short && depleted === null) depleted = age;
      balance = lump.balance;
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
