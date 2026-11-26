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
3. If you haven't chosen a passphrase yet, Meld asks for one here: your phone unlocks Meld with it (Meld's window on the computer never needs it). Type it twice and click **Turn on phone access**. Meld restarts to save it, then turns phone access on. You can change or remove the passphrase later under **Settings → Passphrase for browsers and phones**; removing it means turning phone access off first.
   - The first time you use `tailscale serve`, Tailscale may ask you to enable Serve on your tailnet with a one-click approval link. Follow that link if shown, then click **Turn on phone access** again.
4. Meld shows a **QR code** and a private `https://...ts.net` address.
5. Make sure Tailscale is connected on your phone, scan the QR code with your phone's camera (or type the address in Safari / Chrome), and unlock with your passphrase.
6. **Add to Home Screen** on your phone so Meld opens full-screen like a native app:
   - **iPhone (Safari):** Tap the Share button → **Add to Home Screen**.
   - **Android (Chrome):** Tap the `⋮` menu → **Add to home screen** (or **Install app**).

## Keeping it reachable

Your phone can reach Meld whenever your computer is awake and Meld is running. Closing Meld's window keeps it running in the menu bar or notification area.

For 24/7 access, run the app on a computer that stays on (a Mac mini or desktop PC is ideal): turn on **Open at Login** from Meld's menu bar or notification-area icon and stop the computer from sleeping. [Keep it running](install.md#keep-it-running) has the exact settings. A laptop that sleeps when you close it takes Meld offline until you open it again.

On Linux or a NAS, or if Meld must start after a reboot without anyone logging in, use [Docker](docker.md) instead.

## Troubleshooting

- **Page won't load on your phone:** Check that Tailscale is connected on both your phone and your computer, signed in to the same Tailscale account, and that your computer isn't asleep.
- **Certificate or HTTPS warning:** Confirm **Enable HTTPS** is switched on in the [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns), then click **Check again** in Meld's Phone access card.
- **"No passphrase is set yet" on your phone:** choose one on the computer under **Settings → Passphrase for browsers and phones**, then reload the page on your phone.
- **Docker server:** On a Docker host, Meld runs `127.0.0.1:8080`, so use `tailscale serve --bg 8080` on the host machine (covered in [docs/docker.md](docker.md)).
