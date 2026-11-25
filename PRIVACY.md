[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](README.md) · [Security](SECURITY.md) · [Features](docs/features.md)

# Privacy: where your data goes

Meld runs on your own computer. There is no Meld server, no account with the author, no analytics and no telemetry. Your data lives in the Postgres database and the `documents` folder on your machine: with the Mac app, both are in `~/Library/Application Support/Meld` (`%APPDATA%\Meld` on Windows), and its Postgres only listens on `127.0.0.1`.

Meld talks to these outside services only. Each one is optional except Plaid and GitHub's update check.

| Service | When | What's sent |
| --- | --- | --- |
| **Plaid** (with your own keys) | Linking accounts and every sync (every 6 hours, or on **Refresh**) | Your bank sign-in goes to Plaid and your bank through Plaid's own window, never through Meld. Meld receives balances, transactions, holdings, investment activity and loan details. Tapping **Get from bank** on an account's estate screen also fetches that checking or savings account's full number (Plaid Auth); it's kept, encrypted, only if you save it. |
| **GitHub** | The Mac app checks for updates shortly after it opens and every 4 hours; the **What's new** page loads the release notes | Nothing about you or your finances: just requests for Meld's public release list, which GitHub sees coming from your IP address like any download. An update is downloaded from GitHub only when you click **Update**. |
| **Yahoo Finance** | Accounts → Investments → Performance | Ticker symbols only, to fetch daily prices. |
| **Anthropic** (if you add an API key) | Ask Meld with a Claude model | Your question, a short snapshot of balances and profile, and whatever the AI looks up to answer (for example matching transactions, holdings or budgets). |
| | Plan → Insurance → Upload PDF | The **whole PDF** you upload. |
| | Home or vehicle value lookup | The property address, or the vehicle's year, make, model, mileage and ZIP code. |
| | Accounts → Investments → Exposure | Fund tickers and names. |
| **OpenAI** (if you sign in with ChatGPT) | Ask Meld with a ChatGPT model, on your ChatGPT plan | The same as Ask Meld above. Requests are sent with `store: false`. |
| **Ollama** (if you set it up) | Ask Meld with a local model | The same as Ask Meld above, but to Ollama on your own machine or network, so it never leaves your control. |
| **Tailscale** (if you turn on phone access) | While it's on | Your phone reaches Meld over your own tailnet, encrypted end to end between your devices. Tailscale's servers coordinate the connection but can't see Meld's traffic. Off by default. |
| **ntfy** (if you enter a topic URL under Alerts) | Each alert at or above the severity you pick, and **Send test** | The alert's title and message: account and merchant names, amounts and due dates. Anyone who knows the topic name can read a topic on the public ntfy.sh server, so pick a long random one, or run your own ntfy server to keep alerts on your network. Off unless you set it up; alerts otherwise stay in the app. |

**Estate planning** (Plan → Estate) sends nothing anywhere by itself. The family packet PDF is built on your computer and downloaded to it. It lists your accounts, balances, beneficiaries and contacts, plus any full account and policy numbers you enter, so treat it like a bank statement: give it a password, and keep the printout somewhere safe. With a Claude model, Ask Meld can read beneficiary and document names and roles through `get_estate_plan`. Phone numbers, emails, full account and policy numbers, your letter and your logins note are never sent.

Before anything goes to an AI model, runs of 9 or more digits (account, card and policy numbers) are replaced with `••••` and the last 4 digits. Full loan account numbers from Plaid are dropped before storage. PDF extraction only reads the last 4 characters of a policy number; the full one is kept only if you type it in.

Anthropic's API doesn't train on your data by default and keeps it for a limited time for safety reviews; see [Anthropic's privacy center](https://privacy.claude.com) for the current policy. If you'd rather nothing goes to a cloud AI, add no Anthropic key and use Ollama for chat. PDF upload, value lookups and look-through exposure are then turned off.

## What's protected on disk

- Plaid access tokens, full account and policy numbers kept for the family packet, uploaded insurance and estate PDFs, Plaid and Anthropic keys saved from the app, and your ChatGPT sign-in are encrypted (AES-256-GCM) with `ENCRYPTION_KEY`. The Mac app makes that key on first run and keeps it in your macOS Keychain (Windows: Credential Manager); Docker reads it from `.env`. A copy of the data or documents folder can't be opened without it.
- The passphrase you choose in the app is stored only as a salted scrypt hash.
- Everything else (transactions, balances, holdings) is stored unencrypted in the database, protected by your computer's own security. Turn on full-disk encryption (FileVault on macOS, BitLocker on Windows) if you haven't already.
- With Docker, `.env` holds your secrets. `scripts/setup.sh` creates it readable only by you; don't commit or share it.

## Reporting a security problem

Please report it privately through GitHub (the repository's **Security** tab → **Report a vulnerability**) rather than in a public issue. [SECURITY.md](SECURITY.md) has the details.
