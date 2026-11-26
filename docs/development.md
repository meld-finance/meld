[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](../README.md) · [Features](features.md) · [Contributing](../CONTRIBUTING.md)

# Development

```
apps/api        Fastify + TypeScript API: Plaid, AI, data (Postgres via Drizzle); also serves the web app under /api
apps/mobile     Expo (expo-router) app → web, iOS, Android
apps/desktop    Electron app for macOS and Windows (Windows is a preview): bundled Postgres + the API + the web app, menu bar / tray, Tailscale
packages/shared Zod schemas + types shared by app and API
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.

You need Node 22+ and npm, plus Docker for Postgres.

```sh
npm install
./scripts/setup.sh            # or: cp .env.example .env and fill it in by hand
npm run db:up                 # start only Postgres in Docker (localhost only)
docker compose exec db createdb -U meld meld_test       # once: the test database
npm run db:migrate            # apply migrations to both databases
npm run dev                   # API on :4000, Expo web on :8081
```

Open http://localhost:8081 and unlock with `APP_PASSPHRASE`. To work on the demo household instead of Plaid data, set `MELD_DEMO=1` and restart the API: it creates `meld_demo` next to your other databases, fills it from `apps/api/src/demo/data.ts`, and rebuilds it once it's two days old so due dates and alerts stay current. `apps/api/src/demo/seed.db.test.ts` checks that every tour stop still has something to show.

If your Postgres volume predates `docker/initdb`, create the sandbox database once with `docker compose exec db createdb -U meld meld_sandbox`.

## Desktop app

- `npm run desktop:dev` opens the Electron app against the API source and the Expo dev server (hot reload on both), with its own Postgres and data in `~/Library/Application Support/Meld Dev`. Stop `npm run dev` first: both use port 4000. Set `MELD_USER_DATA=<folder>` to try a fresh first run.
- **Sign-in.** The desktop app makes a random `DESKTOP_TOKEN` each time it starts and passes it to the API. Its window gets the token through the preload (`window.meldDesktop.sessionToken`, only on pages from Meld's own server) and sends it as its bearer token, so it never shows the lock screen and finishes first-run setup with no passphrase. Browsers and phones still log in with the passphrase; until one is set, only the window gets in. The window can also change or remove the passphrase without the old one.
- `npm run desktop:build` builds `apps/desktop/release/mac-<arch>/Meld.app` in a minute or two, for checking the real thing. `npm run desktop:dist` makes the `.dmg` for this Mac's architecture. For Intel Macs: `cd apps/desktop && node scripts/build.mjs --arch x64 && npx electron-builder --x64`.
- Packaged, the API is one esbuild bundle run in an Electron utility process, Postgres is the [embedded-postgres](https://github.com/leinelissen/embedded-postgres) build thinned to one architecture, and the web app is the same Expo export Docker serves. Logs: menu bar → **Show Log**.
- **Keys.** Meld's encryption key, session secret and Postgres password are one item in the macOS Keychain (Windows: Credential Manager), service `Meld`, account `secrets` (`secrets:<folder>` for other data folders, e.g. `secrets:Meld Dev`). Losing it means re-linking every bank, and Meld refuses to start rather than make new keys over existing data. Builds before this kept them in `secrets.bin`, encrypted with Electron's safeStorage; the first start of a newer build copies them into the Keychain and renames the file `secrets.bin.migrated`.
- **Windows.** The app has to be built on the OS it's for, so the Windows installer is built in CI: `.github/workflows/windows.yml` runs on every pull request that touches `apps/desktop/`, and on demand (`gh workflow run windows.yml --ref <branch>`, or Actions → **Windows build** → **Run workflow**). Download `Meld-x64-setup.exe` from the run's **windows** artifact (`gh run download <run-id> -n windows`). On a Windows machine, `npm run desktop:build` makes `apps/desktop/release/win-unpacked/Meld.exe` and `npm run desktop:dist` makes the installer, with Windows Postgres (`@embedded-postgres/windows-x64`). The installer is per-user (no admin prompt) and unsigned, so SmartScreen warns the first time (**More info → Run anyway**). Data lives in `%APPDATA%\Meld`, the keys in Credential Manager, and Meld keeps running in the notification area when its window closes. It builds cleanly but hasn't been tried end to end on Windows yet, so treat it as a preview.
- **Sharing real data with dev.** Plaid bills per linked bank, so link each bank once (in the Mac app) and copy the data to `npm run dev` rather than linking it in both. Quit Meld first; both commands run its Postgres themselves, and macOS may ask once to let Electron use the "Meld" Keychain item.
  - `npm run desktop:seed-from-dev` (once): copies dev's production database and documents into the Mac app, which takes dev's `ENCRYPTION_KEY` so the Plaid tokens still work. It stops if the Mac app has banks dev doesn't.
  - `npm run dev:pull-desktop` (any time): replaces dev's production database and documents with the Mac app's, and sets dev's `ENCRYPTION_KEY` to match. It stops if dev has banks the Mac app doesn't. `MELD_TRANSFER_FORCE=1` overrides either check.
  - Both set `PLAID_SHARED_ITEMS=true` in `.env`, so unlinking a bank in dev removes it there only and the Mac app keeps it. Restart `npm run dev` and the Docker container afterwards.
- Signing and notarization happen when `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` are set (see electron-builder's docs); otherwise the build is unsigned.

## Common commands

| Command | What it does |
| --- | --- |
| `docker compose up -d --build` | Run all of Meld in Docker at http://localhost:8080 |
| `npm run desktop:dev` | The desktop app against the API source and Expo dev server |
| `npm run desktop:build` / `npm run desktop:dist` | Build `Meld.app` / the `.dmg` (`win-unpacked` / the setup `.exe` on Windows) |
| `gh workflow run windows.yml --ref <branch>` | Build the Windows installer in CI from a Mac |
| `npm run dev:pull-desktop` | Copy the Mac app's data into dev (`desktop:seed-from-dev` goes the other way, once) |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:up` | Start only Postgres (for `npm run dev`) |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the sandbox and production databases |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests (DB tests use `TEST_DATABASE_URL`; create it once with `docker compose exec db createdb -U meld meld_test`) |
| `npm run test:unit` / `npm run test:db` | Run parallel unit tests (no Postgres needed) / serial Postgres DB tests |
| `npm run check:changed` | Run docs audit, typecheck, lint, and unit tests scoped to changed workspaces |
| `npm run ui:snap -- <path>` | Capture 1440px desktop and 390px mobile PNGs of running web UI routes |
| `npm run site:screenshots` | Re-capture 2× landing page PNGs from `meld_sandbox` and sync dimensions |
| `npm run site:check` | Verify landing page screenshots are 2× PNGs matching `site/index.html` |
| `npm run docs:build` | Generate the web documentation portal (`site/docs/`) and Ask Meld's feature guide index (`apps/api/src/ai/meld-docs.generated.ts`) from Markdown |
| `npm run docs:check` | Verify `site/docs/` and `apps/api/src/ai/meld-docs.generated.ts` are in sync and all doc links/anchors resolve |
| `npm run docs:audit` | Check working-tree code changes against mapped documentation files |
| `npm run hooks:install` | Enable `.githooks/` (`core.hooksPath`) for doc-sync pre-commit checks |
| `node scripts/meld-mcp.mjs` | Stdio-to-Streamable-HTTP bridge for stdio-only MCP clients (`MELD_URL`, `MELD_MCP_TOKEN`) |

## Releases

The app's version lives in `apps/desktop/package.json` (it's what About Meld shows). To release, bump it there (`npm version 0.2.0 -w apps/desktop --no-git-tag-version`), commit, and push the matching tag: `git tag v0.2.0 && git push origin v0.2.0`. That runs `.github/workflows/release.yml`, which fails if the tag and `package.json` disagree, builds the Apple silicon and Intel `.dmg` files and the Windows installer, and attaches them to a draft GitHub Release with generated notes. The `.dmg` files and the setup `.exe` have no version in their names (`Meld-arm64.dmg`, `Meld-x64.dmg`, `Meld-x64-setup.exe`), so the README and website link to `releases/latest/download/<name>` and never need updating. Check the draft, then publish it. Add the signing secrets listed at the top of that workflow to sign and notarize the builds.

Publishing the release is what ships it to people already running Meld. The workflow also attaches a `.zip` per architecture and a `latest-mac.yml`; the Mac app checks for that file on GitHub shortly after it opens and every 4 hours. Windows copies read `latest.yml` and download the new setup `.exe`, which installs when Meld restarts or quits. When it finds a newer version it shows **Update available** at the top of the window, a dot on What's new in the account menu, an item in the menu bar menu, and one macOS notification. One click downloads the update in the background; **Restart to update** installs it (it also installs the next time Meld quits). Updating the Mac app needs signed builds (the Windows installer updates unsigned). Drafts and pre-releases are never offered.

The release notes are what Meld shows on its **What's new** page (account menu → What's new, Settings → About, or Help → What's New in Meld), so write them for users. An `## Install` section, `**Full Changelog**` lines and the generated "by @someone in …" credits are left out in the app. Markdown headings, lists, `**bold**`, links and `>` quotes all render.

To try the update UI without a release, run `npm run desktop:dev` with `MELD_FAKE_UPDATE=0.9.0`: Meld acts as if 0.9.0 were out, and its download and restart steps are simulated.

The landing page lives in `site/` and the web documentation portal lives in `site/docs/` (generated from `docs/**/*.md`, `PRIVACY.md`, `SECURITY.md`, and `CONTRIBUTING.md`, along with Ask Meld's on-demand feature guide index in `apps/api/src/ai/meld-docs.generated.ts`). Features & Guide is a hub at `docs/features.md` plus per-area pages under `docs/features/` with screenshots in `docs/images/features/`. Both `site/` and generated docs are published to GitHub Pages by `.github/workflows/pages.yml` whenever `site/`, docs, or `scripts/build-docs.mjs` change on `main`. Preview locally with `npm run site:dev` (http://127.0.0.1:8000, docs at http://127.0.0.1:8000/docs/), which automatically rebuilds `site/docs/` and reloads the page whenever Markdown or site files change. Run `npm run docs:build` after editing Markdown docs and `npm run docs:check` to verify everything stays in sync (enforced by CI, `.githooks/pre-commit`, `.claude/settings.json`, and `CLAUDE.md`/`AGENTS.md`). Enable the git pre-commit hook anytime with `npm run hooks:install`. When UI changes affect the landing page, run `npm run site:screenshots` (requires Chrome and `meld_sandbox`) to re-capture 2× Retina PNGs and sync `site/index.html` dimensions, check callout pin positions in `npm run site:dev`, and verify with `npm run site:check`.
