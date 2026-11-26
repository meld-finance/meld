[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](README.md) · [Privacy](PRIVACY.md) · [Features](docs/features.md)

# Security

Meld holds your financial data, so security reports are very welcome.

## Reporting a vulnerability

Please report it privately: the repository's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/meld-finance/meld/security/advisories/new)). Don't open a public issue or PR for it.

Include what's affected, how to reproduce it (with Plaid Sandbox data, never real accounts), and what someone could do with it. Meld has one maintainer, so a reply may take a few days. Once a fix is out, you'll be credited in the advisory unless you'd rather not be.

Only the latest release and `main` get security fixes.

## What Meld is built to protect against

Meld is single-user software for one household on hardware you control. It's designed around these assumptions:

- **It isn't on the public internet.** The API and Postgres listen on `127.0.0.1` only, and Docker publishes Meld's port on `127.0.0.1`. Phone access goes over [Tailscale](https://tailscale.com), so only your own devices can reach it. Don't put Meld behind a public reverse proxy or port forward: its login is a single passphrase.
- **Login** is a single passphrase that issues a bearer token. A passphrase chosen in the app is stored only as a salted scrypt hash (`APP_PASSPHRASE` in `.env` is plain text, so keep `.env` readable only by you). Login attempts are limited to 10 per 15 minutes.
- **The desktop app's own window** signs in with a random token the app makes each time it starts (`DESKTOP_TOKEN`), handed only to pages from Meld's own server through the window's preload and never stored. So the window never asks for a passphrase, and on the desktop app a passphrase is only for browsers and phones. Until one is set, every route still needs a login, and only the window has one: a browser on the same computer, or a page trying to reach Meld, gets nothing. Turning on phone access requires a passphrase first. The window can change or remove the passphrase without the old one, since whoever is using it already has the computer. First-run setup on the desktop app also only accepts the window's token.
- **No passphrase at all** (`APP_PASSPHRASE_OFF=1`, or choosing none in Docker's setup) leaves every route open to anyone who can reach Meld, so only do that on a computer you alone use and with phone access off or a tailnet only you are on. Until a passphrase or this choice is made, Docker's API serves only first-run setup.
- **Host names.** Every request must be addressed to `localhost`, an IP address, a single-label name, a `*.local` or `*.ts.net` name, or a name listed in `ALLOWED_HOSTS`. Anything else gets a 403, so a web page can't point a domain it controls at `127.0.0.1` (DNS rebinding) and read Meld's answers as its own.
- **Secrets at rest:** Plaid access tokens, uploaded PDFs, full account and policy numbers you enter, and Plaid, Anthropic and OpenRouter keys saved from the app are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. The Mac app keeps that key encrypted with the macOS Keychain; Docker reads it from `.env`. Other data (transactions, balances, holdings) is stored unencrypted in Postgres, so use full-disk encryption.
- **Data sent elsewhere** is limited to the services in [PRIVACY.md](PRIVACY.md). Long digit runs are masked before anything goes to an AI model.
- **External agents (MCP)** is off by default and strictly read-only (`readOnlyHint: true`). Enabling it in Settings issues a random bearer token (`meld_mcp_…`) stored only as a SHA-256 hash inside `mcp.json` (encrypted with `ENCRYPTION_KEY`), or configured via `MCP_TOKEN` in `.env`. Unlike app UI routes when `APP_PASSPHRASE_OFF=1`, `/mcp` **always** requires the dedicated MCP bearer token (and rejects regular app login JWTs), refuses non-loopback `Host` headers, forwarded/Tailscale headers, and foreign `Origin` headers (unless `MCP_ALLOW_REMOTE=1` is set). Because synced transaction descriptions and security names come from outside banks, avoid connecting an external agent that also holds unattended write, shell, or web-exfiltration tools if you want to minimize indirect prompt-injection risk.

Things that are in scope: a way to reach the API or data without the passphrase or the desktop window's token, getting around the rate limit, reading encrypted values without the key, data sent somewhere PRIVACY.md doesn't say, prompt injection through synced data (merchant names, PDFs) that makes Ask Meld leak or do something it shouldn't, and vulnerabilities in how the Mac app or Docker image is built.

Out of scope: attacks that need you to have already exposed Meld to the internet against this advice, someone with full access to your unlocked computer, and issues in Plaid, Anthropic, Tailscale or ntfy themselves (report those to them).
