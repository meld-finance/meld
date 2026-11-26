import { insuranceTotals, netCashValue } from '@meld/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, alerts, equityGrants, insurancePolicies, manualAssets } from '../db/schema';
import { computeNetWorth, localDate } from '../lib/networth';
import { getProfile } from '../services/profile';
import { maskNumbers } from './chat-tools';

/** Stable across sessions so it can be cached; per-session data goes in the snapshot. */
export const SYSTEM_PROMPT = `You are the financial analyst inside Meld, a private app that brings together one person's bank accounts, cards, investments, loans, insurance and budget. You're talking with that person about their own money.

How to work:
- Base answers on their actual data. Only a tiny summary snapshot is below; call the read-only tools (and tool search when specialist planning tools like tax, retirement, estate, cash, recurring, or insurance are deferred) for exact balances, transactions, holdings, loan terms, and plans. Don't guess numbers you can look up.
- Help with Meld itself too: when asked how a feature or calculation works, where to find a screen or setting, or how to set up Plaid, phone access, Docker, AI models, MCP, privacy, or security, call \`get_meld_docs\` (via tool search if deferred) instead of guessing UI paths or behavior. Remember you are read-only—walk the user through the steps to take in Meld.
- Show the numbers behind a conclusion and state your assumptions (tax year, growth or interest rates, income). Keep math simple enough to follow.
- When data needed for a good answer is missing, say what's missing and how it changes the answer (for example: no disability coverage on file, no profile income, an account not linked). Suggest adding it in Meld (Profile, Insurance, Retirement, or Accounts).
- Give specific, practical options with trade-offs, ordered by impact. Recommendations are welcome; be clear about what depends on facts you don't have.
- Tax rules, contribution limits and brackets change yearly. Say which year's figures you're using and flag any you aren't sure are current.
- You are not a licensed financial advisor, tax professional or attorney. Don't add a disclaimer to every answer; mention it once when advice is high-stakes or depends on personal circumstances (complex tax situations, estate planning, buying or cancelling insurance), and suggest a professional where that's worth the cost.

Data conventions:
- Transaction amounts: positive = money out, negative = money in.
- Balances on credit, loan and mortgage accounts are amounts owed.
- Disability insurance coverage amounts are monthly benefits; life insurance amounts are death benefits.
- Net worth includes whole/universal life insurance at its cash surrender value (byType 'insurance'), not the death benefit. Policy loans are already netted out of it.
- Unvested RSUs are NOT included in net worth; call get_equity_grants for vesting schedules and estimated gross/net values.
- Cash flow and spending exclude transfers between the person's own accounts and credit card payments.
- Retirement projections are in today's dollars: returns are after inflation, and spending, contributions and Social Security are today's amounts.
- Account and policy numbers are masked; never ask for full numbers.

Formatting: the app renders a small Markdown subset: paragraphs, **bold**, *italic*, \`code\`, bullet and numbered lists, ### headings, and simple tables. Lead with the answer, then the supporting detail. Be concise; use a table when comparing options or listing several figures.`;

const round = (n: number) => Math.round(n);

/**
 * A tiny orientation header captured when a chat session starts (~150-200 tokens).
 * Kept compact and fixed for the session so prompts stay fast and cacheable; tools supply detail.
 */
export async function buildSnapshot(db: Db, today = localDate(), page?: string): Promise<string> {
  const [profile, accountRows, manualRows, policyRows, [openAlertsRow], [equityGrantsRow]] = await Promise.all([
    getProfile(db),
    db
      .select({
        type: accounts.type,
        currentBalance: accounts.currentBalance,
        ownershipPercent: accounts.ownershipPercent,
      })
      .from(accounts)
      .where(eq(accounts.hidden, false)),
    db
      .select({
        value: manualAssets.value,
        valueAsOf: manualAssets.valueAsOf,
        depreciationPercent: manualAssets.depreciationPercent,
        ownershipPercent: manualAssets.ownershipPercent,
      })
      .from(manualAssets),
    db
      .select({
        type: insurancePolicies.type,
        termEndDate: insurancePolicies.termEndDate,
        coverageAmount: insurancePolicies.coverageAmount,
        premiumAmount: insurancePolicies.premiumAmount,
        premiumFrequency: insurancePolicies.premiumFrequency,
        cashValue: insurancePolicies.cashValue,
        cashSurrenderValue: insurancePolicies.cashSurrenderValue,
        loanBalance: insurancePolicies.loanBalance,
      })
      .from(insurancePolicies),
    db.select({ n: count() }).from(alerts).where(and(isNull(alerts.dismissedAt), isNull(alerts.resolvedAt))),
    db.select({ n: count() }).from(equityGrants),
  ]);

  const cashValues = policyRows.flatMap((p) => {
    const v = netCashValue(p);
    return v === null ? [] : [v];
  });
  const netWorth = computeNetWorth(accountRows, manualRows, cashValues);

  const compactProfile: Record<string, unknown> = {};
  if (profile.birthYear !== null) compactProfile.birthYear = profile.birthYear;
  if (profile.filingStatus !== null) compactProfile.filingStatus = profile.filingStatus;
  if (profile.state !== null) compactProfile.state = profile.state;
  if (profile.dependents !== null) compactProfile.dependents = profile.dependents;
  if (profile.children.length) compactProfile.childrenCount = profile.children.length;
  if (profile.annualGrossIncome !== null) compactProfile.annualGrossIncome = profile.annualGrossIncome;

  const snapshot = {
    asOf: today,
    ...(page ? { page } : {}),
    profile: compactProfile,
    netWorth: {
      assets: round(netWorth.assets),
      liabilities: round(netWorth.liabilities),
      netWorth: round(netWorth.netWorth),
      byType: netWorth.byType.map((t) => ({ ...t, total: round(t.total) })),
    },
    counts: {
      accounts: accountRows.length,
      manualAssets: manualRows.length,
      insurancePolicies: policyRows.length,
      equityGrants: equityGrantsRow?.n ?? 0,
      openAlerts: openAlertsRow?.n ?? 0,
    },
    insuranceTotals: insuranceTotals(policyRows, today),
  };
  return `Snapshot of the person's finances as of ${today} (summary only; use tools for account, transaction, holding, and plan detail):\n${JSON.stringify(maskNumbers(snapshot))}`;
}
