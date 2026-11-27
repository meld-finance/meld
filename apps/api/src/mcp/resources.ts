import type { Db } from '../db/client';
import { buildOverview, maskNumbers } from '../ai/chat-tools';

export type McpResourceDef = {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
};

export const MCP_RESOURCES: McpResourceDef[] = [
  {
    uri: 'meld://overview',
    name: 'overview',
    title: 'Financial overview',
    description: 'Live compact overview: profile, net worth, visible accounts, manual assets, insurance totals, and open alert count.',
    mimeType: 'application/json',
  },
  {
    uri: 'meld://conventions',
    name: 'conventions',
    title: 'Meld data conventions',
    description: 'Sign conventions, ownership percentages, cash flow exclusions, masking, and scope rules across all Meld tools.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'meld://docs/retirement',
    name: 'retirement-docs',
    title: 'Retirement plan schema & rules',
    description: 'Detailed semantics for get_retirement_plan inputs and outputs (life events, property sales, Social Security, Monte Carlo).',
    mimeType: 'text/markdown',
  },
  {
    uri: 'meld://docs/tax',
    name: 'tax-docs',
    title: 'Tax plan schema & rules',
    description: 'Detailed semantics for get_tax_plan (detected YTD income, average-cost realized gains, harvest wash-sale checks, checklist).',
    mimeType: 'text/markdown',
  },
  {
    uri: 'meld://docs/recurring',
    name: 'recurring-docs',
    title: 'Recurring, autopay & alerts guide',
    description: 'Detailed semantics for get_recurring (series statuses, autopay coverage health, upcoming obligations, open alerts).',
    mimeType: 'text/markdown',
  },
];

const STATIC_RESOURCES: Record<string, { mimeType: string; text: string }> = {
  'meld://conventions': {
    mimeType: 'text/markdown',
    text: `# Meld Data Conventions

- **Read-only access**: Every Meld MCP tool is read-only. Changes (profile, budgets, categories, autopay, retirement assumptions) are made in the Meld app.
- **Transaction signs**: Positive = money out (purchases, payments, fees). Negative = money in (income, refunds).
- **Debt balances**: Credit card, loan, and mortgage balances are positive amounts owed.
- **Joint ownership**: \`get_accounts\` returns full account \`currentBalance\` plus \`ownershipPercent\` (null = 100%). Net worth, cash flow, spending, budgets, holdings, performance, cash plan, and taxes count only the user's ownership share.
- **Cash flow & spending**: Count checking/savings/card accounts only and exclude transfers between the user's own accounts and credit card payments.
- **Insurance**: Life policy coverage is the death benefit; disability coverage is the monthly benefit. Permanent life policies count toward net worth at cash surrender value (policy loans already netted out).
- **RSUs & vesting**: Unvested RSUs are excluded from net worth and portfolio totals until vested; use \`get_equity_grants\` for vesting schedules and estimated gross/net values.
- **Retirement projections**: Amounts and after-inflation returns are in today's dollars.
- **Privacy & masking**: Runs of 9+ digits are masked to \`••••1234\`. Hidden accounts, full account/policy numbers, estate contact details, and uploaded PDFs are never exposed.
- **US scope & educational disclaimer**: Meld is built for US personal finances (USD, US accounts via Plaid, IRS/state tax rules, 401(k)/IRA/HSA, Social Security). Outputs and estimates are educational, not licensed financial, tax, or legal advice.`,
  },
  'meld://docs/retirement': {
    mimeType: 'text/markdown',
    text: `# Retirement Plan Guide (\`get_retirement_plan\`)

- **Today's dollars**: Expected returns are real (after inflation). Spending, contributions, Social Security, and pensions are today's dollars.
- **Partners & staggered retirement**: When a partner (with birth year) is on the profile, Meld tracks separate retirement ages, plan-to ages (projecting to whichever horizon reaches further out), contributions, Social Security, and pensions. If one partner retires earlier, **bridge years** occur between \`firstRetireAge\` and \`fullRetireAge\`: the still-working partner's estimated after-tax income (plus any active Social Security, pension, or net rent) covers household spending first, shortfalls draw from savings, and surpluses save up to the working partner's planned contribution.
- **Social Security & spousal top-up**: With a partner, each person's benefit is estimated from their own income and stop-work age (or overridden individually) and claimed at their own \`socialSecurityAge\` / \`partnerSocialSecurityAge\`. When married and no statement figure is entered for the lower earner, Meld adds a spousal top-up up to 50% of the higher earner's FRA benefit (with no delayed credits past FRA on the spousal top-up).
- **Accounts**: Includes visible investment accounts except education/custodial accounts (529, Coverdell, UTMA/UGMA) and user-excluded accounts.
- **Property sales (\`assumptions.sales\`)**: Each home opted in from Accounts shows \`sellAge\`, net proceeds after appreciation, selling costs, and remaining mortgage, plus \`netRentAnnual\` until sale.
- **Life events (\`spendingChanges\`)**:
  - \`kind: 'spending'\`: adjusts yearly spending in retirement (does not affect working years before \`firstRetireAge\`).
  - \`kind: 'income'\`: extra income (e.g. part-time work); covers retirement/bridge spending and adds to savings when working.
  - \`kind: 'saving'\`: changes yearly contribution before \`fullRetireAge\` (ignored in shortfall bridge years).
  - \`kind: 'once'\`: one-time inflow (+) or outflow (-) at \`startAge\` (\`endAge\` ignored).
  - Yearly events run for \`startAge <= age < endAge\` (\`endAge: null\` means ongoing). When \`childId\` is set to a child's id or \`'partner'\`, ages are that child's or partner's age. \`annualChange\` is always yearly even when \`monthly: true\`.
  - Passing \`spendingChanges\` in a what-if replaces the saved list.
- **Gap & Monte Carlo**: \`needed\` is target balance at \`firstRetireAge\`; \`gap = needed - projected\` (<= 0 means on track). Pass \`includeMonteCarlo: true\` to run randomized lognormal return trials (\`successRate\`, \`p10\`/\`p50\`/\`p90\`).
- **Levers (\`levers\`)**: Single-change adjustments toward the goal (\`base\` when Monte Carlo is off, or \`targetConfidence\`, defaulting to \`0.8\` when \`includeMonteCarlo: true\`): shortfall moves (\`saving\`, \`retirementAge\`, \`spending\`, \`socialSecurity\`) and over-prepared cushion (\`spending\` more, \`retirementAge\` earlier, \`saving\` less down to \`0\`, \`longevity\` \`maxAge\`).`,
  },
  'meld://docs/tax': {
    mimeType: 'text/markdown',
    text: `# Tax Plan Guide (\`get_tax_plan\`)

- **Simple US estimate only**: Combines profile income/filing status/state (covering federal plus all 50 US states and DC for 2025/2026, or a custom state/local rate override), \`tax_settings\` overrides, and synced account activity for straightforward W-2 and investment situations. Not tax advice and not a return.
- **Not covered**: K-1s (partnerships, S-corps, trusts), Schedule C business expenses and QBI (§199A), REIT §199A/return-of-capital splits, rental depreciation/passive losses, AMT/ISOs/ESPP dispositions, local/city income taxes (use the custom rate override), multi-state returns, state-specific credits/deductions, Washington's capital gains tax, prior-year loss carryforwards, and non-US tax systems.
- **\`detected\`**: YTD paychecks, contractor deposits, taxable-account dividends/interest, average-cost realized gains (\`realizedRough: true\` means incomplete history), retirement/HSA contributions, pre-tax IRA balances (relevant for backdoor Roth pro-rata rule), and RSU vest income/withholding gap.
- **\`harvest\`**: Taxable holdings with unrealized losses; \`recentPurchase\`, \`recentVest\`, and \`upcomingVest\` flag buys or RSU vests within 30 days (wash-sale risk).
- **\`checklist\`**: Upcoming deadlines (last trading day for harvesting, last paycheck for 401(k), Jan 15 for Q4 estimate, Apr 15 for IRA/HSA/SEP, Dec 31 for charity/FSA/RMD). Pass \`includeDetails: true\` for full bracket slices and explanatory prose.`,
  },
  'meld://docs/recurring': {
    mimeType: 'text/markdown',
    text: `# Recurring, Autopay & Alerts Guide (\`get_recurring\`)

- **\`series\`**: Subscriptions, bills, and income detected from up to 2 years of checking/card transactions. Default excludes \`stopped\` and \`ignored\` series; pass \`includeStopped: true\` or \`includeIgnored: true\` to see them.
- **\`autopay\`**: Credit cards and loans linked to a funding bank account, with next \`dueDate\`, \`amount\` (\`amountSource\`: statement, minimum, fixed, scheduled, or estimate), \`projectedAfter\`, and \`health\` (\`covered\`, \`tight\`, \`short\`, \`paid\`, \`unknown\`). Pass \`includeAutopayDetails: true\` to include \`before\` obligations.
- **\`upcoming\`**: Next 30 days of scheduled charges, autopay payments, and paychecks.
- **\`alerts\`**: Active (non-dismissed, non-resolved) alerts.`,
  },
};

export async function readMcpResource(db: Db, uri: string): Promise<{ uri: string; mimeType: string; text: string } | null> {
  if (uri === 'meld://overview') {
    const overview = maskNumbers(await buildOverview(db));
    return { uri, mimeType: 'application/json', text: JSON.stringify(overview, null, 2) };
  }
  const doc = STATIC_RESOURCES[uri];
  return doc ? { uri, ...doc } : null;
}

export type McpPromptDef = {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
};

export const MCP_PROMPTS: McpPromptDef[] = [
  {
    name: 'financial-checkup',
    description: 'Holistic review of net worth, cash runway, debt, investments, insurance, and top next moves.',
  },
  {
    name: 'spending-review',
    description: 'Analyze monthly cash flow, top spending categories/merchants, budgets, and recurring subscriptions.',
    arguments: [{ name: 'month', description: 'Month in YYYY-MM format (defaults to current month)', required: false }],
  },
  {
    name: 'tax-plan-review',
    description: 'Review estimated federal/state tax, marginal rate, remaining tax-advantaged room, and loss harvesting.',
    arguments: [{ name: 'year', description: 'Four-digit tax year (defaults to current year)', required: false }],
  },
  {
    name: 'retirement-checkup',
    description: 'Check retirement readiness, savings gap, Social Security timing, and Monte Carlo success odds.',
  },
];

export function renderMcpPrompt(name: string, args: Record<string, string> = {}) {
  switch (name) {
    case 'financial-checkup':
      return {
        description: 'Holistic financial checkup using Meld data',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: 'Do a concise financial checkup using Meld. Start with `get_financial_overview`, then check `get_cashflow`, `get_cash_plan`, `get_loans_and_cards`, `get_holdings` (totals/exposure), and `get_insurance_policies` as needed. Highlight strengths, missing data, risks, and the highest-impact next steps.',
            },
          },
        ],
      };
    case 'spending-review': {
      const monthNote = args.month ? ` for ${args.month}` : ' for the current month and recent 6 months';
      return {
        description: 'Monthly spending, budget, and subscription review',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review my cash flow, spending, budgets, and recurring bills${monthNote}. Call \`get_cashflow\`, \`get_spending_by_category\`, \`get_budgets\`, \`spending_by_merchant\`, and \`get_recurring\`. Summarize where money went, budget status, any price increases or unusual charges, and practical ways to save.`,
            },
          },
        ],
      };
    }
    case 'tax-plan-review': {
      const yearNote = args.year ? ` for tax year ${args.year}` : '';
      return {
        description: 'Tax estimate and year-end optimization review',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review my tax situation${yearNote} using \`get_tax_plan\` (and \`get_profile\` if needed). Show projected income, federal/state tax, effective vs marginal rate, balance due/withholding status, tax-loss harvesting candidates (noting wash-sale flags), and prioritized actions with estimated savings.`,
            },
          },
        ],
      };
    }
    case 'retirement-checkup':
      return {
        description: 'Retirement readiness and what-if checkup',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: 'Evaluate my retirement readiness using `get_retirement_plan` with `includeMonteCarlo: true` (and `get_holdings` if portfolio allocation matters). Summarize my projected vs needed balance, gap or surplus, Monte Carlo success rate, key assumptions, and what-if levers (retirement age, savings rate, Social Security timing).',
            },
          },
        ],
      };
    default:
      return null;
  }
}
