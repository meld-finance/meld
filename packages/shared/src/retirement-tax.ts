import { z } from 'zod';
import { is457bSubtype } from './investments';
import type { FilingStatus } from './profile';
import { calculateRmd, rmdStartAge } from './rmd';
import {
  bracketTax,
  calculateStateTax,
  federalTables,
  NO_INCOME_TAX_STATES,
  stateName,
  stateTables,
  tableStatus,
  type FederalTables,
  type StateYearTable,
  type TableStatus,
} from './tax-tables';

export const PlanningMode = z.enum(['simple', 'detailed']);
export type PlanningMode = z.infer<typeof PlanningMode>;

export const WithdrawalOrder = z.enum(['taxable_first', 'bracket_fill', 'pretax_first', 'pro_rata']);
export type WithdrawalOrder = z.infer<typeof WithdrawalOrder>;

export const RothConversionBracket = z.union([z.literal(12), z.literal(22), z.literal(24)]);
export type RothConversionBracket = z.infer<typeof RothConversionBracket>;

export const ContributionSplit = z.object({
  pretax: z.number().min(0).max(100),
  roth: z.number().min(0).max(100),
  taxable: z.number().min(0).max(100),
});
export type ContributionSplit = z.infer<typeof ContributionSplit>;

export type BucketBalances = {
  pretax: number;
  roth: number;
  taxable: number;
};

export type BucketWithdrawals = {
  pretax: number;
  roth: number;
  taxable: number;
};

/** Resolved parameters for the 3-bucket tax-aware retirement engine. */
export type DetailedRetirementConfig = {
  birthYear: number;
  filingStatus: FilingStatus;
  /** Two-letter US state code for retirement taxes, or null for federal-only. */
  state: string | null;
  /** Starting balances across the 3 tax buckets (summing to startingBalance). */
  buckets: BucketBalances;
  /** Starting cost basis inside the taxable bucket (dollars, <= buckets.taxable). */
  taxableBasis: number;
  /** Included pre-tax 457(b) balance inside `pretax` (no 10% early-withdrawal penalty after leaving work). */
  pretax457bBalance: number;
  /** Past direct Roth contributions accessible penalty-free before age 59½. */
  rothContributionBasis: number;
  /** Fractions summing to 1: how ongoing contributions split across buckets. */
  contributionSplit: { pretax: number; roth: number; taxable: number };
  /** Automatically add IRS age-50 and age 60–63 catch-up contributions while working. */
  includeCatchUps: boolean;
  withdrawalOrder: WithdrawalOrder;
  /** Optional target federal ordinary bracket (%) for Roth conversions in retired/bridge years. */
  rothConversionBracket: RothConversionBracket | null;
  /** True when early pre-tax withdrawals before age 60 avoid the 10% penalty (Rule of 55, 72(t), etc.). */
  penaltyFreeEarlyAccess: boolean;
};

export type RetirementTaxContext = {
  status: TableStatus;
  fed: FederalTables;
  stateTable: StateYearTable | null;
  /** Upper edge of ordinary taxable income for the chosen Roth conversion bracket (0 when disabled). */
  conversionCeiling: number;
  /** Upper edge of the 12% federal ordinary bracket (used by `bracket_fill`). */
  lowBracketCeiling: number;
};

/** Precomputes federal & state tax tables once before looping across years or Monte Carlo trials. */
export function buildRetirementTaxContext(
  filingStatus: FilingStatus,
  state: string | null,
  rothConversionBracket: RothConversionBracket | null,
): RetirementTaxContext {
  const status = tableStatus(filingStatus);
  const fed = federalTables(2026);
  const st = state?.trim().toUpperCase() ?? null;
  const stateTable = st && !NO_INCOME_TAX_STATES.has(st) ? stateTables(st, 2026) : null;
  const brackets = fed.brackets[status];
  const edgeFor = (rate: number) => brackets.find((b) => Math.abs(b.rate - rate) < 1e-6)?.upTo ?? 0;
  const lowBracketCeiling = edgeFor(0.12);
  const conversionCeiling = rothConversionBracket ? edgeFor(rothConversionBracket / 100) : 0;
  return { status, fed, stateTable, conversionCeiling, lowBracketCeiling };
}

/**
 * IRS provisional-income Social Security taxability (0%, up to 50%, or up to 85% taxable).
 * Thresholds ($25k/$34k single, $32k/$44k joint) are unindexed by statute.
 */
export function taxableSocialSecurity(socialSecurity: number, otherIncome: number, status: TableStatus): number {
  if (socialSecurity <= 0) return 0;
  if (status === 'married_separate') {
    return Math.min(0.85 * socialSecurity, 0.85 * Math.max(0, otherIncome + 0.5 * socialSecurity));
  }
  const t1 = status === 'married_joint' ? 32_000 : 25_000;
  const t2 = status === 'married_joint' ? 44_000 : 34_000;
  const provisional = otherIncome + 0.5 * socialSecurity;
  if (provisional <= t1) return 0;
  if (provisional <= t2) return Math.min(0.5 * socialSecurity, 0.5 * (provisional - t1));
  const base50 = Math.min(0.5 * socialSecurity, 0.5 * (t2 - t1));
  return Math.min(0.85 * socialSecurity, base50 + 0.85 * (provisional - t2));
}

export type YearTaxBreakdown = {
  totalTax: number;
  federalTax: number;
  stateTax: number;
  earlyPenalty: number;
  ordinaryTaxable: number;
};

/** Fast federal + state + early-penalty tax estimator for one retirement year in today's dollars. */
export function estimateRetirementYearTax(
  ctx: RetirementTaxContext,
  {
    ordinaryNonSs,
    socialSecurity,
    longTermGains,
    earlyPenaltyBase,
  }: {
    ordinaryNonSs: number;
    socialSecurity: number;
    longTermGains: number;
    earlyPenaltyBase: number;
  },
): YearTaxBreakdown {
  const ord = Math.max(0, ordinaryNonSs);
  const ltg = Math.max(0, longTermGains);
  const taxSs = taxableSocialSecurity(socialSecurity, ord + ltg, ctx.status);
  const agi = ord + taxSs + ltg;
  const stdDed = ctx.fed.standardDeduction[ctx.status];
  const taxableIncome = Math.max(0, agi - stdDed);
  const preferential = Math.min(taxableIncome, ltg);
  const ordinaryTaxable = taxableIncome - preferential;
  const ordinaryTax = bracketTax(ctx.fed.brackets[ctx.status], ordinaryTaxable);

  const cg = ctx.fed.capitalGains[ctx.status];
  const atZero = Math.min(preferential, Math.max(0, cg.zeroUpTo - ordinaryTaxable));
  const atFifteen = Math.min(preferential - atZero, Math.max(0, cg.fifteenUpTo - Math.max(ordinaryTaxable, cg.zeroUpTo)));
  const capitalGainsTax = 0.15 * atFifteen + 0.2 * (preferential - atZero - atFifteen);
  const niit = 0.038 * Math.min(ltg, Math.max(0, agi - ctx.fed.niitThreshold[ctx.status]));
  const federalTax = ordinaryTax + capitalGainsTax + niit;

  const stateTax = ctx.stateTable
    ? calculateStateTax({ table: ctx.stateTable, year: 2026, status: ctx.status, federalAgi: agi }).total
    : 0;
  const earlyPenalty = 0.1 * Math.max(0, earlyPenaltyBase);
  return {
    totalTax: federalTax + stateTax + earlyPenalty,
    federalTax,
    stateTax,
    earlyPenalty,
    ordinaryTaxable,
  };
}

/** Mutable bucket state stepped year-by-year inside projections and Monte Carlo trials. */
export type BucketState = {
  pretax: number;
  roth: number;
  taxable: number;
  taxableBasis: number;
  pretax457b: number;
  rothBasis: number;
};

export function initBucketState(cfg: DetailedRetirementConfig): BucketState {
  return {
    pretax: Math.max(0, cfg.buckets.pretax),
    roth: Math.max(0, cfg.buckets.roth),
    taxable: Math.max(0, cfg.buckets.taxable),
    taxableBasis: Math.min(Math.max(0, cfg.taxableBasis), Math.max(0, cfg.buckets.taxable)),
    pretax457b: Math.min(Math.max(0, cfg.pretax457bBalance), Math.max(0, cfg.buckets.pretax)),
    rothBasis: Math.min(Math.max(0, cfg.rothContributionBasis), Math.max(0, cfg.buckets.roth)),
  };
}

export function scaleBucketState(cfg: DetailedRetirementConfig, scale: number): BucketState {
  const s = Math.max(0, scale);
  return {
    pretax: Math.max(0, cfg.buckets.pretax * s),
    roth: Math.max(0, cfg.buckets.roth * s),
    taxable: Math.max(0, cfg.buckets.taxable * s),
    taxableBasis: Math.min(Math.max(0, cfg.taxableBasis * s), Math.max(0, cfg.buckets.taxable * s)),
    pretax457b: Math.min(Math.max(0, cfg.pretax457bBalance * s), Math.max(0, cfg.buckets.pretax * s)),
    rothBasis: Math.min(Math.max(0, cfg.rothContributionBasis * s), Math.max(0, cfg.buckets.roth * s)),
  };
}

export function totalBuckets(b: Pick<BucketState, 'pretax' | 'roth' | 'taxable'>): number {
  return b.pretax + b.roth + b.taxable;
}

/** Normalize a percentage split into fractions summing to 1, falling back to a sensible default if empty. */
export function normalizeContributionSplit(
  split: ContributionSplit | null,
  buckets: BucketBalances,
): { pretax: number; roth: number; taxable: number } {
  if (split) {
    const sum = split.pretax + split.roth + split.taxable;
    if (sum > 0) {
      return { pretax: split.pretax / sum, roth: split.roth / sum, taxable: split.taxable / sum };
    }
  }
  const total = buckets.pretax + buckets.roth + buckets.taxable;
  if (total > 0) {
    return { pretax: buckets.pretax / total, roth: buckets.roth / total, taxable: buckets.taxable / total };
  }
  return { pretax: 0.7, roth: 0.2, taxable: 0.1 };
}

/** IRS age-50 and 60–63 catch-up additions (2026 rules) for a working earner. */
export function catchUpForAge(age: number): number {
  const limits = federalTables(2026).limits;
  if (age >= 60 && age <= 63) return limits.k401CatchUp60to63;
  if (age >= 50) return limits.k401CatchUp;
  return 0;
}

/** Apply a start-of-year lump sum (property sale or one-time event) to the 3 buckets. */
export function applyBucketLump(state: BucketState, lump: number): boolean {
  if (lump === 0) return false;
  if (lump > 0) {
    state.taxable += lump;
    state.taxableBasis += lump;
    return false;
  }
  let need = -lump;
  const fromTaxable = Math.min(state.taxable, need);
  if (fromTaxable > 0) {
    const ratio = fromTaxable / state.taxable;
    state.taxable -= fromTaxable;
    state.taxableBasis = Math.max(0, state.taxableBasis * (1 - ratio));
    need -= fromTaxable;
  }
  const fromRoth = Math.min(state.roth, need);
  if (fromRoth > 0) {
    state.roth -= fromRoth;
    state.rothBasis = Math.max(0, state.rothBasis - fromRoth);
    need -= fromRoth;
  }
  const fromPretax = Math.min(state.pretax, need);
  if (fromPretax > 0) {
    state.pretax -= fromPretax;
    state.pretax457b = Math.max(0, state.pretax457b - fromPretax);
    need -= fromPretax;
  }
  return need > 0.005;
}

export type BucketYearResult = {
  short: boolean;
  saving: number;
  withdrawal: number;
  withdrawals: BucketWithdrawals;
  estimatedTax: number;
  earlyPenalty: number;
  rmd: number;
  rothConversion: number;
};

/** Compute how `extraNeed` (above mandatory RMD) is pulled from the 3 buckets for a given strategy. */
function allocateDraws(
  state: BucketState,
  rmd: number,
  extraNeed: number,
  order: WithdrawalOrder,
  earlyAccessRestricted: boolean,
  bracketRoomForPretax: number,
): { pretax: number; roth: number; taxable: number } {
  const availPretax = Math.max(0, state.pretax - rmd);
  const availTaxable = state.taxable;
  const availRoth = state.roth;

  let pretax = rmd;
  let taxable = 0;
  let roth = 0;
  let rem = Math.max(0, extraNeed);

  const takeTaxable = (cap = Infinity) => {
    const d = Math.min(rem, availTaxable - taxable, cap);
    taxable += d;
    rem -= d;
  };
  const takePretax = (cap = Infinity) => {
    const d = Math.min(rem, availPretax - (pretax - rmd), cap);
    pretax += d;
    rem -= d;
  };
  const takeRoth = (cap = Infinity) => {
    const d = Math.min(rem, availRoth - roth, cap);
    roth += d;
    rem -= d;
  };

  if (rem <= 0) return { pretax, roth, taxable };

  if (order === 'taxable_first') {
    takeTaxable();
    if (earlyAccessRestricted) {
      // Tap penalty-free 457(b) and Roth contributions before taking penalized pre-tax draws.
      takePretax(Math.max(0, state.pretax457b - rmd));
      takeRoth(state.rothBasis);
    }
    takePretax();
    takeRoth();
  } else if (order === 'pretax_first') {
    if (earlyAccessRestricted) {
      takePretax(Math.max(0, state.pretax457b - rmd));
      takeTaxable();
      takeRoth(state.rothBasis);
      takePretax();
      takeRoth();
    } else {
      takePretax();
      takeTaxable();
      takeRoth();
    }
  } else if (order === 'bracket_fill') {
    if (earlyAccessRestricted) {
      // Fill low bracket only with penalty-free 457(b) before 59½, then taxable & Roth basis.
      takePretax(Math.min(bracketRoomForPretax, Math.max(0, state.pretax457b - rmd)));
      takeTaxable();
      takeRoth(state.rothBasis);
      takePretax();
      takeRoth();
    } else {
      takePretax(Math.max(0, bracketRoomForPretax));
      takeTaxable();
      takeRoth();
      takePretax();
    }
  } else {
    // pro_rata across remaining balances
    const totalAvail = availTaxable + availPretax + availRoth;
    if (totalAvail > 0) {
      const ratio = Math.min(1, rem / totalAvail);
      taxable += availTaxable * ratio;
      pretax += availPretax * ratio;
      roth += availRoth * ratio;
      rem = Math.max(0, rem - totalAvail * ratio);
    }
  }

  return { pretax, roth, taxable };
}

/**
 * Steps `state` forward by one year at real return `r` using the 3-bucket tax-aware model.
 * Mutates `state` in place for fast Monte Carlo execution.
 */
export function stepBucketYear(
  state: BucketState,
  cfg: DetailedRetirementConfig,
  taxCtx: RetirementTaxContext,
  {
    age,
    phase,
    r,
    spending,
    workingNetIncome,
    plannedSaving,
    socialSecurity,
    pension,
    rent,
    eventIncome,
    youWorking,
    partnerAge,
    partnerWorking,
  }: {
    age: number;
    phase: 'working' | 'bridge' | 'retired';
    r: number;
    spending: number;
    workingNetIncome: number;
    plannedSaving: number;
    socialSecurity: number;
    pension: number;
    rent: number;
    eventIncome: number;
    youWorking: boolean;
    partnerAge: number | null;
    partnerWorking: boolean;
  },
): BucketYearResult {
  const catchUp =
    cfg.includeCatchUps
      ? (youWorking ? catchUpForAge(age) : 0) + (partnerWorking && partnerAge !== null ? catchUpForAge(partnerAge) : 0)
      : 0;

  // Working year (and before RMD age): grow balances, then add contributions split across buckets.
  const rmd = calculateRmd(state.pretax, age, cfg.birthYear);
  if (phase === 'working' && rmd <= 0) {
    const saving = Math.max(0, plannedSaving + catchUp);
    state.pretax = Math.max(0, state.pretax * (1 + r) + saving * cfg.contributionSplit.pretax);
    state.pretax457b = Math.min(state.pretax, Math.max(0, state.pretax457b * (1 + r)));
    const rothAdd = saving * cfg.contributionSplit.roth;
    state.roth = Math.max(0, state.roth * (1 + r) + rothAdd);
    state.rothBasis += rothAdd;
    const taxAdd = saving * cfg.contributionSplit.taxable;
    state.taxable = Math.max(0, state.taxable * (1 + r) + taxAdd);
    state.taxableBasis += taxAdd;
    return {
      short: false,
      saving,
      withdrawal: 0,
      withdrawals: { pretax: 0, roth: 0, taxable: 0 },
      estimatedTax: 0,
      earlyPenalty: 0,
      rmd: 0,
      rothConversion: 0,
    };
  }

  // Surplus bridge year (without RMD): working partner's net pay covers spending and saves the surplus.
  if (phase === 'bridge' && rmd <= 0) {
    const covered = workingNetIncome + socialSecurity + pension + rent;
    const surplus = covered - spending;
    if (surplus >= 0) {
      const cap = Math.max(0, plannedSaving + catchUp);
      const net = Math.min(cap, surplus) + eventIncome;
      if (net >= 0) {
        state.pretax = Math.max(0, state.pretax * (1 + r) + net * cfg.contributionSplit.pretax);
        state.pretax457b = Math.min(state.pretax, Math.max(0, state.pretax457b * (1 + r)));
        const rothAdd = net * cfg.contributionSplit.roth;
        state.roth = Math.max(0, state.roth * (1 + r) + rothAdd);
        state.rothBasis += rothAdd;
        const taxAdd = net * cfg.contributionSplit.taxable;
        state.taxable = Math.max(0, state.taxable * (1 + r) + taxAdd);
        state.taxableBasis += taxAdd;
        return {
          short: false,
          saving: net,
          withdrawal: 0,
          withdrawals: { pretax: 0, roth: 0, taxable: 0 },
          estimatedTax: 0,
          earlyPenalty: 0,
          rmd: 0,
          rothConversion: 0,
        };
      }
    }
  }

  // Drawdown / RMD year: solve gross withdrawal + federal/state tax + optional Roth conversion.
  const earlyRestricted = age < 60 && !cfg.penaltyFreeEarlyAccess;
  const gainShare = state.taxable > 0 ? Math.max(0, 1 - state.taxableBasis / state.taxable) : 0;
  const baseOrdinary = Math.max(0, pension) + Math.max(0, rent) + Math.max(0, eventIncome);
  const nonPortfolioCash = workingNetIncome + socialSecurity + pension + rent + eventIncome;
  const effectiveSpending = phase === 'working' ? 0 : spending;

  const targetBracketCeiling =
    cfg.withdrawalOrder === 'bracket_fill'
      ? Math.max(taxCtx.lowBracketCeiling, taxCtx.conversionCeiling)
      : taxCtx.lowBracketCeiling;

  let taxGuess = 0;
  let draws = { pretax: rmd, roth: 0, taxable: 0 };
  let taxInfo: YearTaxBreakdown = { totalTax: 0, federalTax: 0, stateTax: 0, earlyPenalty: 0, ordinaryTaxable: 0 };

  for (let iter = 0; iter < 24; iter++) {
    const grossNeed = Math.max(0, effectiveSpending + taxGuess - nonPortfolioCash);
    const extraNeed = Math.max(0, grossNeed - rmd);

    // Estimate room in target ordinary bracket before pre-tax withdrawals beyond RMD.
    const baseTaxSs = taxableSocialSecurity(socialSecurity, baseOrdinary + rmd, taxCtx.status);
    const baseOrdTaxable = Math.max(0, baseOrdinary + rmd + baseTaxSs - taxCtx.fed.standardDeduction[taxCtx.status]);
    const bracketRoom = Math.max(0, targetBracketCeiling - baseOrdTaxable);

    draws = allocateDraws(state, rmd, extraNeed, cfg.withdrawalOrder, earlyRestricted, bracketRoom);

    const earlyPenaltyBase = earlyRestricted
      ? Math.max(0, draws.pretax - state.pretax457b) + Math.max(0, draws.roth - state.rothBasis)
      : 0;
    const ltg = draws.taxable * gainShare;
    taxInfo = estimateRetirementYearTax(taxCtx, {
      ordinaryNonSs: baseOrdinary + draws.pretax,
      socialSecurity,
      longTermGains: ltg,
      earlyPenaltyBase,
    });
    if (Math.abs(taxInfo.totalTax - taxGuess) < 0.005) break;
    taxGuess = taxInfo.totalTax;
  }

  let rothConversion = 0;
  const totalDrawBeforeConv = draws.pretax + draws.taxable + draws.roth;
  const shortBeforeConv = nonPortfolioCash + totalDrawBeforeConv + 0.01 < effectiveSpending + taxInfo.totalTax;

  // Optional Roth conversion up to the chosen federal bracket ceiling when not running short.
  if (
    !shortBeforeConv &&
    phase !== 'working' &&
    cfg.rothConversionBracket !== null &&
    taxCtx.conversionCeiling > 0 &&
    state.pretax - draws.pretax > 1
  ) {
    const room = Math.max(0, taxCtx.conversionCeiling - taxInfo.ordinaryTaxable);
    const maxConv = Math.min(room, state.pretax - draws.pretax);
    if (maxConv > 100) {
      const earlyPenaltyBase = earlyRestricted
        ? Math.max(0, draws.pretax - state.pretax457b) + Math.max(0, draws.roth - state.rothBasis)
        : 0;
      const spareTaxable = Math.max(0, state.taxable - draws.taxable);
      const currentSurplus = Math.max(0, nonPortfolioCash + totalDrawBeforeConv - effectiveSpending - taxInfo.totalTax);
      const cashForConvTax = spareTaxable + currentSurplus;

      const evalConversion = (conv: number) => {
        // Solve extra taxable withdrawal needed to pay the conversion tax (including LTCG on that sale).
        let extraTaxable = 0;
        let finalTax = taxInfo;
        for (let k = 0; k < 8; k++) {
          finalTax = estimateRetirementYearTax(taxCtx, {
            ordinaryNonSs: baseOrdinary + draws.pretax + conv,
            socialSecurity,
            longTermGains: (draws.taxable + extraTaxable) * gainShare,
            earlyPenaltyBase,
          });
          const neededFromTaxable = Math.max(0, finalTax.totalTax - taxInfo.totalTax - currentSurplus);
          if (Math.abs(neededFromTaxable - extraTaxable) < 0.005) {
            extraTaxable = neededFromTaxable;
            break;
          }
          extraTaxable = neededFromTaxable;
        }
        return { extraTaxable, finalTax };
      };

      const full = evalConversion(maxConv);
      if (full.extraTaxable <= spareTaxable + 0.01) {
        rothConversion = maxConv;
        draws.taxable += Math.min(spareTaxable, full.extraTaxable);
        taxInfo = full.finalTax;
      } else if (cashForConvTax > 100) {
        // Binary search largest conversion whose total tax (incl. LTCG on paying it) fits spare cash.
        let lo = 0;
        let hi = maxConv;
        let best = { conv: 0, extraTaxable: 0, finalTax: taxInfo };
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          const res = evalConversion(mid);
          if (res.extraTaxable <= spareTaxable + 0.005) {
            best = { conv: mid, extraTaxable: res.extraTaxable, finalTax: res.finalTax };
            lo = mid;
          } else {
            hi = mid;
          }
        }
        if (best.conv > 100) {
          rothConversion = best.conv;
          draws.taxable += Math.min(spareTaxable, best.extraTaxable);
          taxInfo = best.finalTax;
        }
      }
    }
  }

  const totalDraw = draws.pretax + draws.taxable + draws.roth;
  const inflow = nonPortfolioCash + totalDraw;
  const outflow = effectiveSpending + taxInfo.totalTax;
  const short = inflow + 0.01 < outflow;
  const surplus = Math.max(0, inflow - outflow);

  // Update balances & bases, then apply market growth for the year.
  const oldTaxable = state.taxable;
  const remPretax = Math.max(0, state.pretax - draws.pretax - rothConversion);
  const rem457b = Math.min(remPretax, Math.max(0, state.pretax457b - draws.pretax));
  const remRoth = Math.max(0, state.roth - draws.roth + rothConversion);
  const remRothBasis = Math.max(0, state.rothBasis - draws.roth);
  const remTaxable = Math.max(0, state.taxable - draws.taxable);
  const remTaxableBasis = oldTaxable > 0 ? Math.max(0, state.taxableBasis * (remTaxable / oldTaxable)) : 0;

  // Working year with RMD also adds planned saving.
  const extraWorkSaving = phase === 'working' ? Math.max(0, plannedSaving + catchUp) : 0;

  state.pretax = Math.max(0, remPretax * (1 + r) + extraWorkSaving * cfg.contributionSplit.pretax);
  state.pretax457b = Math.min(state.pretax, Math.max(0, rem457b * (1 + r)));
  state.roth = Math.max(0, remRoth * (1 + r) + extraWorkSaving * cfg.contributionSplit.roth);
  state.rothBasis = remRothBasis + extraWorkSaving * cfg.contributionSplit.roth;
  state.taxable = Math.max(0, (remTaxable + surplus) * (1 + r) + extraWorkSaving * cfg.contributionSplit.taxable);
  state.taxableBasis = remTaxableBasis + surplus + extraWorkSaving * cfg.contributionSplit.taxable;

  return {
    short,
    saving: extraWorkSaving + surplus,
    withdrawal: totalDraw,
    withdrawals: draws,
    estimatedTax: taxInfo.totalTax,
    earlyPenalty: taxInfo.earlyPenalty,
    rmd,
    rothConversion,
  };
}

// --- Friendly contextual nudges ---------------------------------------------

export type RetirementNudgeAction =
  | { kind: 'enable_detailed'; label: string }
  | { kind: 'open_profile'; label: string }
  | { kind: 'open_detailed_settings'; label: string }
  | { kind: 'ask_meld'; label: string; question: string };

export type RetirementNudge = {
  id: string;
  tone: 'info' | 'warning';
  title: string;
  summary: string;
  /** Friendly, jargon-free explanation shown when the user taps "What does this mean?". */
  explainer: string;
  action: RetirementNudgeAction;
};

export type RetirementNudgeContext = {
  planningMode: PlanningMode;
  currentAge: number;
  birthYear: number;
  retirementAge: number;
  firstRetireAge: number;
  filingStatus: FilingStatus | null;
  state: string | null;
  retirementState: string | null;
  accounts: { subtype: string | null; taxTreatment: 'taxable' | 'tax_deferred' | 'tax_free' | 'unknown'; value: number; included: boolean }[];
  otherSavings: number;
  projectedAtRetirement: number;
  withdrawalOrder: WithdrawalOrder;
  rothConversionBracket: RothConversionBracket | null;
  penaltyFreeEarlyAccess: boolean;
  rothContributionBasis: number | null;
};

/**
 * Generates concise, plain-English nudges only when the user's actual age, accounts,
 * or timeline make taxes, withdrawal order, RMDs, or early-access rules meaningfully important.
 */
export function buildRetirementNudges(ctx: RetirementNudgeContext): RetirementNudge[] {
  const nudges: RetirementNudge[] = [];
  const included = ctx.accounts.filter((a) => a.included);
  const pretax = included.filter((a) => a.taxTreatment === 'tax_deferred').reduce((s, a) => s + a.value, 0);
  const roth = included.filter((a) => a.taxTreatment === 'tax_free').reduce((s, a) => s + a.value, 0);
  const taxable =
    included.filter((a) => a.taxTreatment === 'taxable' || a.taxTreatment === 'unknown').reduce((s, a) => s + a.value, 0) +
    Math.max(0, ctx.otherSavings);
  const total = pretax + roth + taxable;
  const pretaxShare = total > 0 ? pretax / total : 0;
  const has457b = included.some((a) => is457bSubtype(a.subtype));
  const yearsToRetire = ctx.firstRetireAge - ctx.currentAge;
  const startRmd = rmdStartAge(ctx.birthYear);
  const effectiveState = ctx.retirementState ?? ctx.state;

  // 1. Missing profile tax details when in Detailed mode (or close to retirement)
  if ((!ctx.filingStatus || !effectiveState) && (ctx.planningMode === 'detailed' || yearsToRetire <= 10)) {
    const missingBits = [!ctx.filingStatus && 'filing status', !effectiveState && 'US state'].filter(Boolean).join(' and ');
    nudges.push({
      id: 'missing-tax-profile',
      tone: 'info',
      title: `Add your ${missingBits} for closer tax estimates`,
      summary: !effectiveState
        ? 'Meld is estimating federal taxes only because no state is set yet.'
        : 'Meld defaults to single tax brackets until you pick your filing status in Profile.',
      explainer:
        'Retirement withdrawals from traditional 401(k)s and IRAs are taxed like regular income. Your filing status (single vs. married) can roughly double the lower tax brackets, and state income taxes range from 0% (like FL, TX, or WA) up to ~9–13% (like CA or NY). Adding them takes a few seconds and makes your estimate much more realistic.',
      action: { kind: 'open_profile', label: 'Update Profile' },
    });
  }

  // 2. Near or already in retirement while still in Simple mode
  if (ctx.planningMode === 'simple' && yearsToRetire <= 10) {
    const timing = yearsToRetire <= 0 ? 'Since you’re already retired' : `With retirement ${yearsToRetire === 1 ? '1 year' : `${yearsToRetire} years`} away`;
    nudges.push({
      id: 'near-retirement-detailed',
      tone: 'info',
      title: 'Ready for a tax-aware withdrawal plan?',
      summary: `${timing}, taxes and which accounts you spend from first can swing your nest egg by 15–25%. Switch to Detailed mode to see estimated yearly taxes and required withdrawals automatically.`,
      explainer:
        'Simple mode treats all your savings as one big bucket and skips taxes—great when retirement is decades away and returns matter most. Closer to retirement, the mix of pre-tax (401(k)/IRA), Roth, and regular brokerage accounts matters a lot because each one is taxed differently when you spend it. Detailed mode uses the accounts you already linked—you don’t have to re-enter balances.',
      action: { kind: 'enable_detailed', label: 'Turn on Detailed mode' },
    });
  } else if (ctx.planningMode === 'simple' && pretaxShare >= 0.5 && total >= 50_000) {
    // 3. Heavy pre-tax mix while in Simple mode (even if >10 years out)
    const pct = Math.round(pretaxShare * 100);
    nudges.push({
      id: 'pretax-heavy-taxes',
      tone: 'info',
      title: `${pct}% of your retirement savings haven’t been taxed yet`,
      summary:
        'Simple mode doesn’t subtract income taxes when you withdraw from pre-tax accounts like a traditional 401(k) or IRA. Leave room for taxes in your spending—or turn on Detailed mode to estimate them automatically.',
      explainer:
        'With a traditional 401(k), 403(b), or IRA, you got a tax break when you put money in, so you pay income tax when you take it out. That means $100,000 in a traditional 401(k) buys less in retirement than $100,000 in a Roth IRA (which comes out tax-free). Detailed mode tracks all three account types separately so you can see the real after-tax picture.',
      action: { kind: 'enable_detailed', label: 'Preview with taxes' },
    });
  }

  // 4. Retiring early (before age 60) with heavy pre-tax savings and thin taxable bridge
  if (ctx.firstRetireAge < 60 && pretaxShare >= 0.45 && total >= 25_000 && !ctx.penaltyFreeEarlyAccess) {
    const bridgeYears = Math.max(1, 60 - ctx.firstRetireAge);
    const hasThinBridge = taxable + (ctx.rothContributionBasis ?? 0) < total * 0.25 && !has457b;
    if (hasThinBridge || ctx.planningMode === 'simple') {
      nudges.push({
        id: 'early-retirement-59-half',
        tone: 'warning',
        title: `Retiring at ${ctx.firstRetireAge}: watch the age 59½ rule`,
        summary: `Most of your savings are in pre-tax retirement accounts, which usually charge a 10% early-withdrawal penalty for the ${bridgeYears} ${bridgeYears === 1 ? 'year' : 'years'} before age 59½${has457b ? ' (though your 457(b) is exempt after leaving work)' : ''}.`,
        explainer:
          'Traditional 401(k)s, 403(b)s, and IRAs are meant for age 59½ and older—taking money out earlier normally adds a 10% IRS penalty on top of regular income tax. Early retirees avoid this by spending first from (1) a regular taxable brokerage account, (2) past Roth IRA contributions (which come out penalty-free anytime), (3) a governmental 457(b) plan, or (4) IRS exceptions like the “Rule of 55” (leaving your employer at 55+) or 72(t) scheduled withdrawals.',
        action:
          ctx.planningMode === 'simple'
            ? { kind: 'enable_detailed', label: 'Model early access in Detailed mode' }
            : {
                kind: 'open_detailed_settings',
                label: 'Set early-access rules',
              },
      });
    }
  }

  // 5. Large pre-tax balance & RMDs (age 50+ or within 15 yrs of retirement)
  const projectedPretaxApprox = total > 0 ? ctx.projectedAtRetirement * pretaxShare : 0;
  if (
    (pretax >= 400_000 || projectedPretaxApprox >= 800_000) &&
    (ctx.currentAge >= 50 || yearsToRetire <= 15) &&
    (ctx.planningMode === 'simple' || (ctx.withdrawalOrder === 'taxable_first' && ctx.rothConversionBracket === null))
  ) {
    nudges.push({
      id: 'rmd-preview',
      tone: 'info',
      title: `Required withdrawals (RMDs) start at age ${startRmd}`,
      summary:
        ctx.planningMode === 'simple'
          ? `With a large pre-tax balance, the IRS will eventually require yearly withdrawals starting at ${startRmd}, which can bump you into a higher tax bracket.`
          : `You’re currently set to spend taxable accounts first with no Roth conversions. Testing “Fill low tax bracket” or Roth conversions could shrink your age-${startRmd} required withdrawals.`,
      explainer:
        `RMD stands for Required Minimum Distribution. Because you haven't paid tax on traditional 401(k), 403(b), 457(b), or IRA money yet, the IRS requires you to withdraw a set percentage each year starting at age ${startRmd} (73 if born 1951–1959, 75 if born 1960 or later)—and pay income tax on it even if you don't need the cash. Moving some pre-tax money into a Roth account during lower-income early retirement years (“Roth conversions”) can smooth out your tax bill over time.`,
      action:
        ctx.planningMode === 'simple'
          ? { kind: 'enable_detailed', label: 'See RMDs in Detailed mode' }
          : { kind: 'open_detailed_settings', label: 'Explore Roth conversions' },
    });
  }

  // 6. High-tax state note in Detailed mode (if no retirementState override set)
  if (
    ctx.planningMode === 'detailed' &&
    ctx.state &&
    !ctx.retirementState &&
    ['CA', 'NY', 'NJ', 'OR', 'MN', 'DC', 'HI', 'VT', 'ME', 'MA'].includes(ctx.state.toUpperCase()) &&
    yearsToRetire > 0
  ) {
    const stName = stateName(ctx.state) ?? ctx.state;
    nudges.push({
      id: 'retirement-state-check',
      tone: 'info',
      title: `Planning to stay in ${stName} after retiring?`,
      summary: `Meld is estimating retirement taxes using ${stName} rates. If you might relocate to a lower- or no-income-tax state later, you can test that in Detailed settings.`,
      explainer:
        'Retirement withdrawals from pre-tax accounts and taxable capital gains are generally taxed by the state you live in when you take the money out—not the state where you earned it. Testing a different retirement state (or copying a scenario to compare both) shows how much location changes your lifetime tax bill.',
      action: { kind: 'open_detailed_settings', label: 'Set retirement state' },
    });
  }

  return nudges.slice(0, 3);
}
