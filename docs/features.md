[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](../README.md) · [Plaid setup](plaid.md) · [Phone access](phone-access.md) · [Docker setup](docker.md)

# Features

What each part of Meld does and how it works. For installing, see the [README](../README.md).

<!-- toc -->
- [Linking accounts (Plaid)](#linking-accounts-plaid)
- [Overview & budgets](#overview--budgets)
- [Recurring payments, autopay & alerts](#recurring-payments-autopay--alerts)
- [Cash & emergency fund](#cash--emergency-fund)
- [Investments & loans](#investments--loans)
- [Plan: retirement](#plan-retirement)
- [Plan: tax](#plan-tax)
- [Plan: insurance](#plan-insurance)
- [Plan: estate](#plan-estate)
- [Ask Meld (AI chat)](#ask-meld-ai-chat)
- [External agents (MCP server)](#external-agents-mcp-server)
- [Phone access over Tailscale](phone-access.md) · [Docker self-hosting](docker.md)
<!-- /toc -->

> **Not financial advice.** Meld's estimates and suggestions (tax, retirement, estate, Ask Meld) are for planning and education, not professional financial, tax or legal advice.

## Linking accounts (Plaid)

Use **Accounts → Link account** in the web app. Accounts and balances sync immediately; transaction history (up to 2 years) arrives over the next minute or so and is fetched automatically. Every linked connection also re-syncs every 6 hours while the API is running, or on demand with **Refresh**.

- **Sandbox** (`PLAID_ENV=sandbox`): pick any institution and sign in with `user_good` / `pass_good`.
- **Real accounts** (`PLAID_ENV=production`): needs Plaid production access (usually approved automatically); the free Trial plan covers up to 10 bank logins, and each login can include any number of accounts at that bank (see [Connecting your accounts with Plaid](plaid.md)). Set `PLAID_PRODUCTION_SECRET`. Each environment has its own secret and its own database (`SANDBOX_DATABASE_URL`, `PRODUCTION_DATABASE_URL`), so sandbox data never mixes with real data. Switching is just `PLAID_ENV` plus an API restart.
- If a bank needs you to sign in again, the connection shows **Reconnect**, which reopens Plaid Link in update mode.
- Linking on iOS/Android arrives with the mobile phase; use the web app until then.

## Overview & budgets

The app has five tabs: **Home**, **Ask Meld**, **Accounts** (sub-tabs Accounts, Cash and Investments), **Spending** (Overview, Transactions, Recurring, Budgets) and **Plan** (Retirement, Tax, Insurance, Estate, Profile).


- **Net worth** = linked balances + manual assets (home, vehicles; add them on the Accounts tab) + life insurance cash surrender value − credit, loan and mortgage balances. Meld records one snapshot per day (after each sync and every 6 hours), so the trend line starts after the second day.
- **Cash flow** counts cash and credit card accounts only. Transfers between your accounts and credit card payments are excluded, so card purchases aren't double counted. Income is anything categorized `INCOME`; spending is everything else, net of refunds. Recategorize a transaction to change where it counts.
- **Drill into a category** by tapping it on **Spending → Overview** (Spending Breakdown, Top Movers, Where You Spend the Most): spending by subcategory and merchant against a year earlier, and the transactions behind it. Subcategories are Plaid's detailed categories (e.g. Groceries vs. Restaurants under Food and drink) unless you set your own.
- **Recategorize** by tapping any transaction: pick a category and subcategory, or type new ones. Turn on **Always categorize matching transactions this way** to create a rule: new transactions whose merchant or description contains the text you give are categorized as they sync, and optionally past matches you haven't changed by hand are updated too. The longest matching pattern wins, and a hand edit always overrides a rule. Manage rules from **Spending → Transactions → Rules**; deleting one puts its transactions back to their original category.
- **Budgets** are monthly targets per category, set under **Spending → Budgets**.

## Recurring payments, autopay & alerts

- **Spending → Recurring** finds charges and deposits that repeat on a schedule (weekly to yearly) in up to two years of card and bank transactions: subscriptions, bills (utilities, insurance, loans, and anything whose amount varies) and income. A merchant with more than one subscription (an app store) or a membership among other purchases is split by amount. Each series shows its cadence, expected amount, monthly cost, next date, and a badge when a steady price changes. Series that stopped charging are listed separately, since they may have been canceled. Tap one to change its kind, rename it, see its charges, or mark it **Not recurring**. Corrections are kept in `recurring_overrides`; the series are worked out from transactions each time. Transfers and card payments aren't counted, as in cash flow.
- **Autopay** links a card or loan to the bank account that pays it, paying the statement balance, minimum, current balance or a fixed amount (a loan pays its scheduled payment). For a card on the statement balance, Meld takes Plaid's last statement less payments since, due on the statement's due date. Once that's paid, or before the next statement is out, it estimates from the current balance. It then checks the bank account's available balance against everything else due from it first: other autopays, recurring bills charged to it, and (optionally) paychecks expected into it at least a day before. Each autopay shows **Covered**, **Tight** (less than your cushion left), **Short**, **Paid** or **Unknown**, with the breakdown. Meld also suggests links when a bank payment and a card payment of the same amount line up a few days apart.
- **Coming up** lists the next 30 days of recurring charges, paychecks and autopay payments.
- **Alerts** (the bell on web, and a card on Home) are checked after every sync, every 6 hours, and when you change autopay or alert settings:
  - an autopay its bank account won't cover (urgent), or that leaves less than your cushion. Estimated amounts only alert within a week of the due date.
  - a bank account below a minimum you set
  - any charge at or above an amount you set
  - a subscription or bill whose steady price went up
  - a new recurring charge (shown in the app only, by default)
  - a bank connection that needs you to sign in again

  Alerts about a state clear themselves once it's fixed; a dismissed one comes back only if it gets worse. Settings are on the Alerts page (`alert_settings`).
- **Push to your phone** with [ntfy](https://ntfy.sh): install the app, subscribe to a long random topic, and paste its URL under Alerts. Pick whether to push urgent alerts only, warnings and urgent (the default), or everything. Alert text includes account names and amounts, so use your own ntfy server to keep it off the public one (see [PRIVACY.md](../PRIVACY.md)).
- Ask Meld reads all of this through `get_recurring`.

## Cash & emergency fund

- **Accounts → Cash** gathers liquid cash: checking, savings, money market and cash management accounts, money market funds, T-bill ETFs (SGOV, BIL…) and brokerage sweep cash. CDs, HSAs and cash in retirement accounts aren't counted toward the emergency fund.
- Each position's rate is estimated: bank accounts from each interest posting in about the last three months against the average daily balance since the posting before (worked back from today's balance through the transactions), compounded monthly into an APY, taking the median across postings, cash ETFs from a year of distributions (Yahoo Finance), and money market funds as roughly the 3-month Treasury yield (`^IRX`), which is also the "high-yield rate now" benchmark. Only tickers are sent. You can enter any rate yourself.
- The emergency fund target is a number of months (6 by default) of your average monthly spending over the last 12 complete months, or a monthly figure you enter. The page shows your runway in months and how far above or below the target you are.
- Rule-based nudges: move low-earning cash to a high-yield account (keeping a month of spending in checking), invest cash beyond the target, put idle cash in retirement accounts to work, and fill in missing rates. Positions can be set aside (e.g. for a down payment) so they don't count. Settings live in `cash_settings`; Ask Meld reads it all through `get_cash_plan`.

## Investments & loans

- Holdings (with cost basis and gain/loss), investment transactions (2 years), and loan/card details (rate, payment, due date, escrow) sync with every refresh when the institution supports Plaid's Investments and Liabilities products.
- **Accounts → Investments** has five views. **Overview**: totals, asset allocation and accounts. **Performance**: gains over 1M/3M/YTD/1Y/all and each calendar year, kept separate from deposits and withdrawals, with time-weighted growth rates (annualized past a year), in total and by account. History before Meld's first daily snapshot is estimated by replaying investment transactions backward from today's holdings against daily closes from Yahoo Finance (only tickers are sent; cached in `price_history`). Holdings without a public ticker (e.g. 401(k) pooled funds) are priced from their own transactions instead, and accounts with little transaction history are flagged. **Exposure**: sector, region and bond-type breakdowns plus your largest positions. **Income**: dividends, interest and reinvestment from investment transactions, with yield. **Holdings**: every position, filterable by account or search. All count only your ownership share of joint accounts.
- **Look-through exposure** (what's inside your funds) is an AI estimate from each fund's published allocation, looked up once per security when you open Investments and refreshed every 90 days. It needs an Anthropic or OpenRouter key; only tickers and fund names are sent.
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
- **Upload PDF** on the Add policy page sends a policy, certificate or benefits summary to the AI provider (Claude, or Gemini through OpenRouter), which fills in the form and flags anything it inferred or couldn't find. Nothing is saved until you check the fields and press **Save**. Needs an Anthropic or OpenRouter key; without it the page explains how to turn it on and you fill in the form by hand.
- **Attach PDF** keeps a copy of the policy document with any policy, new or existing, with no AI involved: nothing is sent anywhere. **Replace PDF** and **Remove** take effect when you save, and the old file is deleted.
- Uploaded PDFs are encrypted with `ENCRYPTION_KEY` and stored in `data/documents/` (gitignored; change with `DOCUMENTS_DIR`). PDFs saved before encryption was added are encrypted the next time the API starts. A PDF is deleted with its policy, when you cancel the draft, or after a day if it was never saved.
- A policy's full number is optional and stored encrypted with `ENCRYPTION_KEY`. It's printed in the family packet, and everywhere else the app only shows the last 4. PDF extraction only ever reads the last 4.

## Plan: estate

- **Plan → Estate** checks that everything you own passes the way you intend, keeps your estate documents in one place, and builds a packet your family can use. It helps you organize; it isn't legal advice.
- **Checklist:** four steps that check themselves off: every account and policy set up, the core documents on file, someone to call, and a current family packet.
- **Accounts and policies:** a **To do** list first, each row saying what's missing in a sentence. Rows that are already set up fold away under **Set up**. When several accounts would go through probate with nothing set up, **Leave them to my will** marks them all “By will” in one go. Each account, home or other asset (tap it, or **On death** on an account's page) records how it passes:
  - a beneficiary designation
  - transfer or payable on death (or a TOD deed for property)
  - joint with survivorship
  - one of your trusts
  - by will

  Beneficiaries are primary or contingent, with shares, as the institution has them on file. Life policies use the beneficiaries on the policy. Kept in `estate_designations`, apart from synced data.
- **Full account numbers** for the packet are optional, typed in on the account's estate screen and stored encrypted with `ENCRYPTION_KEY`. The app only ever shows the last 4. For a linked checking or savings account, **Get from bank** fetches the number through Plaid Auth. Auth must be enabled for your Plaid account, and Plaid bills it once per connection. The first time, Meld asks you to reconnect the bank and allow account numbers. Set `PLAID_ADDITIONAL_CONSENTED_PRODUCTS=auth` to ask for that when you link new banks.
- **Readiness checks** (pure rules in `apps/api/src/lib/estate.ts`), shown on the row they're about:
  - a retirement account, HSA or life policy with no beneficiary (a new account is called out)
  - accounts and property that would go through probate, or sit outside your revocable trust once you have one
  - shares that don't add to 100%, your estate named as beneficiary, or a minor child from your profile named directly
  - no contingent beneficiary
  - designations and documents not reviewed in the interval you pick (3 years by default)
  - a missing will, financial power of attorney or healthcare directive, and no guardian named when you have minor children
  - a child born after a will or trust was signed
  - a document drafted in another state than your profile's
- **Documents and trusts** (`estate_documents`): missing core documents are listed as rows to add. Each document records its type, date signed, state, when you last reviewed it, where the signed original is kept, the people it names (trustees, successor trustees, executor, agents, guardians) with contact details, the attorney, and an optional scanned PDF, encrypted like policy PDFs.
- **Contacts and instructions** (`estate_settings`): executor, attorney, CPA, advisor, employer HR and others; a note on where to find logins (Meld never stores passwords); and a letter to your family.
- **Family packet:** **Export PDF** builds a PDF from today's data on your machine, optionally encrypted (AES-256) with a password. It holds instructions, who to call, first steps, every document and who it names, each account and policy with how it passes and its beneficiaries, property, debts, and bills on autopay or to cancel. Print it or keep it with your will. Meld remembers what it contained (a hash, not a copy) and flags it as out of date when beneficiaries, documents, contacts or accounts change, or after a year. Balance changes alone don't count. Export works in the web app for now.
- **Alerts:** an account or policy with no beneficiary, and an out-of-date packet, show under Alerts (informational, so not pushed by default). Turn them off with **Estate planning** on the Alerts page.
- Ask Meld reads all of this through `get_estate_plan`, with names and roles but no contact details.

## Ask Meld (AI chat)

- **Ask Meld** answers questions about both your money (spending, debt payoff, investments, tax moves, insurance gaps) and how to use Meld itself (features, screens, calculations, settings, Plaid, phone access, Docker, privacy and security). Answers stream in and conversations are saved. The Ask Meld page lists past conversations with clickable examples for both your finances and how to use Meld. On web, the sparkle button next to your name opens a chat panel beside the page you're on, with financial and "How Meld works" questions about that page.
- **Progressive context & tools:** Each new conversation starts with a tiny orientation summary (net worth totals, account/policy/alert counts, basic profile, and the page you asked from) rather than dumping every account and policy upfront. The AI then fetches only what your question needs through read-only, summary-first tools (`get_financial_overview`, `get_accounts`, filtered `get_holdings`, `get_net_worth` with 30d/90d/YTD/1y deltas and optional sampled history, transactions, spending/budgets, loans, specialist planning tools like `get_tax_plan`, `get_retirement_plan`, `get_estate_plan`, `get_recurring`, `get_cash_plan`, and `get_insurance_policies`, plus `get_meld_docs`). `get_meld_docs` is deferred and searches Meld's own docs section-by-section on demand (generated from the repository's canonical Markdown docs by `npm run docs:build`, keeping it in sync with the documentation while keeping context minimal). Ask Meld is read-only and can't change anything.
- **Fast responses by default:** Claude uses `low` effort on Sonnet/Haiku and `medium` on Opus (override with `ANTHROPIC_CHAT_EFFORT`), caches the static prompt prefix across sessions, and defers specialist planning tool schemas via Anthropic tool search when supported. ChatGPT and OpenRouter set low reasoning effort, Ollama disables hidden thinking tokens by default (`OLLAMA_THINK=1` re-enables them), and `get_investment_performance` / `get_cash_plan` use cached market data instead of blocking chat on slow external price lookups.
- Add your income, filing status, state, age and employer benefits under **Plan → Profile** (also in the account menu on web) for better tax and insurance answers.
- PDF reading, value lookups and fund make-up go through a provider interface in `apps/api/src/ai/provider.ts`, run by Anthropic or OpenRouter (see below). With Anthropic, chat defaults to `ANTHROPIC_CHAT_MODEL` (default `claude-sonnet-5-5`), property value lookups use `ANTHROPIC_LOOKUP_MODEL` (default `claude-haiku-5-5`), and policy PDF extraction `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- **Pick the model** under the chat box: any of `ANTHROPIC_CHAT_MODELS` (Opus, Sonnet, Haiku by default; Haiku costs least), a ChatGPT model on your own plan, Gemini, GPT, Claude and other models through [OpenRouter](https://openrouter.ai), or a local model through [Ollama](https://ollama.com). The choice is remembered, and you can switch mid-conversation.
- **Local models:** install Ollama and pull a model that supports tool calling (e.g. `ollama pull qwen3.5`), then use **Settings → AI → Find Ollama**, or set `OLLAMA_URL=http://127.0.0.1:11434` (`http://host.docker.internal:11434` when Meld runs in Docker) and restart the API. Every installed model with tool support is listed, or set `OLLAMA_CHAT_MODELS` to choose. Local models are free and keep your data on your machine, but answer less reliably than Claude. Chat works with only Ollama set up; the other AI features still need an Anthropic or OpenRouter key.
- **ChatGPT plan:** with ChatGPT Go, Plus, Pro or Business, choose **Settings → AI → ChatGPT plan → Continue with ChatGPT** and sign in. Ask Meld then lists the ChatGPT models your plan offers, billed to your plan's usage instead of an API key (set a limit or disconnect Meld at [chatgpt.com/settings/usage](https://chatgpt.com/settings/usage)). It takes effect without a restart. The browser returns to Meld at `http://127.0.0.1:1455`; if Meld runs in Docker or you sign in from another device, that page won't load, so copy its address into the box Settings shows. The sign-in is kept encrypted with `ENCRYPTION_KEY` in `chatgpt.json` next to Meld's settings file (`CHATGPT_AUTH_FILE` overrides). Free plans can't share usage; ChatGPT shows "A required permission is unavailable" and Meld explains it. On Business, an admin first sets **Use ChatGPT plan** to Allowed for Meld under **Tenant settings → External access** at admin.openai.com. It covers chat only; PDF reading and value lookups still need an Anthropic or OpenRouter key.
- **OpenRouter:** one API key for many vendors' models, including Gemini. Create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), add credits, and paste it under **Settings → AI → OpenRouter** (or set `OPENROUTER_API_KEY`). Ask Meld then offers a few suggested Gemini, Claude and GPT models; list your own under **Models to offer in Ask Meld**, one [model ID](https://openrouter.ai/models?supported_parameters=tools) per line (or `OPENROUTER_CHAT_MODELS`, comma-separated). Only models that support tool calling appear. You pay OpenRouter per use. Google AI Pro and Ultra plans can't be used by other apps, so a Gemini subscription doesn't cover this. Without an Anthropic key (or with `AI_PROVIDER=openrouter`), OpenRouter also runs the other AI features: policy PDFs are read by `OPENROUTER_MODEL` (default `google/gemini-4-carbon`), which must read PDFs itself (Meld asks for OpenRouter's `native` PDF engine, so no OCR service sees the file); home and car value lookups and fund make-up use `OPENROUTER_LOOKUP_MODEL` (default `google/gemini-4-hydrogen`). Value lookups use the model provider's own web search (Google Search for Gemini), never a third-party search engine, and a lookup that comes back without cited pages is rejected rather than trusted.
- Privacy: with a Claude model, your question and the data the AI looks up are sent to Anthropic, or to OpenAI with a ChatGPT model, or to OpenRouter and the model's provider with an OpenRouter model (only providers that don't store or train on prompts); with a local Ollama model they stay on your machine. Long digit runs (account, card and policy numbers) are masked first either way.

## External agents (MCP server)

For advanced workflows, Meld can also expose your financial data as a read-only **Model Context Protocol (MCP)** server so external agents (such as Claude Code, Cursor, Codex, or Claude Desktop) can answer questions directly.

- **Off by default:** Turn it on in **Settings → External agents (MCP)** (no restart needed). Enabling generates a dedicated bearer token (`meld_mcp_…`) shown once—Meld keeps only a SHA-256 hash—or set `MCP_ENABLED=1` and `MCP_TOKEN` in `.env` for Docker/headless installs.
- **Endpoint & clients:** Served over Streamable HTTP at `/api/mcp` in the desktop app and Docker (or `/mcp` in `npm run dev`). **Settings → External agents (MCP)** gives copy-pasteable configs for **Claude Code**, **Cursor / HTTP JSON**, and the thin stdio bridge (`scripts/meld-mcp.mjs`) for stdio-only clients.
- **What's exposed (read-only):**
  - **Tools:** All 21 read-only tools from Ask Meld (`get_financial_overview`, `get_accounts`, `get_net_worth`, `get_holdings`, `get_cashflow`, `search_transactions`, `get_tax_plan`, `get_retirement_plan`, `get_estate_plan`, `get_recurring`, `get_cash_plan`, `get_insurance_policies`, `get_meld_docs`, etc.), marked `readOnlyHint: true`.
  - **Resources:** `meld://overview` (live compact summary), `meld://conventions`, `meld://docs/retirement`, `meld://docs/tax`, and `meld://docs/recurring` for progressive documentation loading.
  - **Prompts:** `financial-checkup`, `spending-review`, `tax-plan-review`, and `retirement-checkup`.
- **Security:** Restricted to localhost (`127.0.0.1`/`localhost`) by default even when Tailscale phone access is on (override with `MCP_ALLOW_REMOTE=1`), always requires the dedicated MCP bearer token even when passphrase login is turned off, and applies the same digit masking and privacy boundaries as Ask Meld. See [PRIVACY.md](../PRIVACY.md) and [SECURITY.md](../SECURITY.md).
