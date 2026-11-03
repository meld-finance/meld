# Meld

Your whole financial picture in one place — bank accounts, cards, brokerages, mortgages and loans (via Plaid), plus life and disability insurance — with an AI assistant that answers questions, makes recommendations and suggests tax strategies using that data as context.

**Private by design: it runs on your own computer.** There is no Meld cloud and no account to create; your data stays in a database on your machine. See [PRIVACY.md](PRIVACY.md) for exactly what goes where.

Web first, then iOS and Android from the same Expo codebase.

## Quick start (Docker)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and a free [Plaid](https://dashboard.plaid.com/signup) account. An [Anthropic API key](https://console.anthropic.com/) or [Ollama](https://ollama.com) is optional and turns on the AI features.

```sh
git clone <this repo> meld && cd meld
./scripts/setup.sh            # creates .env with fresh secrets and asks for a login passphrase
# add your Plaid keys (and optionally ANTHROPIC_API_KEY) to .env
docker compose up -d --build
```

Open http://localhost:8080 and unlock with your passphrase. Start with Plaid's Sandbox to look around, then follow [docs/plaid.md](docs/plaid.md) to connect your real accounts (free for up to 10 bank and brokerage logins).

- **Update:** `git pull && docker compose up -d --build`. Database migrations run automatically.
- **Stop:** `docker compose down`. Your data stays in Docker volumes (`meld-db`, `meld-documents`); `docker compose down -v` deletes it.
- **Back up:** `docker compose exec db pg_dump -U meld meld > meld-backup.sql`, and keep `.env` somewhere safe too: without its `ENCRYPTION_KEY` you'd have to re-link your accounts.
- **Change settings:** edit `.env`, then `docker compose up -d`.

### Reaching Meld from other devices

Meld only listens on `localhost`, and its login is a single passphrase, so don't open it to the internet. To use it from your phone or another computer, put both on a private network such as [Tailscale](https://tailscale.com) and use `tailscale serve 8080` on the machine running Meld, which adds HTTPS and keeps it off the public internet.

## Development setup

```
apps/api        Fastify + TypeScript API: Plaid, AI, data (Postgres via Drizzle)
apps/mobile     Expo (expo-router) app → web, iOS, Android
packages/shared Zod schemas + types shared by app and API
```

You need Node 22+ and npm, plus Docker for Postgres.

```sh
npm install
./scripts/setup.sh            # or: cp .env.example .env and fill it in by hand
npm run db:up                 # start only Postgres in Docker (localhost only)
docker compose exec db createdb -U meld meld_test       # once: the test database
npm run db:migrate            # apply migrations to both databases
npm run dev                   # API on :4000, Expo web on :8081
```

Open http://localhost:8081 and unlock with `APP_PASSPHRASE`.

If your Postgres volume predates `docker/initdb`, create the sandbox database once with `docker compose exec db createdb -U meld meld_sandbox`.

## Linking accounts (Plaid)

Use **Accounts → Link account** in the web app. Accounts and balances sync immediately; transaction history (up to 2 years) arrives over the next minute or so and is fetched automatically. Every linked connection also re-syncs every 6 hours while the API is running, or on demand with **Refresh**.

- **Sandbox** (`PLAID_ENV=sandbox`): pick any institution and sign in with `user_good` / `pass_good`.
- **Real accounts** (`PLAID_ENV=production`): needs Plaid production access; the free Trial plan covers up to 10 logins (see [docs/plaid.md](docs/plaid.md)). Set `PLAID_PRODUCTION_SECRET`. Each environment has its own secret and its own database (`SANDBOX_DATABASE_URL`, `PRODUCTION_DATABASE_URL`), so sandbox data never mixes with real data. Switching is just `PLAID_ENV` plus an API restart.
- If a bank needs you to sign in again, the connection shows **Reconnect**, which reopens Plaid Link in update mode.
- Linking on iOS/Android arrives with the mobile phase; use the web app until then.

## Overview & budgets

The app has five tabs: **Home**, **Ask Meld**, **Accounts** (sub-tabs Accounts, Cash and Investments), **Spending** (Overview, Transactions, Budgets) and **Plan** (Retirement, Insurance, Profile).


- **Net worth** = linked balances + manual assets (home, vehicles; add them on the Accounts tab) + life insurance cash surrender value − credit, loan and mortgage balances. Meld records one snapshot per day (after each sync and every 6 hours), so the trend line starts after the second day.
- **Cash flow** counts cash and credit card accounts only. Transfers between your accounts and credit card payments are excluded, so card purchases aren't double counted. Income is anything categorized `INCOME`; spending is everything else, net of refunds. Recategorize a transaction to change where it counts.
- **Drill into a category** by tapping it on **Spending → Overview** (Spending Breakdown, Top Movers, Where You Spend the Most): spending by subcategory and merchant against a year earlier, and the transactions behind it. Subcategories are Plaid's detailed categories (e.g. Groceries vs. Restaurants under Food and drink) unless you set your own.
- **Recategorize** by tapping any transaction: pick a category and subcategory, or type new ones. Turn on **Always categorize matching transactions this way** to create a rule: new transactions whose merchant or description contains the text you give are categorized as they sync, and optionally past matches you haven't changed by hand are updated too. The longest matching pattern wins, and a hand edit always overrides a rule. Manage rules from **Spending → Transactions → Rules**; deleting one puts its transactions back to their original category.
- **Budgets** are monthly targets per category, set under **Spending → Budgets**.

## Cash & emergency fund

- **Accounts → Cash** gathers liquid cash: checking, savings, money market and cash management accounts, money market funds, T-bill ETFs (SGOV, BIL…) and brokerage sweep cash. CDs, HSAs and cash in retirement accounts aren't counted toward the emergency fund.
- Each position's rate is estimated: bank accounts from interest paid in each of the last three complete months against that month's balance (months with no balance on record are skipped), compounded monthly into an APY, cash ETFs from a year of distributions (Yahoo Finance), and money market funds as roughly the 3-month Treasury yield (`^IRX`), which is also the "high-yield rate now" benchmark. Only tickers are sent. You can enter any rate yourself.
- The emergency fund target is a number of months (6 by default) of your average monthly spending over the last 12 complete months, or a monthly figure you enter. The page shows your runway in months and how far above or below the target you are.
- Rule-based nudges: move low-earning cash to a high-yield account (keeping a month of spending in checking), invest cash beyond the target, put idle cash in retirement accounts to work, and fill in missing rates. Positions can be set aside (e.g. for a down payment) so they don't count. Settings live in `cash_settings`; Ask Meld reads it all through `get_cash_plan`.

## Investments & loans

- Holdings (with cost basis and gain/loss), investment transactions (2 years), and loan/card details (rate, payment, due date, escrow) sync with every refresh when the institution supports Plaid's Investments and Liabilities products.
- **Accounts → Investments** has five views. **Overview**: totals, asset allocation and accounts. **Performance**: gains over 1M/3M/YTD/1Y/all and each calendar year, kept separate from deposits and withdrawals, with time-weighted growth rates (annualized past a year), in total and by account. History before Meld's first daily snapshot is estimated by replaying investment transactions backward from today's holdings against daily closes from Yahoo Finance (only tickers are sent; cached in `price_history`). Holdings without a public ticker (e.g. 401(k) pooled funds) are priced from their own transactions instead, and accounts with little transaction history are flagged. **Exposure**: sector, region and bond-type breakdowns plus your largest positions. **Income**: dividends, interest and reinvestment from investment transactions, with yield. **Holdings**: every position, filterable by account or search. All count only your ownership share of joint accounts.
- **Look-through exposure** (what's inside your funds) is an AI estimate from each fund's published allocation, looked up once per security when you open Investments and refreshed every 90 days. It needs `ANTHROPIC_API_KEY`; only tickers and fund names are sent.
- Tap any account for details. Loans and cards show a payoff estimate at the current payment.
- **Hide from totals** on an account's page excludes it from net worth, cash flow, budgets and lists (e.g. a closed or duplicate account). Hidden accounts are listed at the bottom of the Accounts tab.
- Full account numbers that Plaid returns for loans are dropped before storage.

## Plan: retirement

- **Plan → Retirement** projects your savings to retirement age, compares that with what you'll need for your money to last to the age you plan for, and shows the gap and the extra monthly saving that closes it. The chart shows your balance by age, growing until you retire and drawn down after.
- Everything is in **today's dollars**: the return is after inflation (5% by default), and spending, contributions, Social Security and pension are today's amounts.
- **Social Security** is estimated from your profile's income until you type the monthly amount at full retirement age from your statement (ssa.gov/myaccount). The estimate uses today's benefit formula and wage base, assumes you earn your current pay from 22 until you retire (up to 35 years), and for a married couple takes the lower of one earner plus a spousal benefit and two equal earners. Meld adjusts the benefit for the age you claim (67 by default): less before full retirement age, 8% a year more after it up to 70. Buttons show what 62, full retirement age and 70 pay, and tapping one sets the claiming age.
- Every visible investment account counts at your ownership share, except 529, Coverdell, UTMA/UGMA and other education or custodial accounts. Turn off any account you're saving for something else (a down payment, say), and add cash set aside for retirement as **Other savings**.
- Empty fields use suggestions: age from your profile's birth year, retirement at 65, planning to 95, and spending from your last 12 full months of cash flow. Edits update the projection as you type; **Save assumptions** keeps them.
- **Properties** you'd sell to fund retirement can count too. Turn on a home from the Accounts tab and set the age you'd sell it, its mortgage, and net rent per year (rent minus costs). At that age your share of the price (grown 1% a year after inflation by default, less 6% selling costs) minus what's left on the mortgage joins your savings; rent counts as saving before retirement and as income after, until the sale. The mortgage balance is projected from its rate and payment; taxes on the gain aren't included.
- Ask Meld can read the plan and try what-ifs ("what if I retire at 60?") without changing what you saved.

## Plan: tax

- **Plan → Tax** estimates this year's (or last year's) federal and state income tax: effective and marginal rates, where your income lands in the brackets, and what you're on track to owe or get back. It's an estimate, not a return.
- **Income** starts from your profile's household gross income and filing status. Pre-tax 401(k) deferrals and HSA contributions are projected from what your 401(k) and HSA accounts report. Dividends, interest and fund distributions come from taxable accounts and bank interest. The year is projected as this year so far plus whatever came in over the rest of last year, so December distributions count. A dividend's qualified share comes from what the fund holds: its stocks, apart from REITs.
- **Realized gains** are rebuilt from buys and sells with average cost, because Plaid reports one cost basis per holding and no lots. Holding periods follow shares in the order they were bought. Enter your broker's figures to replace the estimate.
- **Tax inputs** (per year, in `tax_settings`) cover what Meld can't see:
  - self-employment profit
  - other income
  - withholding and estimated payments
  - property tax and other itemized deductions
  - HSA coverage
  - whether you have a workplace plan
  - a flat state rate for states without tables
- **Tables:**
  - Federal brackets, deductions, capital gains rates, NIIT, additional Medicare and self-employment tax, the SALT cap and the child tax credit for 2025 and 2026, plus contribution limits and Roth/IRA phase-outs. The 2025 figures include the One Big Beautiful Bill changes.
  - California uses FTB's 2025 schedules (2026's aren't out yet), adding back HSA money and taxing gains as ordinary income.
  - States without an income tax owe nothing.
  - Tables live in `packages/shared/src/tax-tables.ts`; add a year there when the IRS and FTB publish it.
- **Suggestions** are fixed rules, each with the estimated tax saved this year. They cover:
  - tax-loss harvesting, with wash-sale warnings for purchases in the last 30 days in any account
  - gain harvesting at 0%
  - 401(k), HSA and IRA room
  - a backdoor Roth, with a pro-rata warning when pre-tax IRAs have money in them
  - a SEP IRA or solo 401(k) for self-employment income
  - Roth conversion room in low brackets
  - an underpayment warning

  Tap one to ask Ask Meld about it.

## Plan: insurance

- Add life and disability policies under **Plan → Insurance**, including coverage through work. It totals your life coverage, monthly disability benefit and yearly premiums. Term policies past their end date aren't counted.
- Whole and universal life policies count toward net worth at their surrender value, and are listed under **Insurance cash value** on the Accounts tab, which links back to each policy.
- **Upload PDF** on the Add policy page sends a policy, certificate or benefits summary to the AI provider (Claude by default), which fills in the form and flags anything it inferred or couldn't find. Nothing is saved until you check the fields and press **Save**. Needs `ANTHROPIC_API_KEY`; without it the page explains how to turn it on and you fill in the form by hand.
- **Attach PDF** keeps a copy of the policy document with any policy, new or existing, with no AI involved: nothing is sent anywhere. **Replace PDF** and **Remove** take effect when you save, and the old file is deleted.
- Uploaded PDFs are encrypted with `ENCRYPTION_KEY` and stored in `data/documents/` (gitignored; change with `DOCUMENTS_DIR`). PDFs saved before encryption was added are encrypted the next time the API starts. A PDF is deleted with its policy, when you cancel the draft, or after a day if it was never saved.
- Only the last 4 characters of policy numbers are stored.

## Ask Meld (AI chat)

- **Ask Meld** answers questions about your money: spending, debt payoff, investments, tax moves, insurance gaps. Answers stream in and conversations are saved. The Ask Meld page lists past conversations. On web, the sparkle button next to your name opens a chat panel beside the page you're on, with questions about that page.
- The AI looks things up with read-only tools (accounts, transactions, totals by merchant or category, cash flow, budgets, holdings, investment activity, loan terms, insurance, profile). It can't change anything. Each new conversation also starts with a short snapshot of your balances and profile.
- Add your income, filing status, state, age and employer benefits under **Plan → Profile** (also in the account menu on web) for better tax and insurance answers.
- Uses Claude through a provider interface in `apps/api/src/ai/provider.ts`, so other providers can be added. Chat defaults to `ANTHROPIC_CHAT_MODEL` (default `claude-sonnet-5-5`), property value lookups use `ANTHROPIC_LOOKUP_MODEL` (default `claude-haiku-5-5`), and policy PDF extraction `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- **Pick the model** under the chat box: any of `ANTHROPIC_CHAT_MODELS` (Opus, Sonnet, Haiku by default; Haiku costs least), or a local model through [Ollama](https://ollama.com). The choice is remembered, and you can switch mid-conversation.
- **Local models:** install Ollama, pull a model that supports tool calling (e.g. `ollama pull qwen3.5`), set `OLLAMA_URL=http://127.0.0.1:11434` (or `http://host.docker.internal:11434` when Meld runs in Docker) and restart the API. Every installed model with tool support is listed, or set `OLLAMA_CHAT_MODELS` to choose. Local models are free and keep your data on your machine, but answer less reliably than Claude. Chat works with only Ollama set up; the other AI features still need `ANTHROPIC_API_KEY`.
- Privacy: with a Claude model, your question and the data the AI looks up are sent to Anthropic; with a local Ollama model they stay on your machine. Long digit runs (account, card and policy numbers) are masked first either way.

## Common commands

| Command | What it does |
| --- | --- |
| `docker compose up -d --build` | Run all of Meld in Docker at http://localhost:8080 |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:up` | Start only Postgres (for `npm run dev`) |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the sandbox and production databases |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests (DB tests use `TEST_DATABASE_URL`; create it once with `docker compose exec db createdb -U meld meld_test`) |

## Security notes

- Plaid access tokens and uploaded PDFs are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`). Losing the key means re-linking accounts and losing access to stored PDFs.
- The API and Postgres bind to `127.0.0.1` only; in Docker, only the web container's port is published, also on `127.0.0.1`.
- Auth is a single-user passphrase that issues a bearer token, with 10 login attempts allowed per 15 minutes. It's built for one household on one machine, not for hosting other people's data.
- AI features send financial data to the configured LLM provider. Account numbers are masked first. Insurance PDF upload sends the whole document. Details in [PRIVACY.md](PRIVACY.md).
- Meld's estimates and suggestions (tax, retirement, Ask Meld) are for planning and education, not professional financial, tax or legal advice.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GNU AGPL v3](LICENSE). You can use, change and share Meld freely. If you run a modified version as a service for other people, you must share your changes under the same license.
