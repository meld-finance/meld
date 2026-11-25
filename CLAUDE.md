# Claude instructions for Meld

## UI changes

After any UI change, open the page with Playwright, screenshot it at desktop (1440px) and mobile (390px) widths, critique the layout, spacing, hierarchy and alignment, and fix the issues before reporting done.

## Documentation

The Markdown files (`docs/*.md`, `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`) are the single source of truth. Running `npm run docs:build` compiles them into the web documentation portal at `site/docs/` (published to GitHub Pages).

Before finishing a task that changes user-facing behavior, setup, configuration, privacy, security, or developer workflows, check `git diff --name-only`, update any affected documentation, and regenerate `site/docs/`:

| What changed | Update these docs |
| --- | --- |
| App screens, tabs, calculations, AI tools, alerts, budgets | `docs/features.md` |
| Plaid setup, environments, sync behavior | `docs/plaid.md`, `docs/features.md` |
| Tailscale / phone access setup | `docs/phone-access.md` |
| Dockerfile, `docker-compose.yml`, `.env.example`, `scripts/setup.sh`, `apps/api/src/env.ts` | `docs/docker.md`, `docs/development.md` |
| External network calls, AI prompts/providers, masking, storage | `PRIVACY.md`, `docs/features.md` |
| Auth, passphrase, encryption, localhost/security assumptions | `SECURITY.md`, `PRIVACY.md` |
| Desktop Electron builds, monorepo commands, schema migrations, release CI | `docs/development.md`, `CONTRIBUTING.md` |
| Landing page copy/screenshots or top-level install steps | `site/index.html`, `README.md` |

After editing any doc source, run `npm run docs:build` and verify with `npm run docs:check`. You can audit uncommitted code changes against doc mappings anytime with `npm run docs:audit`.

## Commits

Don't add a `Claude-Session:` line (or any claude.ai session URL) to commit messages or PR descriptions. Keep the `Co-Authored-By` line.
