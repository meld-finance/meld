/**
 * Provider-neutral AI chat tools and read-only financial data lookups.
 *
 * Exports: `ChatTool`, `toToolJsonSchema`, `maskNumbers`, `MAX_TOOL_ROUNDS`,
 *          `runTool`, `toolLabel`, `buildOverview`, `createChatTools`.
 *
 * Tools in `createChatTools`:
 *   get_financial_overview, get_accounts, get_net_worth, search_transactions,
 *   spending_by_merchant, list_categories, get_spending_by_category, get_cashflow,
 *   get_budgets, get_holdings, get_loans_and_cards, get_profile,
 *   get_investment_performance, get_investment_transactions, get_cash_plan,
 *   get_recurring, get_tax_plan, get_retirement_plan, get_insurance_policies,
 *   get_estate_plan, get_meld_docs.
 */
import {
  currentValue,
  estimatePayoff,
  formatFullRetirementAge,
  insuranceTotals,
  lookThrough,
  Month,
  netCashValue,
  projectRetirement,
  resolvePlan,
  RetirementPlan,
  SIMULATION_DEFAULTS,
  simulateRetirement,
  socialSecurityAtFullAge,
  TransactionQuery,
} from '@meld/shared';
import { and, asc, count, desc, eq, gte, ilike, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { accounts, alerts, investmentTransactions, manualAssets, securities } from '../db/schema';
import { computeNetWorth, localDate } from '../lib/networth';
import { listAccounts, listLiabilities } from '../services/accounts';
import { listAlerts } from '../services/alerts';
import { getCashPlan } from '../services/cash';
import { getEquitySummary } from '../services/equity';
import { getEstateSummary } from '../services/estate';
import { listPolicies } from '../services/insurance';
import { getInvestmentsSummary } from '../services/investments';
import {
  getBudgetStatus,
  getCashflow,
  getNetWorth,
  getNetWorthHistory,
  getSnapshotAsOf,
  getSpendingByCategory,
  shiftYears,
} from '../services/overview';
import { addDays, daysBetween, getInvestmentPerformance } from '../services/performance';
import { getProfile } from '../services/profile';
import { getRecurringSummary } from '../services/recurring';
import { getRetirement } from '../services/retirement';
import { getTaxPlan } from '../services/tax';
import { escapeLike, listCategories, queryTransactions, totalsByMerchant } from '../services/transactions';
import { formatDocsToolLabel, lookupMeldDocs } from './meld-docs';

/**
 * A function the AI can call to look up the user's data. Provider-neutral:
 * each provider turns `input` into its own tool schema format.
 */
export type ChatTool<I extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  /** Specialist tools can be deferred on providers that support tool search. */
  deferLoading?: boolean;
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

const round = (n: number | null) => (n === null ? null : Math.round(n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Converts a Zod input schema to compact JSON Schema for LLM/MCP tool advertising.
 * Strips `$schema` and long date/UUID regexes; `runTool` still validates with full Zod.
 */
export function toToolJsonSchema(schema: z.ZodObject): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    const dropVerbosePattern =
      obj.format === 'date' || obj.format === 'uuid' || (typeof obj.pattern === 'string' && obj.pattern.length > 40);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$schema') continue;
      if (k === 'pattern' && dropVerbosePattern) continue;
      out[k] = strip(v);
    }
    return out;
  };
  return strip(raw) as Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Masks long digit runs (account, card or policy numbers that may appear in
 * transaction descriptions) before anything is sent to the AI provider.
 */
export function maskNumbers(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v !== 'string' || UUID_RE.test(v)) return v;
      // 9+ digits, optionally grouped by spaces or dashes; ISO dates (8 digits) are left alone.
      return v.replace(/\d(?:[ -]?\d){8,}/g, (m) => `••••${m.replace(/\D/g, '').slice(-4)}`);
    }),
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

/** Compact overview used by `get_financial_overview` and the `meld://overview` MCP resource. */
export async function buildOverview(db: Db, today = localDate()) {
  const [profile, accountList, manual, policies, [openAlertsRow], equity] = await Promise.all([
    getProfile(db),
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
    listPolicies(db),
    db.select({ n: count() }).from(alerts).where(and(isNull(alerts.dismissedAt), isNull(alerts.resolvedAt))),
    getEquitySummary(db, undefined, today, { refresh: 'background' }),
  ]);
  const cashValues = policies.flatMap((p) => {
    const v = netCashValue(p);
    return v === null ? [] : [v];
  });
  const netWorth = computeNetWorth(accountList, manual, cashValues);
  return {
    asOf: today,
    profile,
    netWorth: {
      assets: round(netWorth.assets),
      liabilities: round(netWorth.liabilities),
      netWorth: round(netWorth.netWorth),
      byType: netWorth.byType.map((t) => ({ ...t, total: round(t.total) })),
    },
    accounts: accountList.map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institutionName,
      type: a.type,
      subtype: a.subtype,
      balance: round(a.currentBalance),
      ...(a.ownershipPercent !== null && { ownershipPercent: a.ownershipPercent }),
    })),
    manualAssets: manual.map(({ kind, name, ...m }) => ({
      kind,
      name,
      value: round(currentValue(m)),
      ...(m.ownershipPercent !== null && { ownershipPercent: m.ownershipPercent }),
    })),
    insuranceTotals: insuranceTotals(policies, today),
    ...(equity.grants.length > 0 && {
      unvestedEquity: {
        grants: equity.grants.length,
        grossValue: round(equity.totalUnvestedGross),
        netValue: round(equity.totalUnvestedNet),
        nextVestDate: equity.nextVest?.vestDate ?? null,
      },
    }),
    openAlertsCount: openAlertsRow?.n ?? 0,
  };
}

function downsampleHistory<T extends { date: string }>(points: T[], granularity: 'monthly' | 'weekly' | 'daily'): T[] {
  if (granularity === 'daily' || points.length <= 2) return points;
  if (granularity === 'monthly') {
    const byMonth = new Map<string, T>();
    for (const p of points) byMonth.set(p.date.slice(0, 7), p);
    return [...byMonth.values()];
  }
  const out: T[] = [points[0]!];
  let lastKept = points[0]!.date;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    if (daysBetween(lastKept, p.date) >= 7) {
      out.push(p);
      lastKept = p.date;
    }
  }
  out.push(points.at(-1)!);
  return out;
}

export function createChatTools(db: Db): ChatTool[] {
  return [
    tool({
      name: 'get_financial_overview',
      description: 'Compact overview: profile, net worth, account summary, manual assets, insurance totals, and open alert count.',
      input: z.object({}),
      label: () => 'Checked financial overview',
      run: () => buildOverview(db),
    }),
    tool({
      name: 'get_accounts',
      description:
        'Visible linked and manual accounts with ids, type, subtype, balances, credit limits, and ownershipPercent (null = 100%). Credit/loan/mortgage balances are amounts owed.',
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
      description: 'Current net worth, totals by type, and 30d/90d/YTD/1y changes. Pass historyDays to include trend points.',
      input: z.object({
        historyDays: z.number().int().min(1).max(3650).optional().describe('Include historical points over N days'),
        granularity: z.enum(['monthly', 'weekly', 'daily']).default('monthly').describe('History point spacing'),
      }),
      label: () => 'Checked net worth',
      run: async ({ historyDays, granularity }) => {
        const today = localDate();
        const yearStart = `${Number(today.slice(0, 4)) - 1}-12-31`;
        const [current, d30, d90, ytd, y1, rawHistory] = await Promise.all([
          getNetWorth(db),
          getSnapshotAsOf(db, addDays(today, -30)),
          getSnapshotAsOf(db, addDays(today, -90)),
          getSnapshotAsOf(db, yearStart),
          getSnapshotAsOf(db, shiftYears(today, -1)),
          historyDays ? getNetWorthHistory(db, addDays(today, -historyDays)) : Promise.resolve(null),
        ]);
        const delta = (s: Awaited<ReturnType<typeof getSnapshotAsOf>>) =>
          s ? { since: s.date, netWorth: s.netWorth, delta: round2(current.netWorth - s.netWorth) } : null;
        return {
          asOf: today,
          current,
          changes: { d30: delta(d30), d90: delta(d90), ytd: delta(ytd), y1: delta(y1) },
          ...(rawHistory ? { history: downsampleHistory(rawHistory, granularity) } : {}),
        };
      },
    }),
    tool({
      name: 'search_transactions',
      description: 'Search bank and card transactions (positive = out, negative = in), newest first. Use spending tools for totals.',
      input: z.object({
        search: z.string().optional().describe('Merchant or description text'),
        category: z.string().optional().describe('Exact category from list_categories'),
        accountId: z.uuid().optional(),
        ...dateRange,
        limit: z.number().int().min(1).max(200).default(25),
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
      description: 'Net spending totals by merchant over a date range (positive = net out), largest first, at user ownership share.',
      input: z.object({
        ...dateRange,
        category: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      label: () => 'Totaled spending by merchant',
      run: ({ limit, ...q }) => totalsByMerchant(db, q, limit),
    }),
    tool({
      name: 'list_categories',
      description: 'Transaction categories in use.',
      input: z.object({}),
      label: () => 'Listed spending categories',
      run: () => listCategories(db),
    }),
    tool({
      name: 'get_spending_by_category',
      description: 'Spending by category for one month (YYYY-MM), excluding transfers and card payments.',
      input: z.object({ month: Month.describe('YYYY-MM') }),
      label: ({ month }) => `Checked spending for ${month}`,
      run: ({ month }) => getSpendingByCategory(db, month),
    }),
    tool({
      name: 'get_cashflow',
      description: 'Monthly income, spending, and net cash flow for recent months (excludes transfers and card payments).',
      input: z.object({ months: z.number().int().min(1).max(24).default(6) }),
      label: ({ months }) => `Checked cash flow for ${months} months`,
      run: ({ months }) => getCashflow(db, months),
    }),
    tool({
      name: 'get_budgets',
      description: 'Monthly budget targets and spending by category for YYYY-MM.',
      input: z.object({ month: Month.describe('YYYY-MM') }),
      label: ({ month }) => `Checked budgets for ${month}`,
      run: ({ month }) => getBudgetStatus(db, month),
    }),
    tool({
      name: 'get_holdings',
      description:
        'Portfolio totals, look-through exposure (asset class/sector/region/bond type), account totals, and filtered holdings (ownership share).',
      input: z.object({
        accountId: z.uuid().optional().describe('Filter to one account'),
        taxTreatment: z.enum(['taxable', 'tax_deferred', 'tax_free']).optional(),
        ticker: z.string().optional().describe('Filter by ticker or fund name'),
        limit: z.number().int().min(1).max(200).default(25),
        includeHoldings: z.boolean().default(true).describe('False returns totals and exposure only'),
      }),
      label: () => 'Checked investment holdings',
      run: async ({ accountId, taxTreatment, ticker, limit, includeHoldings }) => {
        const summary = await getInvestmentsSummary(db, null);
        const e = lookThrough(summary.holdings);
        const dollars = (w: Partial<Record<string, number>>) =>
          Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v!)]));
        const needle = ticker?.trim().toLowerCase();
        const filtered = summary.holdings.filter((h) => {
          if (accountId && h.accountId !== accountId) return false;
          if (taxTreatment && h.taxTreatment !== taxTreatment) return false;
          if (needle && !h.ticker?.toLowerCase().includes(needle) && !h.name?.toLowerCase().includes(needle)) return false;
          return true;
        });
        const shown = includeHoldings ? filtered.slice(0, limit) : [];
        return {
          totalValue: summary.totalValue,
          totalHoldings: filtered.length,
          returnedHoldings: shown.length,
          byAccount: summary.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            subtype: a.subtype,
            taxTreatment: a.taxTreatment,
            value: a.value,
          })),
          exposure: {
            assetClasses: dollars(e.assetClasses),
            notLookedUp: Math.round(e.unclassified),
            stockSectors: dollars(e.sectors),
            stockRegions: dollars(e.regions),
            bondTypes: dollars(e.bondTypes),
          },
          holdings: shown.map((h) => ({
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
      name: 'get_loans_and_cards',
      description: 'Mortgage, loan, and credit card terms: balance, APR, minimum payment, due date, escrow, and payoff estimate.',
      input: z.object({}),
      label: () => 'Checked loans and cards',
      run: async () =>
        (await listLiabilities(db)).map((l) => ({
          ...l,
          payoffAtCurrentPayment: estimatePayoff(l.balance, l.interestRatePct, l.minimumPayment),
        })),
    }),
    tool({
      name: 'get_profile',
      description: 'User profile: birth year, filing status, state, dependents, children, income, occupation, employer benefits, and goals.',
      input: z.object({}),
      label: () => 'Checked your profile',
      run: () => getProfile(db),
    }),
    tool({
      name: 'get_investment_performance',
      description: 'Time-weighted investment returns and gains (1M, 3M, YTD, 1Y, all, calendar years), total and by account.',
      deferLoading: true,
      input: z.object({}),
      label: () => 'Checked investment performance',
      run: async () => {
        const { points: _points, ...performance } = await getInvestmentPerformance(db, undefined, undefined, { refresh: 'background' });
        return performance;
      },
    }),
    tool({
      name: 'get_investment_transactions',
      description: 'Investment buys, sells, dividends, contributions, and fees (up to 2 years), newest first.',
      deferLoading: true,
      input: z.object({
        accountId: z.uuid().optional(),
        ticker: z.string().optional(),
        type: z.string().optional().describe('buy, sell, cash, transfer, fee'),
        ...dateRange,
        limit: z.number().int().min(1).max(200).default(30),
      }),
      label: () => 'Checked investment activity',
      run: ({ accountId, ticker, type, from, to, limit }) => {
        const needle = ticker?.trim();
        return db
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
              accountId ? eq(investmentTransactions.accountId, accountId) : undefined,
              needle ? ilike(securities.tickerSymbol, `%${escapeLike(needle)}%`) : undefined,
              type ? eq(investmentTransactions.type, type) : undefined,
              from ? gte(investmentTransactions.date, from) : undefined,
              to ? lte(investmentTransactions.date, to) : undefined,
            ),
          )
          .orderBy(desc(investmentTransactions.date), asc(investmentTransactions.name))
          .limit(limit);
      },
    }),
    tool({
      name: 'get_cash_plan',
      description: 'Liquid cash positions, APYs, missed interest vs benchmark, and emergency fund runway.',
      deferLoading: true,
      input: z.object({ includeDetails: z.boolean().default(false).describe('Include full suggestion prose') }),
      label: () => 'Checked your cash and emergency fund',
      run: async ({ includeDetails }) => {
        const plan = await getCashPlan(db, undefined, undefined, { rateTimeoutMs: 800 });
        if (includeDetails) return plan;
        return {
          ...plan,
          suggestions: plan.suggestions.map(({ id, kind, title, impact }) => ({ id, kind, title, impact })),
        };
      },
    }),
    tool({
      name: 'get_recurring',
      description: 'Recurring subscriptions, bills, paychecks, autopay coverage health, upcoming 30-day payments, and open alerts.',
      deferLoading: true,
      input: z.object({
        includeStopped: z.boolean().default(false),
        includeIgnored: z.boolean().default(false),
        includeAutopayDetails: z.boolean().default(false),
      }),
      label: () => 'Checked recurring payments and alerts',
      run: async ({ includeStopped, includeIgnored, includeAutopayDetails }) => {
        const [summary, alertList] = await Promise.all([getRecurringSummary(db), listAlerts(db)]);
        return {
          ...summary,
          series: summary.series.filter(
            (s) => s.status === 'active' || (includeStopped && s.status === 'stopped') || (includeIgnored && s.status === 'ignored'),
          ),
          autopay: includeAutopayDetails
            ? summary.autopay
            : summary.autopay.map(({ before: _before, ...a }) => a),
          alerts: alertList.alerts
            .filter((a) => !a.dismissedAt && !a.resolvedAt)
            .map(({ href: _href, ...a }) => a),
        };
      },
    }),
    tool({
      name: 'get_tax_plan',
      description:
        'Estimated federal/state income tax, brackets, marginal rate, detected YTD income/gains, tax-loss harvest candidates, and year-end checklist.',
      deferLoading: true,
      input: z.object({
        year: z.number().int().min(2000).max(2100).optional().describe('Tax year; current year if omitted'),
        includeDetails: z.boolean().default(false).describe('Include bracket slices and full suggestion prose'),
      }),
      label: ({ year }) => `Checked your ${year ?? 'current'} tax estimate`,
      run: async ({ year, includeDetails }) => {
        const plan = await getTaxPlan(db, year ?? Number(localDate().slice(0, 4)));
        if (includeDetails) return plan;
        const federal = plan.federal ? (({ brackets: _b, ...rest }) => rest)(plan.federal) : null;
        return {
          ...plan,
          federal,
          suggestions: plan.suggestions.map(({ id, kind, title, impact }) => ({ id, kind, title, impact })),
          checklist: plan.checklist.map(({ id, due, dueLabel, title, impact, general, done }) => ({
            id,
            due,
            dueLabel,
            title,
            impact,
            general,
            done,
          })),
        };
      },
    }),
    tool({
      name: 'get_retirement_plan',
      description:
        'Retirement projection (today’s dollars): assumptions, accounts, property sales, spendingChanges, Social Security, gap, and optional Monte Carlo. Pass overrides for what-ifs.',
      deferLoading: true,
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
        .extend({
          includeMonteCarlo: z.boolean().default(false).describe('Run Monte Carlo simulation'),
        })
        .describe('Optional what-if overrides and simulation flag'),
      label: (input) => {
        const { includeMonteCarlo: _mc, ...overrides } = input;
        return Object.values(overrides).some((v) => v !== undefined) ? 'Ran a retirement what-if' : 'Checked your retirement plan';
      },
      run: async ({ includeMonteCarlo, ...overrides }) => {
        const summary = await getRetirement(db);
        const whatIf = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null));
        const plan = { ...summary.plan, ...whatIf };
        const resolved = resolvePlan(plan, summary);
        if (!resolved.inputs) return { missing: resolved.missing, accounts: summary.accounts };
        const projection = projectRetirement(resolved.inputs);
        const simulation = includeMonteCarlo ? simulateRetirement(resolved.inputs, SIMULATION_DEFAULTS) : null;
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
          ...(simulation
            ? {
                monteCarlo: {
                  trials: SIMULATION_DEFAULTS.trials,
                  volatility: SIMULATION_DEFAULTS.volatility,
                  successRate: Math.round(simulation.successRate * 1000) / 1000,
                  atRetirement: { p10: simulation.atRetirement.p10, p50: simulation.atRetirement.p50, p90: simulation.atRetirement.p90 },
                  medianDepletionAge: simulation.medianDepletionAge,
                },
              }
            : {}),
          projection: {
            ...projection,
            // Every five years keeps the result short; the last point shows what's left at the end.
            points: projection.points.filter((p, i, all) => i % 5 === 0 || i === all.length - 1),
          },
        };
      },
    }),
    tool({
      name: 'get_insurance_policies',
      description: 'Life and disability insurance policies and totals (life = death benefit; disability = monthly benefit).',
      deferLoading: true,
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
      description: 'Estate plan: transfer methods, beneficiaries, documents, readiness checks, and packet status.',
      deferLoading: true,
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
      name: 'get_equity_grants',
      description: 'RSU grants, vesting schedule, unvested gross/net totals, and YTD vests.',
      deferLoading: true,
      input: z.object({ includeVests: z.boolean().default(true) }),
      label: () => 'Checked RSU grants and vesting',
      run: async ({ includeVests }) => {
        const summary = await getEquitySummary(db, undefined, undefined, { refresh: 'background' });
        return {
          asOf: summary.asOf,
          totalUnvestedGross: summary.totalUnvestedGross,
          totalUnvestedNet: summary.totalUnvestedNet,
          next12MonthsGross: summary.next12MonthsGross,
          next12MonthsNet: summary.next12MonthsNet,
          ytdVestedGross: summary.ytdVestedGross,
          ytdVestedWithheld: summary.ytdVestedWithheld,
          remainingThisYearGross: summary.remainingThisYearGross,
          nextVest: summary.nextVest,
          byTicker: summary.byTicker,
          yearlyTimeline: summary.yearlyTimeline,
          grants: summary.grants.map(({ documentId: _d, documentFilename: _f, vests, ...g }) => ({
            ...g,
            ...(includeVests ? { vests } : {}),
          })),
        };
      },
    }),
    tool({
      name: 'get_meld_docs',
      description:
        'Look up Meld feature guides: screens, calculations, settings, Plaid, phone access, Docker, AI models, MCP, privacy, security.',
      deferLoading: true,
      input: z.object({
        query: z.string().trim().min(1).max(200).optional().describe('Keywords to search across Meld guides'),
        topic: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .describe('Section id (e.g. features#plan-estate) or guide slug (plaid, phone-access, docker, privacy, security)'),
        limit: z.number().int().min(1).max(5).default(3).describe('Max sections to return'),
      }),
      label: (input) => formatDocsToolLabel(input),
      run: async (input) => lookupMeldDocs(input),
    }),
  ];
}
