import { z } from 'zod';

export const LiabilityKind = z.enum(['credit', 'mortgage', 'student', 'loan', 'line_of_credit']);
export type LiabilityKind = z.infer<typeof LiabilityKind>;

export const LiabilityDetails = z.object({
  kind: LiabilityKind,
  interestRatePct: z.number().nullable(),
  /** Minimum or scheduled monthly payment. For mortgages this usually includes escrow. */
  minimumPayment: z.number().nullable(),
  nextPaymentDueDate: z.string().nullable(),
  originationDate: z.string().nullable(),
  originationPrincipal: z.number().nullable(),
  maturityDate: z.string().nullable(),
  escrowBalance: z.number().nullable(),
});
export type LiabilityDetails = z.infer<typeof LiabilityDetails>;

/** A visible account's loan or card terms, as listed by `/liabilities`. */
export const LiabilitySummary = LiabilityDetails.extend({
  accountId: z.uuid(),
  accountName: z.string(),
  balance: z.number().nullable(),
});
export type LiabilitySummary = z.infer<typeof LiabilitySummary>;

export type PayoffEstimate = { months: number; totalInterest: number };

/**
 * Months to pay off `balance` at a fixed `monthlyPayment` and APR, with monthly
 * compounding. Returns null when the payment doesn't cover the interest (never
 * pays off) or inputs are missing. An estimate: ignores escrow, fees, rate changes.
 */
export function estimatePayoff(
  balance: number | null,
  annualRatePct: number | null,
  monthlyPayment: number | null,
): PayoffEstimate | null {
  if (!balance || balance <= 0 || !monthlyPayment || monthlyPayment <= 0 || annualRatePct === null) return null;
  const r = annualRatePct / 100 / 12;
  if (r === 0) {
    const months = Math.ceil(balance / monthlyPayment);
    return { months, totalInterest: 0 };
  }
  if (monthlyPayment <= balance * r) return null;
  const months = Math.ceil(-Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r));
  // Simulate the final partial payment for an accurate interest total.
  let remaining = balance;
  let interest = 0;
  for (let i = 0; i < months && remaining > 0; i++) {
    const charge = remaining * r;
    interest += charge;
    remaining = remaining + charge - monthlyPayment;
  }
  return { months, totalInterest: Math.round(interest * 100) / 100 };
}

/**
 * What's left on a loan after `months` of fixed payments, with monthly compounding. Without a rate or
 * payment it assumes no paydown; a payment that doesn't cover interest leaves the balance as is.
 */
export function remainingLoanBalance(
  balance: number,
  annualRatePct: number | null,
  monthlyPayment: number | null,
  months: number,
): number {
  if (balance <= 0) return 0;
  if (annualRatePct === null || !monthlyPayment || monthlyPayment <= 0 || months <= 0) return balance;
  const r = annualRatePct / 100 / 12;
  if (monthlyPayment <= balance * r) return balance;
  if (r === 0) return Math.max(0, balance - monthlyPayment * months);
  const grown = (1 + r) ** months;
  return Math.max(0, balance * grown - (monthlyPayment * (grown - 1)) / r);
}
