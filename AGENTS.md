# Agent instructions for Meld

## Architecture & feature-slice map

```
apps/api        Fastify + TypeScript API, Plaid sync, AI/MCP tools, Drizzle Postgres
apps/mobile     Expo (expo-router) client for web, iOS, and Android
apps/desktop    Electron wrapper with bundled Postgres, API, web app, tray, Tailscale
packages/shared Zod schemas, API types, and shared pure financial math
```

When adding or changing a domain feature, follow the vertical slice:

1. **Schemas & shared pure math**: `packages/shared/src/<domain>.ts` (re-exported from `packages/shared/src/index.ts`).
2. **DB schema & migrations**: `apps/api/src/db/schema.ts` → run `npm run db:generate` to emit SQL migrations in `apps/api/drizzle/`.
3. **Backend logic & persistence**: pure calculations in `apps/api/src/lib/<domain>.ts`, Postgres queries/mutations in `apps/api/src/services/<domain>.ts`.
4. **HTTP routes**: `apps/api/src/routes/<domain>.ts` (registered in `apps/api/src/server.ts`).
5. **AI & MCP exposure**: `apps/api/src/ai/chat-tools.ts` (Ask Meld tools) and `apps/api/src/mcp/server.ts` (read-only MCP tools/resources).
6. **Frontend queries & UI**: React Query hooks in `apps/mobile/src/lib/queries/<domain>.ts` (re-exported via `apps/mobile/src/lib/queries.ts`) and UI components in `apps/mobile/src/components/<domain>/` or screens in `apps/mobile/src/app/`.

## Key domain invariants

- **Dual databases**: `SANDBOX_DATABASE_URL` and `PRODUCTION_DATABASE_URL` are strictly isolated; DB tests use `TEST_DATABASE_URL` and truncate tables between tests.
- **Secrets & masking**: Sensitive DB columns (`accessTokenEnc`, account numbers, policy numbers) use AES-256-GCM via `apps/api/src/lib/crypto.ts`. AI tool outputs are scrubbed with `maskNumbers` in `apps/api/src/ai/chat-tools.ts`.
- **Financial & Plaid conventions**: Respect `accounts.hidden = false` and `accounts.ownershipPercent` (`null` means 100%). Exclude internal transfers and credit card payments from cash flow/spending. Follow Plaid's transaction sign convention (positive = outflow, negative = inflow). Keep retirement projections in today's dollars.
- **API base prefix**: Routes mount at `/` in dev (`npm run dev`) and under `/api` when `WEB_DIR` is set (Docker and packaged desktop).

## Documentation

Meld's Markdown files (`docs/*.md`, `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`) are the single source of truth. The static web documentation site in `site/docs/` is generated from them by `scripts/build-docs.mjs`.

Before finishing any change that affects user-facing behavior, setup, environment variables, commands, privacy, security, or developer tooling:

1. Check `git diff --name-only` (or run `npm run docs:audit`) to see which documentation areas are affected:
   - **Features, UI, calculations, alerts, AI tools**: `docs/features.md`
   - **Plaid integration & keys**: `docs/plaid.md`, `docs/features.md`
   - **Tailscale & phone access**: `docs/phone-access.md`
   - **Docker, `.env.example`, `scripts/setup.sh`, `apps/api/src/env.ts`**: `docs/docker.md`, `docs/development.md`
   - **External requests, AI providers, masking, storage**: `PRIVACY.md`, `docs/features.md`
   - **Auth, passphrase, encryption, security model**: `SECURITY.md`, `PRIVACY.md`
   - **Desktop builds, monorepo commands, schema migrations, release workflows**: `docs/development.md`, `CONTRIBUTING.md`
   - **Landing page copy or screenshots**: `site/index.html`, `README.md`
2. Update the relevant Markdown file(s).
3. Run `npm run docs:build` to regenerate `site/docs/`, and verify with `npm run docs:check`.

## UI changes

After any UI change (including `site/` or `site/docs/`), open the page in a headless browser, inspect screenshots at desktop (1440px) and mobile (390px) widths, check layout, spacing, contrast, hierarchy, and alignment, and resolve any issues before finishing.

You can capture both viewports (with automatic `APP_PASSPHRASE` login when set) using:

```sh
npm run ui:snap -- /path
```

Screenshots are written to `/tmp/meld-ui-snap` by default (use `--out <dir>`, `--url <baseUrl>`, `--theme dark`).

## Verification

During iteration, run fast targeted checks:

```sh
npm run check:changed                       # docs audit + typecheck/lint/unit tests for changed workspaces
npm run test:unit                           # parallel API unit tests (no Postgres required)
npm run test:db                             # serial Postgres DB tests (requires TEST_DATABASE_URL)
npx vitest run <file> -w @meld/api          # single test file
```

Before concluding work, run the applicable full checks:

```sh
npm run typecheck
npm test
npm run lint -w @meld/mobile
npm run site:check
npm run docs:check
```
