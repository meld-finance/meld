[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [Features](../features.md)

# Tax

Get a simple ballpark estimate of this year's (or last year's) US federal and state income tax across all 50 US states and DC, see where you land in the brackets, and review common year-end planning checks.

![Tax plan with rates and suggestions](../images/features/tax.png)

## Where to find it

- **Plan → Tax**
- Household income, filing status, and optional US state under **Plan → Profile**
- Per-year overrides in **Tax inputs** on the Tax page

## The estimate

**Plan → Tax** gives a simple ballpark estimate of this year's (or last year's) US federal and state income tax: effective and marginal rates, where your income lands in the brackets, and what you're on track to owe or get back. It is built for straightforward US W-2 and investment situations—it's a simple estimate, not tax advice and not a return.

If you set your US state under **Plan → Profile**, Meld estimates state tax for all 50 states and DC using built-in 2025/2026 state rules (no-income-tax states, flat-rate states, or progressive brackets). State is optional; leave it unset for federal only.

## Income and gains

**Income** starts from your profile's household gross income (yours plus your partner's when filing jointly, or your own when filing separately) and filing status. Tracked RSU vests for the year (vested YTD plus remaining scheduled tranches) are added as their own `RSU vesting` line item, with a toggle in Tax inputs if your Profile figure already includes RSUs. Pre-tax 401(k) deferrals and HSA contributions are projected from what your 401(k) and HSA accounts report. Dividends, interest and fund distributions come from taxable accounts and bank interest. The year is projected as this year so far plus whatever came in over the rest of last year, so December distributions count. A dividend's qualified share comes from what the fund holds: its stocks, apart from REITs.

**Realized gains** are rebuilt from buys and sells with average cost, because Plaid reports one cost basis per holding and no lots. Holding periods follow shares in the order they were bought. Enter your broker's figures to replace the estimate.

## Tax inputs

**Tax inputs** (per year, in `tax_settings`) cover what Meld can't see:

- self-employment profit
- other income
- withholding and estimated payments
- property tax and other itemized deductions
- HSA coverage
- whether you have a workplace plan
- a custom state & local rate (%) override (for example, to include NYC, county, or municipal income taxes on top of your state rate)

## Tables

- **Federal:** Brackets, standard deductions, capital gains rates, NIIT, additional Medicare and self-employment tax, the SALT cap and the child tax credit for 2025 and 2026, plus contribution limits and Roth/IRA phase-outs (2025 figures include One Big Beautiful Bill changes).
- **All 50 US states + DC (2025 & 2026):** 9 no-income-tax states, 15 flat-rate states, and 27 progressive jurisdictions (26 states + DC), with state standard deductions, personal/dependent exemptions or credits, CA and NJ HSA add-backs, and CA/MA high-earner surtaxes.
- Tables live in `packages/shared/src/tax-tables.ts`; add future years there when published.

## What's not covered

Treat Meld's figures as rough estimates rather than tax advice. Meld does **not** model complex tax situations, including:

- **Pass-through & business filings:** K-1s (partnerships, S-corps, trusts), Schedule C business expenses, QBI (§199A), and rental depreciation or passive loss rules.
- **Complex investments & equity:** REIT §199A or return-of-capital splits, AMT, ISOs / ESPP dispositions, prior-year capital loss carryforwards, and specific broker tax lots.
- **Local & specialized state rules:** City and county income taxes (NYC, Maryland counties, PA/OH/IN locals—use **Custom state & local rate (%)** to approximate them), multi-state returns, state-specific credits/deductions, and Washington's capital gains tax.
- **Non-US tax systems:** US federal and state income taxes only.

If any of these apply to your return, use dedicated tax software or a CPA.

## Common planning checks

**Common planning checks** are simple rules for common W-2 and investment situations, each with an approximate tax impact—not personalized tax advice. They cover:

- tax-loss harvesting, with wash-sale warnings for purchases or RSU vests within 30 days in any account
- RSU supplemental withholding gaps and $0 cost-basis checks on vested RSU holdings
- gain harvesting at 0%
- 401(k)/403(b)/TSP room (counting both pre-tax and Roth workplace deferrals toward the shared employee cap), separate governmental 457(b) room (which stacks on top of your 401(k)/403(b) limit), HSA, and IRA room
- a backdoor Roth, with a pro-rata warning when pre-tax IRAs have money in them
- a SEP IRA or solo 401(k) for self-employment income
- Roth conversion room in low brackets
- Required Minimum Distribution (RMD) reminders using SECURE 2.0 start ages (73 for birth years 1951–1959, 75 for 1960+) and the IRS Uniform Lifetime Table across both IRAs and workplace pre-tax accounts
- an underpayment warning

Tap one to ask Ask Meld about it.
