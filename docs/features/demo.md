[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [Features](../features.md) · [Plaid setup](../plaid.md)

# Demo data & tour

Look around without Plaid keys or a passphrase. The demo household is built so every area of Meld has something real to show.

![Demo Home with Worth your attention and Coming up](../images/features/home.png)

## Where to find it

- Welcome screen → **Look around with demo data** (or set `MELD_DEMO=1`)
- While demo data is showing: **Take the tour** on Home
- Switch back later: **Settings → Bank connections → Show demo data** / **Use my accounts**

## The Rivera household

**Start with demo data** shows a made-up household, the Riveras, in its own database (`meld_demo`, or `DEMO_DATABASE_URL`), with two years of history dated up to today.

The household is built so every area has something to show: checking that won't cover the card's autopay after childcare and the phone bill (an urgent alert), a Netflix price rise and a new Headspace charge, Disney+ stopped, eating out pushing food over budget, savings earning 0.4%, 401(k), HSA and Roth IRA room, a fund to harvest for a tax loss, a rollover IRA with no beneficiary, and a will older than the younger child.

It's rebuilt automatically once it's two days old, so due dates and alerts stay current; changes you make to it don't last. Demo connections never call Plaid: **Refresh** just says they're up to date, and **Link account** is replaced by **Connect my banks**.

## The tour

The tour starts after you choose demo data, and from **Take the tour** on Home. It walks through ten questions people ask about their money:

1. What am I worth?
2. Will a payment bounce?
3. Where does my money go?
4. What am I subscribed to?
5. Is my cash earning enough?
6. Am I on track to retire?
7. Am I missing tax savings?
8. Would my family know what to do?
9. Can I just ask?
10. Ready for your own numbers?

Each stop opens the page that answers that question. The tour floats over the page, can be minimized to a pill, and picks up where it left off after a reload.

## Connect your own banks

**Connect my banks** (on Home, in the top bar while demo data is showing, and under **Settings → Bank connections**) opens the guided Plaid sign-up. Saving your keys switches Meld to your own, empty database. See [Linking accounts](accounts.md) and [Connecting your accounts with Plaid](../plaid.md).
