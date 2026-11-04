# Contributing to Meld

Thanks for helping. Meld is a side project with one maintainer, so small, focused pull requests are the easiest to review and merge.

## Before you start

- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Meld is single-user and local-first on purpose. Changes that send more data to outside services, or add accounts, telemetry or a hosted backend, are unlikely to be accepted.
- Never paste real financial data, Plaid keys or `.env` contents into issues or PRs. Use Plaid Sandbox data for screenshots and repros.

## Running it

Follow **Development setup** in the [README](README.md). Plaid Sandbox (`user_good` / `pass_good`) is enough for nearly all work. For the Mac app, `npm run desktop:dev` runs it from source and `npm run desktop:build` builds `Meld.app` to check the packaged version.

## Before opening a PR

```sh
npm run typecheck
npm test                      # DB tests need TEST_DATABASE_URL (see README)
npm run lint -w @meld/mobile
```

- Schema changes: edit `apps/api/src/db/schema.ts`, then `npm run db:generate` and commit the new migration.
- Shared request/response types live in `packages/shared` as Zod schemas; change them there, not in each app.
- If you change what data leaves the machine, update [PRIVACY.md](PRIVACY.md).

## License

By contributing you agree that your contributions are licensed under the [GNU AGPL v3](LICENSE), the same as the rest of Meld.
