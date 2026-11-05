# Deployment (Docker)

## Quick start (direct, http)

```sh
cp .env.example .env   # set SESSION_SECRET: openssl rand -base64 48
docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build
```

`docker-compose.direct.yml` is an explicit opt-in file that publishes the app on `${APP_PORT:-3000}`; nothing is auto-loaded, so the app port is never published by accident. Keep `TRUSTED_PROXIES` empty in this mode. Data lives in the `app-data` volume mounted at `/data` (`DATABASE_PATH=/data/app.db`). Migrations run automatically at app start. Uploads (imported cover images) are written to `/data/uploads` in the same volume; set `UPLOADS_DIR` to change that. If `KEEP_RAW_HTML=true`, raw HTML goes to `/data/import-raw`. Back up the whole volume. The app refuses to start in production if `SESSION_SECRET` is shorter than 32 characters or a known placeholder.

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

## Import feature notes (v0.3.0)

- The app makes outbound HTTP(S) requests on ports 80 and 443 when a user imports a URL. Allow that egress if you filter outbound traffic. Private and internal addresses are refused by the app itself, not by Docker.
- `IMPORT_ALLOW_LOCAL_FETCH` must stay unset in Docker: it disables that protection and the app refuses to start with it in production.
- `sharp` (cover re-encoding) was added as a dependency. CI runs `require('sharp')` inside the built image for each platform it builds. **Unverified:** that the standalone image includes the sharp native binary for linux/arm64 and works on a Raspberry Pi, and that a cover import works end to end inside Docker on arm64. The v0.3.0 gate ran on amd64 only. Check this before relying on cover images on arm64; imports without a cover do not depend on it.
- Seeding in the image needs confirmation: `docker compose exec app npm run seed -- --yes` (or `SEED_CONFIRM=1`).
