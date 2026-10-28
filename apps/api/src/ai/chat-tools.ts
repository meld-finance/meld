import { currentValue, estimatePayoff, insuranceTotals, lookThrough, Month, TransactionQuery } from '@meld/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { accounts, investmentTransactions, manualAssets, securities } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts, listLiabilities } from '../services/accounts';
import { listPolicies } from '../services/insurance';
import { getInvestmentsSummary } from '../services/investments';
import {
  getBudgetStatus,
  getCashflow,
  getNetWorth,
  getNetWorthHistory,
  getSpendingByCategory,
} from '../services/overview';
import { getProfile } from '../services/profile';
import { listCategories, queryTransactions, totalsByMerchant } from '../services/transactions';

/**
 * A function the AI can call to look up the user's data. Provider-neutral:
 * each provider turns `input` into its own tool schema format.
 */
export type ChatTool<I extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  /** Shown in the app while the tool runs, e.g. "Checked spending for 2026-10". */
  label: (input: z.output<I>) => string;
  run: (input: z.output<I>) => Promise<unknown>;
};

const tool = <I extends z.ZodObject>(t: ChatTool<I>) => t as unknown as ChatTool;

const isoDate = z.iso.date();
const dateRange = {
  from: isoDate.optional().describe('Start date, inclusive (YYYY-MM-DD)'),
  to: isoDate.optional().describe('End date, inclusive (YYYY-MM-DD)'),
};

/**
 * Masks long digit runs (account, card or policy numbers that may appear in
 * transaction descriptions) before anything is sent to the AI provider.
 */
export function maskNumbers(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      // 9+ digits, optionally grouped by spaces or dashes; ISO dates (8 digits) are left alone.
      typeof v === 'string' ? v.replace(/\d(?:[ -]?\d){8,}/g, (m) => `••••${m.replace(/\D/g, '').slice(-4)}`) : v,
    ),
  );
}

export function createChatTools(db: Db): ChatTool[] {
  return [
    tool({
      name: 'get_accounts',
      description:
        'All linked and manual accounts that count toward totals: name, institution, type (depository, credit, investment, loan, mortgage), subtype (checking, 401k, roth, ...), and balances. Balances on credit, loan and mortgage accounts are amounts owed. `currentBalance` is the full account balance; on a jointly held account `ownershipPercent` is the user’s share (null = 100%), and only the share counts toward net worth, cash flow, spending and budgets. Also returns manually entered assets such as a home or car; `value` is the full market value today (after any yearly `depreciationPercent` since `valueAsOf`) and `ownershipPercent` the user’s share (null = 100%), and only the share counts toward net worth.',
      input: z.object({}),
      label: () => 'Checked accounts and balances',
      run: async () => {
        const [list, manual] = await Promise.all([
          listAccounts(db, eq(accounts.hidden, false)),
          db
            .select({
              kind: manualAssets.kind,
              name: manualAssets.name,
              value: manualAssets.value,
              ownershipPercent: manualAssets.ownershipPercent,
              valueAsOf: manualAssets.valueAsOf,
              depreciationPercent: manualAssets.depreciationPercent,
            })
            .from(manualAssets),
        ]);
        return {
          accounts: list.map((a) => ({
            id: a.id,
            name: a.name,
            institution: a.institutionName,
            type: a.type,
            subtype: a.subtype,
            mask: a.mask,
            currentBalance: a.currentBalance,
            availableBalance: a.availableBalance,
            creditLimit: a.creditLimit,
            currency: a.currency,
            ownershipPercent: a.ownershipPercent,
          })),
          manualAssets: manual.map((m) => ({ ...m, value: currentValue(m) })),
        };
      },
    }),
    tool({
      name: 'get_net_worth',
      description: 'Current net worth (assets minus debts) with totals by account type, plus the daily net-worth history for the last `days` days.',
      input: z.object({ days: z.number().int().min(1).max(3650).default(365).describe('History length in days') }),
      label: () => 'Checked net worth',
      run: async ({ days }) => {
        const since = new Date();
        since.setDate(since.getDate() - days);
        const [current, history] = await Promise.all([getNetWorth(db), getNetWorthHistory(db, localDate(since))]);
        return { current, history };
      },
    }),
    tool({
      name: 'search_transactions',
      description:
        'Find individual bank and card transactions. Amount sign: positive = money out (purchases, payments), negative = money in (income, refunds). Amounts are the full transaction, even on jointly held accounts (see get_accounts `ownershipPercent`); totals from the other tools count only the user’s share. Combine filters as needed; results are newest first. Use spending_by_merchant or get_spending_by_category for totals instead of adding up pages of transactions.',
      input: z.object({
        search: z.string().optional().describe('Text to match in the merchant or description'),
        category: z.string().optional().describe('Exact category from list_categories, e.g. FOOD_AND_DRINK'),
        accountId: z.uuid().optional(),
        ...dateRange,
        limit: z.number().int().min(1).max(200).default(50),
      }),
      label: (q) => (q.search ? `Searched transactions for “${q.search}”` : 'Searched transactions'),
      run: async (q) => {
        const page = await queryTransactions(db, TransactionQuery.parse(q));
        return {
          total: page.total,
          returned: page.transactions.length,
          transactions: page.transactions.map((t) => ({
            date: t.date,
            amount: t.amount,
            merchant: t.merchantName ?? t.name,
            description: t.name,
            category: t.category,
            account: t.accountName,
            pending: t.pending || undefined,
            notes: t.notes ?? undefined,
          })),
        };
      },
    }),
    tool({
      name: 'spending_by_merchant',
      description: 'Net totals per merchant over a date range (positive = net money out), largest first, counting only the user’s share of jointly held accounts. Optional category filter.',
      input: z.object({
        ...dateRange,
        category: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      label: () => 'Totaled spending by merchant',
      run: ({ limit, ...q }) => totalsByMerchant(db, q, limit),
    }),
    tool({
      name: 'list_categories',
      description: 'Transaction categories in use (Plaid categories such as FOOD_AND_DRINK, plus any the user created).',
      input: z.object({}),
      label: () => 'Listed spending categories',
      run: () => listCategories(db),
    }),
    tool({
      name: 'get_spending_by_category',
      description:
        'Spending by category for one month, from cash and card accounts. Excludes transfers between the user’s accounts and credit card payments; refunds are netted out. Jointly held accounts count at the user’s ownership share.',
      input: z.object({ month: Month.describe('YYYY-MM') }),
      label: ({ month }) => `Checked spending for ${month}`,
      run: ({ month }) => getSpendingByCategory(db, month),
    }),
    tool({
      name: 'get_cashflow',
      description: 'Monthly income, spending and net for recent months (same rules as get_spending_by_category). Income is transactions categorized INCOME.',
      input: z.object({ months: z.number().int().min(1).max(24).default(6) }),
      label: ({ months }) => `Checked cash flow for ${months} months`,
      run: ({ months }) => getCashflow(db, months),
    }),
    tool({
      name: 'get_budgets',
      description: 'Monthly budget targets by category and how much has been spent against each in the given month.',
      input: z.object({ month: Month.describe('YYYY-MM') }),
      label: ({ month }) => `Checked budgets for ${month}`,
      run: ({ month }) => getBudgetStatus(db, month),
    }),
    tool({
      name: 'get_holdings',
      description:
        'Investment holdings across brokerage and retirement accounts: security, quantity, price, value, cost basis (for gains/losses), account, and tax treatment (taxable, tax_deferred, tax_free). Also the portfolio\'s approximate look-through exposure (inside funds) by asset class, stock sector, stock region and bond type, in dollars, and each holding\'s category. Values are the user\'s ownership share.',
      input: z.object({}),
      label: () => 'Checked investment holdings',
      run: async () => {
        const summary = await getInvestmentsSummary(db, null);
        const e = lookThrough(summary.holdings);
        const dollars = (w: Partial<Record<string, number>>) =>
          Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v!)]));
        return {
          totalValue: summary.totalValue,
          exposure: {
            assetClasses: dollars(e.assetClasses),
            notLookedUp: Math.round(e.unclassified),
            stockSectors: dollars(e.sectors),
            stockRegions: dollars(e.regions),
            bondTypes: dollars(e.bondTypes),
          },
          holdings: summary.holdings.map((h) => ({
            account: h.accountName,
            accountSubtype: h.accountSubtype,
            taxTreatment: h.taxTreatment,
            ticker: h.ticker,
            name: h.name,
            type: h.securityType,
            category: h.profile?.category ?? null,
            quantity: h.quantity,
            price: h.price,
            value: h.value,
            costBasis: h.costBasis,
            unrealizedGain: h.value !== null && h.costBasis !== null ? Math.round((h.value - h.costBasis) * 100) / 100 : null,
          })),
        };
      },
    }),
    tool({
      name: 'get_investment_transactions',
      description: 'Buys, sells, dividends, contributions and fees in investment accounts (up to 2 years), newest first.',
      input: z.object({ ...dateRange, limit: z.number().int().min(1).max(500).default(100) }),
      label: () => 'Checked investment activity',
      run: ({ from, to, limit }) =>
        db
          .select({
            date: investmentTransactions.date,
            account: accounts.name,
            type: investmentTransactions.type,
            subtype: investmentTransactions.subtype,
            description: investmentTransactions.name,
            ticker: securities.tickerSymbol,
            quantity: investmentTransactions.quantity,
            price: investmentTransactions.price,
            amount: investmentTransactions.amount,
            fees: investmentTransactions.fees,
          })
          .from(investmentTransactions)
          .innerJoin(accounts, eq(accounts.id, investmentTransactions.accountId))
          .leftJoin(securities, eq(securities.id, investmentTransactions.securityId))
          .where(
            and(
              eq(accounts.hidden, false),
              from ? gte(investmentTransactions.date, from) : undefined,
              to ? lte(investmentTransactions.date, to) : undefined,
            ),
          )
          .orderBy(desc(investmentTransactions.date), asc(investmentTransactions.name))
          .limit(limit),
    }),
    tool({
      name: 'get_loans_and_cards',
      description:
        'Terms for mortgages, student loans, other loans and credit cards: balance, interest rate, payment, dates, escrow, and an estimated payoff time and total interest at the current payment.',
      input: z.object({}),
      label: () => 'Checked loans and cards',
      run: async () =>
        (await listLiabilities(db)).map((l) => ({
          ...l,
          payoffAtCurrentPayment: estimatePayoff(l.balance, l.interestRatePct, l.minimumPayment),
        })),
    }),
    tool({
      name: 'get_insurance_policies',
      description:
        'Life and disability insurance policies the user entered: type, carrier, coverage (death benefit, or MONTHLY benefit for disability), premium, dates, cash value / cash surrender value / policy loans for permanent life (with the statement date; the surrender value counts toward net worth), waiting period, benefit period, own-occupation, employer-provided, beneficiaries, notes. Includes totals.',
      input: z.object({}),
      label: () => 'Checked insurance policies',
      run: async () => {
        const policies = await listPolicies(db);
        return {
          totals: insuranceTotals(policies, localDate()),
          policies: policies.map(({ documentId: _d, documentFilename: _f, createdAt: _c, ...p }) => p),
        };
      },
    }),
    tool({
      name: 'get_profile',
      description: 'The user’s profile: birth year, tax filing status, state, dependents, gross income, occupation, employer benefits and goals. Fields may be null if not entered.',
      input: z.object({}),
      label: () => 'Checked your profile',
      run: () => getProfile(db),
    }),
  ];
}
