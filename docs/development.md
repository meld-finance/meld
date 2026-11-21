# Development

```
apps/api        Fastify + TypeScript API: Plaid, AI, data (Postgres via Drizzle); also serves the web app under /api
apps/mobile     Expo (expo-router) app → web, iOS, Android
apps/desktop    Electron app for macOS (Windows builds untested): bundled Postgres + the API + the web app, menu bar, Tailscale
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

Open http://localhost:8081 and unlock with `APP_PASSPHRASE`.

If your Postgres volume predates `docker/initdb`, create the sandbox database once with `docker compose exec db createdb -U meld meld_sandbox`.

## Desktop app

- `npm run desktop:dev` opens the Electron app against the API source and the Expo dev server (hot reload on both), with its own Postgres and data in `~/Library/Application Support/Meld Dev`. Stop `npm run dev` first: both use port 4000. Set `MELD_USER_DATA=<folder>` to try a fresh first run.
- `npm run desktop:build` builds `apps/desktop/release/mac-<arch>/Meld.app` in a minute or two, for checking the real thing. `npm run desktop:dist` makes the `.dmg` for this Mac's architecture. For Intel Macs: `cd apps/desktop && node scripts/build.mjs --arch x64 && npx electron-builder --x64`.
- Packaged, the API is one esbuild bundle run in an Electron utility process, Postgres is the [embedded-postgres](https://github.com/leinelissen/embedded-postgres) build thinned to one architecture, and the web app is the same Expo export Docker serves. Logs: menu bar → **Show Log**.
- **Keys.** Meld's encryption key, session secret and Postgres password are one item in the macOS Keychain (Windows: Credential Manager), service `Meld`, account `secrets` (`secrets:<folder>` for other data folders, e.g. `secrets:Meld Dev`). Losing it means re-linking every bank, and Meld refuses to start rather than make new keys over existing data. Builds before this kept them in `secrets.bin`, encrypted with Electron's safeStorage; the first start of a newer build copies them into the Keychain and renames the file `secrets.bin.migrated`.
- **Windows.** `npm run desktop:dist` on a Windows machine makes `Meld-<version>-x64-setup.exe` with Windows Postgres (`@embedded-postgres/windows-x64`). Build each platform on its own OS. Not yet tested on Windows.
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
| `npm run desktop:build` / `npm run desktop:dist` | Build `Meld.app` / the `.dmg` |
| `npm run dev:pull-desktop` | Copy the Mac app's data into dev (`desktop:seed-from-dev` goes the other way, once) |
| `npm run dev` | API + Expo web together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:up` | Start only Postgres (for `npm run dev`) |
| `npm run db:generate` | Create a migration after editing `apps/api/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the sandbox and production databases |
| `npm run typecheck` | Typecheck all packages |
| `npm test` | Run tests (DB tests use `TEST_DATABASE_URL`; create it once with `docker compose exec db createdb -U meld meld_test`) |

## Releases

Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`: it builds the Apple silicon and Intel `.dmg` files (version taken from the tag) and attaches them to a draft GitHub Release with generated notes. Check the draft, then publish it. Add the signing secrets listed at the top of that workflow to sign and notarize the builds.

The landing page lives in `site/` and is published to GitHub Pages by `.github/workflows/pages.yml` whenever `site/` changes on `main`. Preview it with `npm run site:dev` (http://127.0.0.1:8000), which reloads the page whenever a file in `site/` changes.
