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

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests |

## Security notes

- Plaid access tokens are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`). Losing the key means re-linking accounts.
- The API and Postgres bind to `127.0.0.1` only.
- Auth is a single-user passphrase that issues a bearer token. Replace it with a real identity provider before hosting.
- AI features send financial data to the configured LLM provider. Account numbers are masked first.
