[Meld home page](https://meld-finance.github.io/meld/) · [README](README.md) · [Privacy](PRIVACY.md) · [Features](docs/features.md)

# Security

Meld holds your financial data, so security reports are very welcome.

## Reporting a vulnerability

Please report it privately: the repository's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/meld-finance/meld/security/advisories/new)). Don't open a public issue or PR for it.

Include what's affected, how to reproduce it (with Plaid Sandbox data, never real accounts), and what someone could do with it. Meld has one maintainer, so a reply may take a few days. Once a fix is out, you'll be credited in the advisory unless you'd rather not be.

Only the latest release and `main` get security fixes.

## What Meld is built to protect against

Meld is single-user software for one household on hardware you control. It's designed around these assumptions:

- **It isn't on the public internet.** The API and Postgres listen on `127.0.0.1` only, and Docker publishes Meld's port on `127.0.0.1`. Phone access goes over [Tailscale](https://tailscale.com), so only your own devices can reach it. Don't put Meld behind a public reverse proxy or port forward: its login is a single passphrase.
- **Login** is a single passphrase that issues a bearer token. A passphrase chosen in the app is stored only as a salted scrypt hash (`APP_PASSPHRASE` in `.env` is plain text, so keep `.env` readable only by you). Login attempts are limited to 10 per 15 minutes. Until a passphrase is set (or you choose to go without one), the API serves only first-run setup. The passphrase can be turned off in setup or Settings, which leaves every route open to anyone who can reach Meld, so only do that on a computer you alone use and with phone access off or a tailnet only you are on.
- **Secrets at rest:** Plaid access tokens, uploaded PDFs, full account and policy numbers you enter, and Plaid and Anthropic keys saved from the app are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. The Mac app keeps that key encrypted with the macOS Keychain; Docker reads it from `.env`. Other data (transactions, balances, holdings) is stored unencrypted in Postgres, so use full-disk encryption.
- **Data sent elsewhere** is limited to the services in [PRIVACY.md](PRIVACY.md). Long digit runs are masked before anything goes to an AI model.

Things that are in scope: a way to reach the API or data without the passphrase, getting around the rate limit, reading encrypted values without the key, data sent somewhere PRIVACY.md doesn't say, prompt injection through synced data (merchant names, PDFs) that makes Ask Meld leak or do something it shouldn't, and vulnerabilities in how the Mac app or Docker image is built.

Out of scope: attacks that need you to have already exposed Meld to the internet against this advice, someone with full access to your unlocked computer, and issues in Plaid, Anthropic, Tailscale or ntfy themselves (report those to them).
