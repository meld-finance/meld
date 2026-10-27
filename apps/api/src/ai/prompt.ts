import { hasCashValue, insuranceTotals, netCashValue } from '@meld/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts, manualAssets } from '../db/schema';
import { localDate } from '../lib/networth';
import { listAccounts } from '../services/accounts';
import { listPolicies } from '../services/insurance';
import { getNetWorth } from '../services/overview';
import { getProfile } from '../services/profile';
import { maskNumbers } from './chat-tools';

/** Stable across sessions so it can be cached; per-session data goes in the snapshot. */
export const SYSTEM_PROMPT = `You are the financial analyst inside Meld, a private app that brings together one person's bank accounts, cards, investments, loans, insurance and budget. You're talking with that person about their own money.

How to work:
- Base answers on their actual data. A snapshot is below; use the tools for detail (transactions, holdings, loan terms, policies) and for anything that may have changed. Don't guess numbers you can look up.
- Show the numbers behind a conclusion and state your assumptions (tax year, growth or interest rates, income). Keep math simple enough to follow.
- When data needed for a good answer is missing, say what's missing and how it changes the answer (for example: no disability coverage on file, no profile income, an account not linked). Suggest adding it in Meld (Profile, Insurance, or Accounts).
- Give specific, practical options with trade-offs, ordered by impact. Recommendations are welcome; be clear about what depends on facts you don't have.
- Tax rules, contribution limits and brackets change yearly. Say which year's figures you're using and flag any you aren't sure are current.
- You are not a licensed financial advisor, tax professional or attorney. Don't add a disclaimer to every answer; mention it once when advice is high-stakes or depends on personal circumstances (complex tax situations, estate planning, buying or cancelling insurance), and suggest a professional where that's worth the cost.

Data conventions:
- Transaction amounts: positive = money out, negative = money in.
- Balances on credit, loan and mortgage accounts are amounts owed.
- Disability insurance coverage amounts are monthly benefits; life insurance amounts are death benefits.
- Net worth includes whole/universal life insurance at its cash surrender value (byType 'insurance'), not the death benefit. Policy loans are already netted out of it.
- Cash flow and spending exclude transfers between the person's own accounts and credit card payments.
- Account and policy numbers are masked; never ask for full numbers.

Formatting: the app renders a small Markdown subset: paragraphs, **bold**, *italic*, \`code\`, bullet and numbered lists, ### headings, and simple tables. Lead with the answer, then the supporting detail. Be concise; use a table when comparing options or listing several figures.`;

const round = (n: number | null) => (n === null ? null : Math.round(n));

/**
 * A compact picture of the person's finances, captured when a chat session starts.
 * Kept fixed for the session so the prompt prefix stays cacheable; tools supply fresh detail.
 */
export async function buildSnapshot(db: Db, today = localDate()): Promise<string> {
  const [profile, netWorth, accountList, manual, policies] = await Promise.all([
    getProfile(db),
    getNetWorth(db),
    listAccounts(db, eq(accounts.hidden, false)),
    db.select({ kind: manualAssets.kind, name: manualAssets.name, value: manualAssets.value }).from(manualAssets),
    listPolicies(db),
  ]);
  const snapshot = {
    asOf: today,
    profile,
    netWorth: { ...netWorth, byType: netWorth.byType.map((t) => ({ ...t, total: round(t.total) })) },
    accounts: accountList.map((a) => ({
      name: a.name,
      institution: a.institutionName,
      type: a.type,
      subtype: a.subtype,
      balance: round(a.currentBalance),
    })),
    manualAssets: manual.map((m) => ({ ...m, value: round(m.value) })),
    insurance: {
      totals: insuranceTotals(policies, today),
      policies: policies.map((p) => ({
        type: p.type,
        carrier: p.carrier,
        coverage: p.coverageAmount,
        employerProvided: p.employerProvided,
        ...(hasCashValue(p.type) && { surrenderValue: round(netCashValue(p)), valuesAsOf: p.valuesAsOf }),
      })),
    },
  };
  return `Snapshot of the person's finances as of ${today} (balances rounded; use tools for exact and current figures):\n${JSON.stringify(maskNumbers(snapshot))}`;
}
