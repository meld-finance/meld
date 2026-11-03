import {
  currentValue,
  estimatePayoff,
  insuranceTotals,
  lookThrough,
  Month,
  projectRetirement,
  resolvePlan,
  RetirementPlan,
  SIMULATION_DEFAULTS,
  simulateRetirement,
  formatFullRetirementAge,
  socialSecurityAtFullAge,
  TransactionQuery,
} from '@meld/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { accounts, investmentTransactions, manualAssets, securities } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts, listLiabilities } from '../services/accounts';
import { getCashPlan } from '../services/cash';
import { getEstateSummary } from '../services/estate';
import { listPolicies } from '../services/insurance';
import { getInvestmentsSummary } from '../services/investments';
import { getInvestmentPerformance } from '../services/performance';
import {
  getBudgetStatus,
  getCashflow,
  getNetWorth,
  getNetWorthHistory,
  getSpendingByCategory,
} from '../services/overview';
import { getProfile } from '../services/profile';
import { listAlerts } from '../services/alerts';
import { getRecurringSummary } from '../services/recurring';
import { getRetirement } from '../services/retirement';
import { getTaxPlan } from '../services/tax';
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

/** Tool rounds per user message before giving up. */
export const MAX_TOOL_ROUNDS = 12;

/** Validates and runs one tool call; failures go back to the model as an error result. */
export async function runTool(tool: ChatTool | undefined, input: unknown): Promise<{ content: string; isError: boolean }> {
  if (!tool) return { content: 'Unknown tool.', isError: true };
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { content: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  try {
    return { content: JSON.stringify(maskNumbers(await tool.run(parsed.data))), isError: false };
  } catch {
    return { content: 'The lookup failed. Answer with what you have, or try different input.', isError: true };
  }
}

/** What the app shows for a tool call, e.g. "Checked spending for 2026-10". */
export function toolLabel(tool: ChatTool | undefined, name: string, input: unknown): string {
  const parsed = tool?.input.safeParse(input);
  return tool && parsed?.success ? tool.label(parsed.data) : name;
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
      name: 'get_investment_performance',
      description:
        'How investments grew, with deposits and withdrawals kept apart from market gains, for 1 month, 3 months, year to date, 1 year, all history (up to 2 years) and each calendar year, in total and by account. `gain` is what markets, dividends and interest earned (end − start − contributions + withdrawals); `return` is the time-weighted return as a fraction and `annualized` its yearly rate (periods of a year or more). Values before `estimatedBefore` are estimated from transactions and market prices; holdings in `approximated` lack market prices, and accounts in `limitedHistory` have little transaction history, so treat those figures as rough. Values are the user\'s ownership share.',
      input: z.object({}),
      label: () => 'Checked investment performance',
      run: async () => {
        const { points: _points, ...performance } = await getInvestmentPerformance(db);
        return performance;
      },
    }),
    tool({
      name: 'get_tax_plan',
      description:
        'Meld’s estimate of a year’s federal and state income tax from Plan → Tax: projected full-year income (wages after pre-tax 401(k), self-employment, interest, ordinary and qualified dividends, net short- and long-term gains), federal AGI, deduction, taxable income, tax by part (ordinary, capital gains, NIIT, additional Medicare, self-employment, child tax credit), the federal bracket and room left in it, room for 0% long-term gains, state tax, total and effective rate, `marginalRate` (federal + state on the next $1,000), and `balanceDue` after projected withholding (null when withholding wasn’t entered). `detected` is what synced accounts show so far this year: paychecks, contractor deposits, investment income in taxable accounts, realized gains rebuilt by average cost (`realizedRough` means rough), contributions by account type and pre-tax IRA balances. `harvest` lists taxable holdings with unrealized losses and any purchase in the last 30 days (wash-sale risk). `suggestions` are rule-based moves with the estimated tax saved this year. `checklist` puts dates on them for the year-end countdown: each item’s `due` date (last trading day for harvesting, last paycheck for 401(k) deferrals, Jan 15 for the Q4 estimated payment, the filing deadline for IRA/HSA/SEP contributions, Dec 31 for charity, FSA and RMDs), `dueLabel`, estimated `impact`, `general` when it rests on something Meld can’t see (an FSA, payroll timing), and `done` when the user ticked it off; only deadlines still ahead are listed. `notes` say where figures rest on assumptions. `missing` lists profile fields needed for an estimate. An estimate, not a filed return.',
      input: z.object({ year: z.number().int().min(2000).max(2100).optional().describe('Tax year; this year when left out') }),
      label: ({ year }) => `Checked your ${year ?? 'current'} tax estimate`,
      run: ({ year }) => getTaxPlan(db, year ?? Number(localDate().slice(0, 4))),
    }),
    tool({
      name: 'get_cash_plan',
      description:
        'Liquid cash and emergency fund from Accounts → Cash. `positions`: checking, savings and money market accounts (kind bank), money market funds and cash ETFs (fund) and brokerage sweep cash (sweep), each with its value (the user’s share), yearly rate `apy` as a fraction and where it came from (`entered` by the user, bank `interest` paid lately, fund `distributions` over the last year, or `assumed` to be about the Treasury rate), whether it’s in a tax-advantaged account (not available for emergencies) and whether the user `earmarked` it for something else. `totals`: emergency cash, the blended rate, interest a year and `missedInterest` (extra a year at the benchmark rate). `benchmark.apy` is what high-yield savings and money market funds pay now (3-month Treasury yield unless entered). `spending.monthly` is entered or the average of recent complete months; `emergency` is the target months, the target, months of runway and the gap (positive is extra cash, negative is a shortfall). `suggestions` are rule-based nudges with the extra interest a year where there is one.',
      input: z.object({}),
      label: () => 'Checked your cash and emergency fund',
      run: () => getCashPlan(db),
    }),
    tool({
      name: 'get_recurring',
      description:
        'Recurring charges, autopay and alerts from Spending → Recurring. `series`: subscriptions, bills and income (paychecks) Meld detected from transactions that repeat on a schedule, each with its cadence, expected `amount` (`amountVaries` for bills like utilities), `monthlyAmount`, the account charged, first/last/next dates, `status` (`active`, `stopped` when charges stopped and it may have been canceled, `ignored` when the user said it isn’t recurring) and `priceChange` when the latest charge differs from a steady price. `autopay`: cards and loans the user said are paid automatically from a bank account, each with the next `dueDate` and `amount` (`amountSource` statement, minimum, fixed, scheduled loan payment, or `estimate` from the current balance when the next statement isn’t out), the funding account’s balance, other payments and paychecks before the due date (`before`), `projectedAfter` and `health` (covered, tight, short, paid, unknown). `suggestions`: cards or loans that look paid from a bank account each month but have no autopay set up in Meld. `upcoming`: what’s due over the next 30 days. `alerts`: open and recent alerts (autopay shortfalls, low balances, large charges, price increases, new recurring charges, bank connections).',
      input: z.object({}),
      label: () => 'Checked recurring payments and alerts',
      run: async () => {
        const [summary, alerts] = await Promise.all([getRecurringSummary(db), listAlerts(db)]);
        return { ...summary, alerts: alerts.alerts.filter((a) => !a.dismissedAt && !a.resolvedAt) };
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
      name: 'get_estate_plan',
      description:
        'The user’s estate plan from Plan → Estate: how each account, property and life policy passes on death (`method`: beneficiary designation, transfer/payable on death, joint with survivorship, a trust, by will, or not set up), its named primary and contingent beneficiaries with shares, and a `status` (ok, missing = needs a beneficiary and has none, review = would go through probate or something looks off, n/a). Also the estate documents on file (trusts, will, powers of attorney, healthcare directive, guardianship) with signing and review dates and the roles of the people they name, the readiness checks Meld found, and whether the family packet is up to date. Organizing help, not legal advice: suggest an estate attorney for drafting or state-specific questions.',
      input: z.object({}),
      label: () => 'Checked your estate plan',
      run: async () => {
        const { fingerprint: _f, settings, documents, targets, ...summary } = await getEstateSummary(db);
        return {
          ...summary,
          targets: targets.map(({ notes: _n, href: _h, accountNumberLast4: _a, ...t }) => t),
          // Names and roles only; contact details stay out of the AI's context.
          documents: documents.map((d) => ({
            kind: d.kind,
            name: d.name,
            signedDate: d.signedDate,
            state: d.state,
            reviewedAt: d.reviewedAt,
            people: d.people.map((p) => ({ name: p.name, role: p.role, relationship: p.relationship })),
            hasAttorney: d.attorney !== null,
          })),
          contacts: settings.contacts.map((c) => ({ role: c.role, name: c.name })),
          hasInstructions: !!settings.instructions,
          reviewIntervalYears: settings.reviewIntervalYears,
        };
      },
    }),
    tool({
      name: 'get_profile',
      description: 'The user’s profile: birth year, tax filing status, state, dependents, children (each with an id and birth year), gross income, occupation, employer benefits and goals. Fields may be null if not entered.',
      input: z.object({}),
      label: () => 'Checked your profile',
      run: () => getProfile(db),
    }),
    tool({
      name: 'get_retirement_plan',
      description:
        'The user’s retirement plan from Plan → Retirement: their assumptions (with which ones are Meld’s defaults), the investment accounts counted toward retirement and those left out (education/custodial accounts always; others by the user’s choice), properties the user plans to sell to fund retirement (`assumptions.sales`: sale age, net proceeds after appreciation, selling costs and the mortgage left, and net rent per year until the sale), and a year-by-year projection. All amounts are in today’s dollars with an after-inflation return. `needed` is the balance at retirement age that lasts to life expectancy, `gap` is needed minus projected (≤ 0 means on track), and `extraMonthly` is the added monthly contribution that closes the gap. `socialSecurity` gives the yearly benefit at full retirement age (from the user’s statement, or estimated from profile income when `estimated`); `assumptions.socialSecurityAnnual` is what’s received from the claiming age after the early or delayed adjustment. `annualSpending` is today’s yearly spending; each year’s spending adds the `spendingChanges` under way at that age (signed, from `startAge` up to but not including `endAge`, e.g. kids leaving home or a mortgage paid off; when `childId` names a child from the profile, the ages are that child’s, e.g. a child leaving home at 18; `monthly` only says the user entered it per month, `annualChange` is always yearly) and then falls `spendingDeclinePercent` a year after 75. `spendingChanges` in a what-if replaces the saved list. `projection.spendingAtRetirement` is spending in the first year of retirement. Pass any of the optional inputs to try a what-if scenario without changing the saved plan. The plan is the user’s active scenario (`scenario`); `otherScenarios` names the other saved versions they’ve made on Plan → Retirement. `monteCarlo` runs the plan with random yearly returns (lognormal, averaging the expected return, with `volatility` percent standard deviation): `successRate` is the share of trials where the money lasts to life expectancy, and `atRetirement` gives the 10th, 50th and 90th percentile balance at retirement age.',
      input: RetirementPlan.pick({
        retirementAge: true,
        annualContribution: true,
        annualSpending: true,
        spendingChanges: true,
        spendingDeclinePercent: true,
        expectedReturn: true,
        socialSecurityAge: true,
      })
        .partial()
        .describe('Optional what-if overrides; omit to use the saved plan'),
      label: (input) => (Object.keys(input).length ? 'Ran a retirement what-if' : 'Checked your retirement plan'),
      run: async (overrides) => {
        const summary = await getRetirement(db);
        const whatIf = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null));
        const plan = { ...summary.plan, ...whatIf };
        const resolved = resolvePlan(plan, summary);
        if (!resolved.inputs) return { missing: resolved.missing, accounts: summary.accounts };
        const projection = projectRetirement(resolved.inputs);
        const simulation = simulateRetirement(resolved.inputs, SIMULATION_DEFAULTS);
        const { excludedAccountIds: _e, ...saved } = summary.plan;
        return {
          scenario: summary.scenario.name,
          otherScenarios: summary.scenarios.filter((s) => !s.active).map((s) => s.name),
          assumptions: resolved.inputs,
          socialSecurity: {
            ...socialSecurityAtFullAge(plan, summary.defaults, resolved.inputs.retirementAge),
            fullRetirementAge: formatFullRetirementAge(summary.defaults.birthYear!),
          },
          defaulted: Object.entries(saved)
            .filter(([k, v]) => v === null && !(k in whatIf))
            .map(([k]) => k),
          whatIf: Object.keys(whatIf).length ? whatIf : undefined,
          accounts: summary.accounts.map(({ id: _id, ...a }) => a),
          monteCarlo: {
            trials: SIMULATION_DEFAULTS.trials,
            volatility: SIMULATION_DEFAULTS.volatility,
            successRate: Math.round(simulation.successRate * 1000) / 1000,
            atRetirement: { p10: simulation.atRetirement.p10, p50: simulation.atRetirement.p50, p90: simulation.atRetirement.p90 },
            medianDepletionAge: simulation.medianDepletionAge,
          },
          projection: {
            ...projection,
            // Every five years keeps the result short; the last point shows what's left at the end.
            points: projection.points.filter((p, i, all) => i % 5 === 0 || i === all.length - 1),
          },
        };
      },
    }),
  ];
}
