# Builds the Meld image used by docker-compose.yml: the Fastify API, which also serves
# the Expo web export and keeps the API under /api. Migrations run on start.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/

# ---- Web build ----
FROM deps AS web-build
RUN npm ci --workspace @meld/mobile --workspace @meld/shared --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/mobile apps/mobile
WORKDIR /app/apps/mobile
# Same origin: the API is served under /api by the same server.
ENV EXPO_PUBLIC_API_URL=/api EXPO_NO_TELEMETRY=1
RUN npx expo export --platform web --output-dir /web

# ---- App ----
FROM deps AS app
RUN npm ci --workspace @meld/api --workspace @meld/shared --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=web-build /web /app/web
WORKDIR /app/apps/api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8080 WEB_DIR=/app/web MIGRATE_ON_START=1 \
    DOCUMENTS_DIR=/data/documents
RUN mkdir -p /data/documents && chown -R node:node /data
USER node
EXPOSE 8080
# Settings come from the environment, not a .env file.
CMD ["npx", "tsx", "src/index.ts"]
