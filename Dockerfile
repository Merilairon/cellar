# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim

# ---- deps: install with a compiler toolchain as fallback if a native
# prebuild (better-sqlite3, argon2) is not available for the target arch.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build
FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build && npm run build:admin-reset

# ---- runtime: no toolchain, non-root
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.db
WORKDIR /app
RUN mkdir -p /data && chown node:node /data /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/dist/admin-reset.mjs ./dist/admin-reset.mjs
# Standalone has no tsx or build tooling: map the CLI to the esbuild bundle so
# `npm run admin:reset -- <email>` works inside the container.
RUN printf '{"name":"cellar","private":true,"scripts":{"admin:reset":"node dist/admin-reset.mjs"}}\n' > package.json \
 && chown node:node package.json
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
