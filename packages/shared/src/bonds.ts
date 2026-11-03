import { BOND_FUND_SHARE, type Holding, type InvestmentIncome } from './investments';

/**
 * A bond fund or individual bond across your accounts. Bond prices fall when rates rise, but new
 * money then earns the higher rate: these figures put the price change next to what it pays.
 */
export type BondPosition = {
  securityId: string;
  ticker: string | null;
  name: string | null;
  kind: 'fund' | 'bond';
  value: number;
  /** Null when any position lacks cost basis. */
  costBasis: number | null;
  /** Value vs. cost as a fraction (−0.38 = down 38%). */
  priceChange: number | null;
  /** Dividends and interest over the last year (annualized from shorter history) ÷ value. */
  paidYield: number | null;
  /** Days of payouts paidYield is based on; under 365 means it's scaled up. */
  paidDays: number | null;
  /** The same income ÷ what you paid. */
  yieldOnCost: number | null;
  /** Funds: published SEC yield (AI estimate). Bonds: yield to maturity at today's price. */
  marketYield: number | null;
  /** Funds: average duration in years (AI estimate); roughly how long until a rate-driven drop is earned back. */
  duration: number | null;
  /** Funds below cost: years for reinvested income to grow the value back to cost, if rates and prices hold. */
  yearsToCost: number | null;
  /** Bonds: when it pays back, and how much. */
  maturityDate: string | null;
  parValue: number | null;
};

const MS_PER_YEAR = 365.25 * 86_400_000;
/** Bonds don't move this far from cost; past it, the institution's cost basis is incomplete. */
const PLAUSIBLE_COST = { min: 0.5, max: 2.5 };

function isIndividualBond(h: Holding): boolean {
  return h.securityType === 'fixed income' || h.fixedIncome !== null;
}

function isBondFund(h: Holding): boolean {
  return h.securityType !== 'cash' && (h.profile?.assetClasses.bonds ?? 0) >= BOND_FUND_SHARE;
}

/**
 * What a bond pays back at maturity. Institutions report bond quantity either as units (with Plaid's
 * face value per unit) or as dollars of par (priced per 100); whichever agrees with the reported value.
 */
export function bondParValue(h: Pick<Holding, 'quantity' | 'price' | 'value' | 'fixedIncome'>): number | null {
  const value = h.value ?? 0;
  if (value <= 0 || h.quantity <= 0) return null;
  const plausible = (par: number) => par / value > 0.5 && par / value < 2;
  const face = h.fixedIncome?.faceValue;
  if (face && plausible(h.quantity * face)) return h.quantity * face;
  // Priced per 100 of par: quantity × price / 100 ≈ value.
  if (h.price && Math.abs((h.quantity * h.price) / 100 - value) / value < 0.02) return h.quantity;
  return null;
}

/**
 * Yield to maturity, the standard approximation for a coupon bond:
 * (coupon + (par − price) ÷ years) ÷ average of par and price. A bill or zero-coupon is the compound rate to par.
 */
export function approxYieldToMaturity(price: number, par: number, years: number, couponRate: number): number | null {
  if (price <= 0 || par <= 0 || years <= 0) return null;
  if (couponRate === 0) return (par / price) ** (1 / years) - 1;
  return (par * couponRate + (par - price) / years) / ((par + price) / 2);
}

function bondYield(h: Holding, par: number | null, today: string): number | null {
  const terms = h.fixedIncome;
  if (!terms || terms.yieldPercent === null) return null;
  // Already a full rate of return.
  if (terms.yieldType === 'yield' || terms.yieldType === 'coupon_equivalent') return terms.yieldPercent / 100;
  const years = terms.maturityDate ? (Date.parse(terms.maturityDate) - Date.parse(today)) / MS_PER_YEAR : null;
  if (!par || !years || years <= 0 || !h.value) return null;
  // A discount rate isn't a coupon: the bill pays nothing until it pays par.
  return approxYieldToMaturity(h.value, par, years, terms.yieldType === 'coupon' ? terms.yieldPercent / 100 : 0);
}

const sumOrNull = (ns: (number | null)[]) => (ns.some((n) => n === null) ? null : ns.reduce<number>((s, n) => s + n!, 0));

/** Bond funds and individual bonds, largest first. */
export function bondPositions(holdings: Holding[], income: InvestmentIncome['byHolding'], today: string): BondPosition[] {
  const incomeByHolding = new Map(income.map((i) => [`${i.accountId}:${i.securityId}`, i]));
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    if ((h.value ?? 0) <= 0 || !(isIndividualBond(h) || isBondFund(h))) continue;
    groups.set(h.securityId, [...(groups.get(h.securityId) ?? []), h]);
  }

  return [...groups.values()]
    .map((list): BondPosition => {
      const first = list[0]!;
      const kind = isIndividualBond(first) ? 'bond' : 'fund';
      const value = list.reduce((s, h) => s + (h.value ?? 0), 0);
      const reported = sumOrNull(list.map((h) => h.costBasis));
      const costBasis =
        reported && reported * PLAUSIBLE_COST.min < value && value < reported * PLAUSIBLE_COST.max ? reported : null;

      // Yield only over positions with payouts, so an account without history doesn't drag it down.
      const paying = list.flatMap((h) => {
        const i = incomeByHolding.get(`${h.accountId}:${h.securityId}`);
        return i ? [{ h, i }] : [];
      });
      const paidIncome = paying.reduce((s, p) => s + p.i.annualIncome, 0);
      const paidValue = paying.reduce((s, p) => s + (p.h.value ?? 0), 0);
      const paidCost = costBasis === null ? null : sumOrNull(paying.map((p) => p.h.costBasis));
      const paidYield = paidValue > 0 ? paidIncome / paidValue : null;

      const pars = kind === 'bond' ? list.map(bondParValue) : [];
      const parValue = kind === 'bond' ? sumOrNull(pars) : null;
      // The same bond yields the same in every account, so one position's price and par give it.
      const marketYield = kind === 'bond' ? bondYield(first, pars[0] ?? null, today) : (first.profile?.bondStats?.secYield ?? null);

      // Income bought back in at today's yield compounds until it covers the shortfall.
      const growth = paidYield ?? marketYield;
      const yearsToCost =
        kind === 'fund' && costBasis !== null && costBasis > value && growth && growth > 0
          ? Math.log(costBasis / value) / Math.log(1 + growth)
          : null;

      return {
        securityId: first.securityId,
        ticker: first.ticker,
        name: first.name,
        kind,
        value,
        costBasis,
        priceChange: costBasis ? value / costBasis - 1 : null,
        paidYield,
        paidDays: paying.length ? Math.min(...paying.map((p) => p.i.days)) : null,
        yieldOnCost: paidCost ? paidIncome / paidCost : null,
        marketYield,
        duration: kind === 'fund' ? (first.profile?.bondStats?.duration ?? null) : null,
        yearsToCost,
        maturityDate: first.fixedIncome?.maturityDate ?? null,
        parValue,
      };
    })
    .sort((a, b) => b.value - a.value);
}
