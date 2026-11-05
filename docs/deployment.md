# Deployment (Docker)

## Quick start (direct, http)

```sh
cp .env.example .env   # set SESSION_SECRET: openssl rand -base64 48
docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build
```

`docker-compose.direct.yml` is an explicit opt-in file that publishes the app on `${APP_PORT:-3000}`; nothing is auto-loaded, so the app port is never published by accident. Keep `TRUSTED_PROXIES` empty in this mode. Data lives in the `app-data` volume mounted at `/data` (`DATABASE_PATH=/data/app.db`). Migrations run automatically at app start. The app refuses to start in production if `SESSION_SECRET` is shorter than 32 characters or a known placeholder.

> **Warning:** if you change `APP_PORT`, set `BASE_URL` to the same port (`APP_PORT=3412` needs `BASE_URL=http://localhost:3412`). Otherwise the origin allowlist rejects every POST with a 403 and `/setup` silently fails. Compose defaults `BASE_URL` from `APP_PORT`, but set it explicitly for any other host name.

Finish `/setup` (first admin) before exposing the host: until then anyone who can reach it can claim the admin account.

## Caddy profile (automatic HTTPS)

Set in `.env`: `SITE_ADDRESS=recipes.example.com`, `BASE_URL=https://recipes.example.com`, `TRUSTED_PROXIES=172.28.0.10` (Caddy's fixed address). Then:

```sh
docker compose --profile caddy up -d --build
```

`docker-compose.yml` alone does not publish the app port; only Caddy exposes 80/443. Do not add `docker-compose.direct.yml` here. DNS must point to the host and ports 80/443 must be reachable for certificate issuance (manual check; not automatable offline). `X-Forwarded-*` headers are honored only from `TRUSTED_PROXIES`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every POST returns 403; `/setup` does nothing | `BASE_URL` host or port differs from the address in the browser, commonly after changing `APP_PORT`. Set `BASE_URL` to the same origin and recreate the container. |
| `Pool overlaps with other one on this address space` | The compose network is hard-coded to `172.28.0.0/24` (Caddy `172.28.0.10`) and conflicts with another compose project or Docker network on that range. Stop the other one, or change `subnet`, `ipv4_address` and `TRUSTED_PROXIES` together. |

## Admin password reset

```sh
docker compose exec app npm run admin:reset -- user@example.com
```

Runs `node dist/admin-reset.mjs` (esbuild bundle; the standalone image has no tsx). It applies pending migrations first, so it also works on a fresh volume.

## Multi-arch image (amd64 + arm64)

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t cellar:multi .
```

Add `--push -t registry/name:tag` to publish (CI never pushes). Native modules (`better-sqlite3`, `argon2`) use upstream prebuilt binaries when available; the build stage includes python3/make/g++ so `node-gyp` can compile them otherwise. The runtime stage has no toolchain. Cross-building arm64 on amd64 needs QEMU (`docker run --privileged --rm tonistiigi/binfmt --install arm64`).
