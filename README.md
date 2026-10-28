# Meld

Your whole financial picture in one place — bank accounts, cards, brokerages, mortgages and loans (via Plaid), plus life and disability insurance — with an AI assistant that answers questions, makes recommendations and suggests tax strategies using that data as context.

Runs locally. Web first, then iOS and Android from the same Expo codebase.

## Layout

```
apps/api        Fastify + TypeScript API: Plaid, AI, data (Postgres via Drizzle)
apps/mobile     Expo (expo-router) app → web, iOS, Android
packages/shared Zod schemas + types shared by app and API
```

## Prerequisites

- Node 22+ and npm
- Docker Desktop (for Postgres)
- Plaid keys (https://dashboard.plaid.com/developers/keys) — Sandbox works for development
- An Anthropic API key (for the AI features)

## Setup

```sh
npm install
cp .env.example .env          # then fill in secrets (see comments in the file)
npm run db:up                 # start Postgres in Docker (localhost only)
docker compose exec db createdb -U meld meld_sandbox   # once: the sandbox database
npm run db:migrate            # apply migrations to both databases
npm run dev                   # API on :4000, Expo web on :8081
```

Open http://localhost:8081 and unlock with `APP_PASSPHRASE`.

Generate secrets with `openssl rand -base64 32` (`SESSION_SECRET` and `ENCRYPTION_KEY`).

## Linking accounts (Plaid)

Use **Accounts → Link account** in the web app. Accounts and balances sync immediately; transaction history (up to 2 years) arrives over the next minute or so and is fetched automatically. Every linked connection also re-syncs every 6 hours while the API is running, or on demand with **Refresh**.

- **Sandbox** (`PLAID_ENV=sandbox`): pick any institution and sign in with `user_good` / `pass_good`.
- **Real accounts** (`PLAID_ENV=production`): needs Plaid production access (or a Trial plan); set `PLAID_PRODUCTION_SECRET`. Each environment has its own secret and its own database (`SANDBOX_DATABASE_URL`, `PRODUCTION_DATABASE_URL`), so sandbox data never mixes with real data. Switching is just `PLAID_ENV` plus an API restart.
- If a bank needs you to sign in again, the connection shows **Reconnect**, which reopens Plaid Link in update mode.
- Linking on iOS/Android arrives with the mobile phase; use the web app until then.

## Overview & budgets

The app has five tabs: **Home**, **Ask Meld**, **Accounts** (sub-tabs Accounts and Investments), **Spending** (Overview, Transactions, Budgets) and **Plan** (Retirement, Insurance, Profile).


- **Net worth** = linked balances + manual assets (home, vehicles; add them on the Accounts tab) + life insurance cash surrender value − credit, loan and mortgage balances. Meld records one snapshot per day (after each sync and every 6 hours), so the trend line starts after the second day.
- **Cash flow** counts cash and credit card accounts only. Transfers between your accounts and credit card payments are excluded, so card purchases aren't double counted. Income is anything categorized `INCOME`; spending is everything else, net of refunds. Recategorize a transaction to change where it counts.
- **Drill into a category** by tapping it on **Spending → Overview** (Spending Breakdown, Top Movers, Where You Spend the Most): spending by subcategory and merchant against a year earlier, and the transactions behind it. Subcategories are Plaid's detailed categories (e.g. Groceries vs. Restaurants under Food and drink) unless you set your own.
- **Recategorize** by tapping any transaction: pick a category and subcategory, or type new ones. Turn on **Always categorize matching transactions this way** to create a rule: new transactions whose merchant or description contains the text you give are categorized as they sync, and optionally past matches you haven't changed by hand are updated too. The longest matching pattern wins, and a hand edit always overrides a rule. Manage rules from **Spending → Transactions → Rules**; deleting one puts its transactions back to their original category.
- **Budgets** are monthly targets per category, set under **Spending → Budgets**.

## Investments & loans

- Holdings (with cost basis and gain/loss), investment transactions (2 years), and loan/card details (rate, payment, due date, escrow) sync with every refresh when the institution supports Plaid's Investments and Liabilities products.
- **Accounts → Investments** has four views. **Overview**: totals, asset allocation and accounts. **Exposure**: sector, region and bond-type breakdowns plus your largest positions. **Income**: dividends, interest and reinvestment from investment transactions, with yield. **Holdings**: every position, filterable by account or search. All count only your ownership share of joint accounts.
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

## Plan: insurance

- Add life and disability policies under **Plan → Insurance**, including coverage through work. It totals your life coverage, monthly disability benefit and yearly premiums. Term policies past their end date aren't counted.
- Whole and universal life policies count toward net worth at their surrender value, and are listed under **Insurance cash value** on the Accounts tab, which links back to each policy.
- **Upload PDF** on the Add policy page sends a policy, certificate or benefits summary to the AI provider (Claude by default), which fills in the form and flags anything it inferred or couldn't find. Nothing is saved until you check the fields and press **Save**. Needs `ANTHROPIC_API_KEY`.
- Uploaded PDFs are stored in `data/documents/` (gitignored; change with `DOCUMENTS_DIR`). A PDF is deleted with its policy, when you cancel the draft, or after a day if it was never saved.
- Only the last 4 characters of policy numbers are stored.

## Ask Meld (AI chat)

- **Ask Meld** answers questions about your money: spending, debt payoff, investments, tax moves, insurance gaps. Answers stream in and conversations are saved. On web it's a panel that opens beside whatever page you're on (Ask Meld in the sidebar), with suggestions and recent conversations; on phones it's the Ask Meld tab.
- The AI looks things up with read-only tools (accounts, transactions, totals by merchant or category, cash flow, budgets, holdings, investment activity, loan terms, insurance, profile). It can't change anything. Each new conversation also starts with a short snapshot of your balances and profile.
- Add your income, filing status, state, age and employer benefits under **Plan → Profile** (also in the account menu on web) for better tax and insurance answers.
- Uses Claude through a provider interface in `apps/api/src/ai/provider.ts`, so other providers can be added. Chat defaults to `ANTHROPIC_CHAT_MODEL` (default `claude-sonnet-5-5`), property value lookups use `ANTHROPIC_LOOKUP_MODEL` (default `claude-haiku-5-5`), and policy PDF extraction `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- **Pick the model** under the chat box: any of `ANTHROPIC_CHAT_MODELS` (Opus, Sonnet, Haiku by default; Haiku costs least), or a local model through [Ollama](https://ollama.com). The choice is remembered, and you can switch mid-conversation.
- **Local models:** install Ollama, pull a model that supports tool calling (e.g. `ollama pull qwen3.5`), set `OLLAMA_URL=http://127.0.0.1:11434` and restart the API. Every installed model with tool support is listed, or set `OLLAMA_CHAT_MODELS` to choose. Local models are free and keep your data on your machine, but answer less reliably than Claude. Chat works with only Ollama set up; the other AI features still need `ANTHROPIC_API_KEY`.
- Privacy: with a Claude model, your question and the data the AI looks up are sent to Anthropic; with a local Ollama model they stay on your machine. Long digit runs (account, card and policy numbers) are masked first either way.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the sandbox and production databases |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests (DB tests use `TEST_DATABASE_URL`; create it once with `docker compose exec db createdb -U meld meld_test`) |

## Security notes

- Plaid access tokens are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`). Losing the key means re-linking accounts.
- The API and Postgres bind to `127.0.0.1` only.
- Auth is a single-user passphrase that issues a bearer token. Replace it with a real identity provider before hosting.
- AI features send financial data to the configured LLM provider. Account numbers are masked first. Insurance PDF upload sends the whole document.
