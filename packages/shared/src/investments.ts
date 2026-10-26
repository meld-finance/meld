import { z } from 'zod';
import { Account as AccountSchema } from './accounts';
import { LiabilityDetails as LiabilityDetailsSchema } from './liabilities';

export const TaxTreatment = z.enum(['taxable', 'tax_deferred', 'tax_free', 'unknown']);
export type TaxTreatment = z.infer<typeof TaxTreatment>;

// Plaid investment account subtypes, grouped by how withdrawals are taxed.
const TAX_DEFERRED = new Set([
  '401a', '401k', '403b', '457b', 'ira', 'keogh', 'lif', 'lira', 'lrif', 'lrsp', 'pension',
  'prif', 'profit sharing plan', 'qshr', 'rdsp', 'resp', 'retirement', 'rlif', 'rrif', 'rrsp',
  'sarsep', 'sep ira', 'simple ira', 'sipp', 'thrift savings plan',
]);
const TAX_FREE = new Set(['roth', 'roth 401k', 'hsa', '529', 'tfsa', 'isa', 'education savings account']);
const TAXABLE = new Set([
  'brokerage', 'cash isa', 'crypto exchange', 'fixed annuity', 'gic', 'health reimbursement arrangement',
  'mutual fund', 'non-custodial wallet', 'non-taxable brokerage account', 'other annuity', 'other insurance',
  'stock plan', 'trust', 'ugma', 'utma', 'variable annuity',
]);

export function taxTreatment(subtype: string | null): TaxTreatment {
  const s = subtype?.toLowerCase();
  if (!s) return 'unknown';
  if (TAX_DEFERRED.has(s)) return 'tax_deferred';
  if (TAX_FREE.has(s)) return 'tax_free';
  if (TAXABLE.has(s)) return 'taxable';
  return 'unknown';
}

export const Holding = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  accountName: z.string(),
  accountSubtype: z.string().nullable(),
  taxTreatment: TaxTreatment,
  ticker: z.string().nullable(),
  name: z.string().nullable(),
  /** Plaid security type: equity, etf, mutual fund, fixed income, cash, derivative, cryptocurrency, other. */
  securityType: z.string().nullable(),
  quantity: z.number(),
  price: z.number().nullable(),
  value: z.number().nullable(),
  costBasis: z.number().nullable(),
});
export type Holding = z.infer<typeof Holding>;

export const AccountDetail = z.object({
  account: AccountSchema,
  liability: LiabilityDetailsSchema.nullable(),
  holdings: z.array(Holding),
});

export const InvestmentsSummary = z.object({
  totalValue: z.number(),
  holdings: z.array(Holding),
});
export type InvestmentsSummary = z.infer<typeof InvestmentsSummary>;
export type AccountDetail = z.infer<typeof AccountDetail>;
