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
npm run db:migrate            # apply migrations
npm run dev                   # API on :4000, Expo web on :8081
```

Open http://localhost:8081 and unlock with `APP_PASSPHRASE`.

Generate secrets with `openssl rand -base64 32` (`SESSION_SECRET` and `ENCRYPTION_KEY`).

## Linking accounts (Plaid)

Use **Accounts → Link account** in the web app. Accounts and balances sync immediately; transaction history (up to 2 years) arrives over the next minute or so and is fetched automatically. Every linked connection also re-syncs every 6 hours while the API is running, or on demand with **Refresh**.

- **Sandbox** (`PLAID_ENV=sandbox`): pick any institution and sign in with `user_good` / `pass_good`.
- **Real accounts** (`PLAID_ENV=production`): needs Plaid production (or limited production) access and production secrets.
- If a bank needs you to sign in again, the connection shows **Reconnect**, which reopens Plaid Link in update mode.
- Linking on iOS/Android arrives with the mobile phase; use the web app until then.

## Overview & budgets

- **Net worth** = linked balances + manual assets (home, vehicles; add them on the Accounts tab) − credit, loan and mortgage balances. Meld records one snapshot per day (after each sync and every 6 hours), so the trend line starts after the second day.
- **Cash flow** counts cash and credit card accounts only. Transfers between your accounts and credit card payments are excluded, so card purchases aren't double counted. Income is anything categorized `INCOME`; spending is everything else, net of refunds. Recategorize a transaction to change where it counts.
- **Budgets** are monthly targets per category, set on the Budget tab.

## Investments & loans

- Holdings (with cost basis and gain/loss), investment transactions (2 years), and loan/card details (rate, payment, due date, escrow) sync with every refresh when the institution supports Plaid's Investments and Liabilities products.
- Tap any account for details. Loans and cards show a payoff estimate at the current payment.
- **Hide from totals** on an account's page excludes it from net worth, cash flow, budgets and lists (e.g. a closed or duplicate account). Hidden accounts are listed at the bottom of the Accounts tab.
- Full account numbers that Plaid returns for loans are dropped before storage.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests (DB tests use `TEST_DATABASE_URL`; create it once with `docker compose exec db createdb -U meld meld_test`) |

## Security notes

- Plaid access tokens are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`). Losing the key means re-linking accounts.
- The API and Postgres bind to `127.0.0.1` only.
- Auth is a single-user passphrase that issues a bearer token. Replace it with a real identity provider before hosting.
- AI features send financial data to the configured LLM provider. Account numbers are masked first.
