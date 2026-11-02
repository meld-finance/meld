#!/bin/sh
# Runs once, when the Postgres volume is first created. POSTGRES_DB (meld) holds
# real data; sandbox data gets its own database so the two never mix.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE DATABASE meld_sandbox;
SQL
