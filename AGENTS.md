# Agent instructions for Meld

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

## Verification

Before concluding work, run the applicable checks:

```sh
npm run typecheck
npm test
npm run lint -w @meld/mobile
npm run site:check
npm run docs:check
```
