[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](../README.md) · [Plaid setup](plaid.md) · [Phone access](phone-access.md) · [Features](features.md)

# Install Meld

Meld is a desktop app for macOS and Windows. It bundles everything it needs (its own Postgres database, the API and the web app), so there's nothing else to install and no command line. You'll want a free [Plaid developer account](plaid.md) to connect banks; you can create it while Meld is open.

## Mac

1. Download Meld for [Apple silicon](https://github.com/meld-finance/meld/releases/latest/download/Meld-arm64.dmg) or [Intel](https://github.com/meld-finance/meld/releases/latest/download/Meld-x64.dmg). Not sure which? Apple menu → **About This Mac**: "Apple M…" is Apple silicon.
2. Open the `.dmg` and drag **Meld** into **Applications**.
3. Open Meld from Applications. The first time, macOS asks: *"Meld" is an app downloaded from the Internet. Are you sure you want to open it?* Click **Open**. This dialog appears for every app you download outside the App Store. Meld is signed and notarized by Apple, so you won't see the "cannot be opened" warning that unsigned apps get, and macOS won't ask again.

Meld's window opens and it puts an icon in the menu bar. Closing the window leaves Meld running there; use the icon to reopen it, turn on **Open at Login**, show the data folder or the log, or **Quit**.

Your data lives in `~/Library/Application Support/Meld`. The keys that encrypt it are in your macOS Keychain (item `Meld`).

## Windows (preview)

Windows 10 or 11, 64-bit Intel/AMD. The Windows app is new and hasn't had much testing yet, so expect rough edges and please [open an issue](https://github.com/meld-finance/meld/issues) if something breaks.

1. [Download the installer](https://github.com/meld-finance/meld/releases/latest/download/Meld-x64-setup.exe) and run it. It installs for your user only, with no admin prompt.
2. The installer isn't code-signed yet, so Windows SmartScreen says *"Windows protected your PC"* the first time. Click **More info**, then **Run anyway**.

Meld opens and puts an icon in the notification area by the clock. Closing the window leaves Meld running there: click the icon to open Meld, or right-click it for **Open at Login**, the data folder, the log and **Quit**.

Your data lives in `%APPDATA%\Meld`. The keys that encrypt it are in Windows Credential Manager (item `Meld`).

## First run

Meld opens on a welcome screen with a picture of where your data goes: your banks connect through Plaid, everything is stored on this computer, and AI is off until you turn it on. Then pick one:

- **Start with demo data.** Meld fills in a made-up household (the Riveras) and starts a short tour of common money questions and where Meld answers them: net worth, an autopay that won't be covered, a subscription price rise, cash earning too little, retirement, tax moves and estate gaps. Nothing to set up and nothing sent anywhere, apart from the demo funds' ticker symbols, which Meld uses to get today's prices from Yahoo Finance. When you're ready, click **Connect my banks** on Home, in the top bar or under **Settings → Bank connections**.
- **Connect my banks.** A guided Plaid sign-up, with a picture of each screen: about 10 minutes, ending with your client ID and production secret. [Plaid setup](plaid.md) has the same steps. Meld then opens on your own accounts; link your banks from **Accounts → Link account**.

There's no passphrase step. Meld's own window always opens straight in. To open Meld in a browser or on your phone, choose a passphrase under **Settings → Passphrase for browsers and phones**, or when you turn on [phone access](phone-access.md).

AI is optional and isn't part of setup either. The first time you open **Ask Meld**, it explains the choice: a model on this computer through [Ollama](https://ollama.com) (free and private, but slower and less reliable), or a cloud model (Claude, ChatGPT through your plan, or Gemini and others through OpenRouter) that sees only what each question needs. Everything else in Meld works without AI.

## Keep it running

Meld syncs your accounts, checks bills and sends alerts while it's running, and your phone can reach it over [phone access](phone-access.md) whenever your computer is awake. You don't need a server for an always-on setup. Run the app on a computer that stays on, such as a Mac mini or a desktop PC:

1. Turn on **Open at Login** from Meld's menu bar or notification-area icon, so it starts again after a restart.
2. Stop the computer from going to sleep:
   - **Mac:** System Settings → **Energy** → turn on **Prevent automatic sleeping when the display is off**. On a MacBook it's under **Battery → Options**, and only applies while plugged in.
   - **Windows:** Settings → System → **Power & battery** → **Screen, sleep & hibernate timeouts** → set sleep when plugged in to **Never**.

Meld starts when you sign in, not when the computer boots, so after a power cut or update it waits until someone logs in. If that matters, or the machine runs Linux or is a NAS (which the desktop app doesn't support), run Meld with [Docker](docker.md) instead.

## Updates

Meld checks GitHub for a new version shortly after it opens and every 4 hours. When one is out, it shows **Update available** at the top of the window and in the menu bar or notification-area menu. One click downloads it in the background; **Restart to update** installs it, or it installs the next time Meld quits.

## Back up

Quit Meld, then copy its data folder (`~/Library/Application Support/Meld` or `%APPDATA%\Meld`). The copy can only be read with the keys in this computer's Keychain or Credential Manager. On a Mac, a Time Machine backup includes the Keychain. Without the keys you'd have to re-link your banks after restoring on another computer.

## Uninstall

Quit Meld, then delete the app (drag it from Applications to the Trash on a Mac; **Settings → Apps** on Windows). Your data folder and the `Meld` Keychain or Credential Manager item stay behind until you delete them too.
