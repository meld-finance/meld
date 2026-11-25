[Meld home page](https://meld-finance.github.io/meld/) · [Docs](https://meld-finance.github.io/meld/docs/) · [README](../README.md) · [Phone access](phone-access.md) · [Plaid setup](plaid.md) · [Features](features.md)

# Self-hosting Meld with Docker

Docker runs Meld on any machine that stays on—a home server, Mac mini, NAS, or Linux box. It starts two containers: Postgres (`db`) and Meld (`meld`), which serves both the web app and the API on `127.0.0.1:8080`.

## Start Meld

You need [Docker](https://docs.docker.com/get-docker/) (with Docker Compose) and Git.

```sh
git clone https://github.com/meld-finance/meld.git && cd meld
./scripts/setup.sh            # creates .env with fresh encryption keys (and optionally your passphrase)
docker compose up -d --build
```

Open `http://localhost:8080` in your browser. Any settings not set in `.env` (passphrase, Plaid keys, AI options) are asked on first run and saved in the `meld-config` Docker volume; values in `.env` always take precedence over settings saved in the app.

## Update

```sh
git pull && docker compose up -d --build --remove-orphans
```

Database migrations run automatically when the container starts.

## Stop

```sh
docker compose down
```

Your database, uploaded documents, and app settings are preserved in Docker volumes (`meld-db`, `meld-documents`, `meld-config`). (`docker compose down -v` deletes those volumes—avoid `-v` unless you want to wipe everything.)

## Back up

```sh
docker compose exec db pg_dump -U meld meld > meld-backup.sql
```

Keep `.env` somewhere safe too: without its `ENCRYPTION_KEY`, encrypted Plaid tokens, documents, and saved settings cannot be decrypted, so you would need to re-link your accounts.

## Change settings

- For anything **not** set in `.env`, change it in **Account menu → Settings** inside the app.
- For anything set in `.env`, edit `.env` and restart the container:

```sh
docker compose up -d
```

## Using Ollama from Docker

If Ollama runs directly on the host machine (outside Docker), set the Ollama address to `http://host.docker.internal:11434` in **Settings → AI** (or `OLLAMA_URL=http://host.docker.internal:11434` in `.env`).

## External agents (MCP)

Turn on **Settings → External agents (MCP)** (persisted encrypted in `/data/config/mcp.json` inside `meld-config`), or set `MCP_ENABLED=1` and a long random `MCP_TOKEN` in `.env`. In Docker, the endpoint is `http://127.0.0.1:8080/api/mcp` (`http://127.0.0.1:${MELD_PORT:-8080}/api/mcp`). Keep `MCP_ALLOW_REMOTE` unset so only local processes on the Docker host can reach it.

## Phone access over Tailscale

Meld only binds to `127.0.0.1:8080`, and its login is a single passphrase, so don't expose it to the public internet. To reach it from your phone:

1. Install [Tailscale](https://tailscale.com/download) on the Docker host and on your phone, signed in to the same Tailscale account, and enable HTTPS certificates in the Tailscale admin console (**DNS → Enable HTTPS**).
2. On the Docker host, run:

```sh
tailscale serve --bg 8080
```

Tailscale will give you a private `https://...ts.net` URL that proxies securely over your tailnet to `127.0.0.1:8080` without exposing Meld to the public internet. See [docs/phone-access.md](phone-access.md) for adding Meld to your phone's home screen.
