[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [Features](../features.md) · [Privacy](../../PRIVACY.md) · [Security](../../SECURITY.md)

# External agents (MCP)

For advanced workflows, Meld can expose your financial data as a read-only **Model Context Protocol (MCP)** server so external agents (such as Claude Code, Cursor, Codex, or Claude Desktop) can answer questions directly.

## Where to find it

- **Settings → External agents (MCP)** — enable, copy token, client configs
- Docker/headless: `MCP_ENABLED=1` and `MCP_TOKEN` in `.env`

## Off by default

Turn it on in **Settings → External agents (MCP)** (no restart needed). Enabling generates a dedicated bearer token (`meld_mcp_…`) shown once—Meld keeps only a SHA-256 hash—or set `MCP_ENABLED=1` and `MCP_TOKEN` in `.env` for Docker/headless installs.

## Endpoint & clients

Served over Streamable HTTP at `/api/mcp` in the desktop app and Docker (or `/mcp` in `npm run dev`). **Settings → External agents (MCP)** gives copy-pasteable configs for **Claude Code**, **Cursor / HTTP JSON**, and the thin stdio bridge (`scripts/meld-mcp.mjs`) for stdio-only clients.

## What's exposed (read-only)

- **Tools:** All 22 read-only tools from Ask Meld (`get_financial_overview`, `get_accounts`, `get_net_worth`, `get_holdings`, `get_cashflow`, `search_transactions`, `get_tax_plan`, `get_retirement_plan`, `get_estate_plan`, `get_recurring`, `get_cash_plan`, `get_insurance_policies`, `get_equity_grants`, `get_meld_docs`, etc.), marked `readOnlyHint: true`.
- **Resources:** `meld://overview` (live compact summary), `meld://conventions`, `meld://docs/retirement`, `meld://docs/tax`, and `meld://docs/recurring` for progressive documentation loading.
- **Prompts:** `financial-checkup`, `spending-review`, `tax-plan-review`, and `retirement-checkup`.

## Security

Restricted to localhost (`127.0.0.1`/`localhost`) by default even when Tailscale phone access is on (override with `MCP_ALLOW_REMOTE=1`), always requires the dedicated MCP bearer token even when passphrase login is turned off, and applies the same digit masking and privacy boundaries as Ask Meld. See [PRIVACY.md](../../PRIVACY.md) and [SECURITY.md](../../SECURITY.md).

## Related

- [Ask Meld](ask-meld.md) — same tools inside the app
