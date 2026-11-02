# Builds the two app images used by docker-compose.yml:
#   --target api   Fastify API (runs TypeScript directly with tsx, migrates on start)
#   --target web   Expo web export served by Caddy, which also proxies /api to the API

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/

# ---- API ----
FROM deps AS api
RUN npm ci --workspace @meld/api --workspace @meld/shared --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production API_HOST=0.0.0.0 DOCUMENTS_DIR=/data/documents
RUN mkdir -p /data/documents && chown -R node:node /data
USER node
EXPOSE 4000
# Apply any pending migrations, then start. Settings come from the environment, not a .env file.
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && exec npx tsx src/index.ts"]

# ---- Web build ----
FROM deps AS web-build
RUN npm ci --workspace @meld/mobile --workspace @meld/shared --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/mobile apps/mobile
WORKDIR /app/apps/mobile
# Same-origin API: Caddy forwards /api/* to the API container.
ENV EXPO_PUBLIC_API_URL=/api EXPO_NO_TELEMETRY=1
RUN npx expo export --platform web --output-dir /web

# ---- Web ----
FROM caddy:2-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /web /srv
EXPOSE 8080
