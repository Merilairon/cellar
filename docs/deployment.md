# Deployment (Docker)

## Quick start (direct, http)

```sh
cp .env.example .env   # set SESSION_SECRET: openssl rand -base64 48
docker compose up -d --build
```

Plain `docker compose up` also loads `docker-compose.override.yml`, which publishes the app on `${APP_PORT:-3000}`. Data lives in the `app-data` volume mounted at `/data` (`DATABASE_PATH=/data/app.db`). Migrations run automatically at app start. The app refuses to start in production if `SESSION_SECRET` is shorter than 32 characters or a known placeholder.

## Caddy profile (automatic HTTPS)

Set in `.env`: `SITE_ADDRESS=recipes.example.com`, `BASE_URL=https://recipes.example.com`, `TRUSTED_PROXIES=172.28.0.10` (Caddy's fixed address). Then:

```sh
docker compose -f docker-compose.yml --profile caddy up -d --build
```

Naming `-f docker-compose.yml` skips the override file, so the app port is not published; only Caddy exposes 80/443. DNS must point to the host and ports 80/443 must be reachable for certificate issuance (manual check; not automatable offline). `X-Forwarded-*` headers are honored only from `TRUSTED_PROXIES`.

## Admin password reset

```sh
docker compose exec app npm run admin:reset -- user@example.com
```

Runs `node dist/admin-reset.mjs` (esbuild bundle; the standalone image has no tsx). It applies pending migrations first, so it also works on a fresh volume.

## Multi-arch image (amd64 + arm64)

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t recipe-book:multi .
```

Add `--push -t registry/name:tag` to publish (CI never pushes). Native modules (`better-sqlite3`, `argon2`) use upstream prebuilt binaries when available; the build stage includes python3/make/g++ so `node-gyp` can compile them otherwise. The runtime stage has no toolchain. Cross-building arm64 on amd64 needs QEMU (`docker run --privileged --rm tonistiigi/binfmt --install arm64`).
