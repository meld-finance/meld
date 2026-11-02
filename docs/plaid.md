# Connecting your accounts with Plaid

Meld pulls balances, transactions, investments and loans from your banks and brokerages through [Plaid](https://plaid.com). You use **your own** Plaid account, so the connection is between you, Plaid and your bank. Meld's author never sees your keys or your data.

Plaid accounts are free to create. Below is how to get one, as of November 2026. Plaid changes its plans from time to time, so check their [docs](https://plaid.com/docs/) if something here doesn't match what you see.

## 1. Sandbox (fake data, to try Meld)

1. Sign up at https://dashboard.plaid.com/signup.
2. Open **Developers → Keys** and copy your **client_id** and **Sandbox secret**.
3. In `.env`, set `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` and `PLAID_ENV=sandbox`.
4. Start Meld, go to **Accounts → Link account**, pick any bank and sign in with `user_good` / `pass_good`.

## 2. Your real accounts (Trial plan)

New Plaid teams in the US and Canada get a free **Trial** plan with real data:

- Up to **10 connections** (Plaid calls them "Items"). One connection is one login at one institution, however many accounts sit behind it; a bank login with checking, savings and a card is one.
- **Removing a connection doesn't give the slot back**, so don't link and unlink to experiment. Use Sandbox for that.
- It includes the products Meld uses: Transactions, Investments and Liabilities.
- Banks that sign you in on their own site (OAuth), such as Chase, Bank of America and Wells Fargo, work on the Trial plan. Some brokerages, Schwab for example, can take a few business days to switch on after you get production access.

To get it:

1. In the Plaid Dashboard, request production access. If asked about your use case, describe it honestly: you're connecting your own accounts to a personal finance app you run yourself.
2. Once approved, copy your **Production secret** from **Developers → Keys**.
3. In `.env`, set `PLAID_PRODUCTION_SECRET` and `PLAID_ENV=production`, then restart Meld (`docker compose up -d`).

Real data goes into its own database (`meld`), separate from sandbox data (`meld_sandbox`), so switching back and forth never mixes them.

**Read Plaid's terms yourself.** When you hold Plaid keys you're Plaid's customer, and their [developer policy](https://plaid.com/developer-policy/) and terms apply to you. Decide for yourself whether your use fits them.

## When a bank needs you to sign in again

Banks expire connections from time to time: some every 6 to 12 months, some once a year. When that happens the account shows **Reconnect** in Meld. Press it and sign in again; your history is kept.

## More than 10 connections?

Plaid's paid plans charge a monthly fee per connection. For a household that outgrows the Trial plan, consolidating logins (one login per institution) usually helps. Support for cheaper alternatives such as [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) may come later.
