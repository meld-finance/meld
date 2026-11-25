[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](../README.md) · [Docker setup](docker.md) · [Plaid setup](plaid.md) · [Features](features.md)

# Phone access over Tailscale

Meld never opens itself to the public internet. Instead, your phone reaches Meld over [Tailscale](https://tailscale.com), a private encrypted network of only your own devices (free for personal use).

## What you need beforehand

1. **Tailscale installed on this computer** (Mac or Windows) and signed in to your Tailscale account: [download Tailscale](https://tailscale.com/download).
2. **Tailscale installed on your phone** (iOS App Store or Google Play) and signed in to **the same** Tailscale account.
3. **HTTPS certificates enabled** for your tailnet: in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS**, click **Enable HTTPS** (see [Tailscale's HTTPS guide](https://tailscale.com/kb/1153/enabling-https)). This lets Tailscale give your computer a private `https://...ts.net` address with a valid certificate.

## Turn on phone access (Mac & Windows app)

1. Open Meld on your computer and go to **Account menu → Settings → Phone access** (or click **Phone Access…** in the macOS menu bar / Windows notification tray).
2. If Tailscale isn't running or HTTPS isn't enabled yet, Meld tells you what's missing. Fix that step and click **Check again**.
3. Click **Turn on phone access**.
   - The first time you use `tailscale serve`, Tailscale may ask you to enable Serve on your tailnet with a one-click approval link. Follow that link if shown, then click **Turn on phone access** again.
4. Meld shows a **QR code** and a private `https://...ts.net` address.
5. Make sure Tailscale is connected on your phone, scan the QR code with your phone's camera (or type the address in Safari / Chrome), and unlock with your Meld passphrase.
6. **Add to Home Screen** on your phone so Meld opens full-screen like a native app:
   - **iPhone (Safari):** Tap the Share button → **Add to Home Screen**.
   - **Android (Chrome):** Tap the `⋮` menu → **Add to home screen** (or **Install app**).

## Keeping it reachable

- On Mac and Windows, closing Meld's window keeps it running in the menu bar / notification tray so your phone can still connect while your computer is awake. Turn on **Open at Login** from the menu bar / tray icon if you want Meld ready after a restart.
- If you want Meld reachable 24/7 even when your laptop is asleep, run Meld on a home server, NAS, or always-on computer with Docker instead — see the [Docker setup guide](docker.md).

## Troubleshooting

- **Page won't load on your phone:** Check that Tailscale is connected on both your phone and your computer, signed in to the same Tailscale account, and that your computer isn't asleep.
- **Certificate or HTTPS warning:** Confirm **Enable HTTPS** is switched on in the [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns), then click **Check again** in Meld's Phone access card.
- **Docker server:** On a Docker host, Meld runs `127.0.0.1:8080`, so use `tailscale serve --bg 8080` on the host machine (covered in [docs/docker.md](docker.md)).
