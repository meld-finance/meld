#!/bin/sh
# Creates .env for Meld with fresh secrets, then tells you what to fill in.
# Safe to re-run: it never overwrites a value you've already set.
set -eu

cd "$(dirname "$0")/.."
ENV_FILE=.env

rand_b64() { # 32 random bytes, base64
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 32
  else head -c 32 /dev/urandom | base64 | tr -d '\n'; echo; fi
}
rand_hex() { # URL-safe, for the database password
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; echo; fi
}

current() { # value of KEY in .env, or empty
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

set_value() { # replace KEY=... (or append it), keeping everything else
  key=$1 value=$2 tmp="$ENV_FILE.tmp"
  if grep -q "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE" # rewrite in place so .env keeps its permissions
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

bad_chars() { # characters that .env parsers treat specially
  case $1 in *[\$\\\"\'\#\`]*) return 0 ;; *) return 1 ;; esac
}

fill_if_empty() { # KEY GENERATOR
  if [ -z "$(current "$1")" ]; then set_value "$1" "$($2)"; echo "  generated $1"; fi
}

created=0
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  created=1
  echo "Created $ENV_FILE from .env.example"
fi

echo "Secrets:"
fill_if_empty SESSION_SECRET rand_b64
fill_if_empty ENCRYPTION_KEY rand_b64

# A random database password, but only for a brand-new setup: an existing
# Postgres volume keeps the password it was created with.
if [ "$created" = 1 ]; then
  pw=$(rand_hex)
  set_value POSTGRES_PASSWORD "$pw"
  for key in SANDBOX_DATABASE_URL PRODUCTION_DATABASE_URL TEST_DATABASE_URL; do
    url=$(current "$key")
    [ -n "$url" ] && set_value "$key" "$(printf '%s' "$url" | sed "s#://meld:meld@#://meld:$pw@#")"
  done
  echo "  generated POSTGRES_PASSWORD"
fi

if [ "$(current APP_PASSPHRASE)" = "change-me" ] || [ -z "$(current APP_PASSPHRASE)" ]; then
  if [ -t 0 ]; then
    printf 'Choose the passphrase you will log in with (8+ characters): '
    stty -echo 2>/dev/null || true
    read -r pass
    stty echo 2>/dev/null || true
    echo
    while [ ${#pass} -lt 8 ] || bad_chars "$pass"; do
      printf 'At least 8 characters, without $ \\ quotes, # or backticks: '
      stty -echo 2>/dev/null || true
      read -r pass
      stty echo 2>/dev/null || true
      echo
    done
    set_value APP_PASSPHRASE "$pass"
    echo "  set APP_PASSPHRASE"
  else
    echo "  APP_PASSPHRASE is still 'change-me': edit $ENV_FILE before starting"
  fi
fi

missing=""
[ -z "$(current PLAID_CLIENT_ID)" ] && missing="$missing PLAID_CLIENT_ID"
[ -z "$(current PLAID_SANDBOX_SECRET)" ] && [ -z "$(current PLAID_PRODUCTION_SECRET)" ] && missing="$missing PLAID_SANDBOX_SECRET/PLAID_PRODUCTION_SECRET"

cat <<EOF

Next:
EOF
if [ -n "$missing" ]; then
  echo "  1. Add your Plaid keys to $ENV_FILE:$missing"
  echo "     (free; see docs/plaid.md for signing up and getting real-account access)"
else
  echo "  1. Plaid keys are set."
fi
if [ -z "$(current ANTHROPIC_API_KEY)" ] && [ -z "$(current OLLAMA_URL)" ]; then
  echo "  2. Optional: set ANTHROPIC_API_KEY or OLLAMA_URL in $ENV_FILE for the AI features"
else
  echo "  2. AI is configured."
fi
echo "  3. Start Meld:  docker compose up -d --build"
echo "     then open http://localhost:8080"
