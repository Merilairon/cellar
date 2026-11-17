# Deployment (Docker)

## Quick start (direct, http)

```sh
cp .env.example .env   # set SESSION_SECRET: openssl rand -base64 48
docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build
```

`docker-compose.direct.yml` is an explicit opt-in file that publishes the app on `${APP_PORT:-3000}`; nothing is auto-loaded, so the app port is never published by accident. Keep `TRUSTED_PROXIES` empty in this mode. Data lives in the `app-data` volume mounted at `/data` (`DATABASE_PATH=/data/app.db`). Migrations run automatically at app start. Uploads (photos and imported cover images) are written to `/data/uploads` in the same volume; set `UPLOADS_DIR` to change that. If `KEEP_RAW_HTML=true`, raw HTML goes to `/data/import-raw`; set `RAW_HTML_DIR` to change that (default: `import-raw` next to the uploads directory, the v0.3.0/v0.3.1 location). Pruning also cleans files left in that default location after you move `RAW_HTML_DIR`; it never moves them. Import jobs older than `IMPORT_JOB_TTL_DAYS` (default 30; `0` disables pruning) are pruned lazily, together with their raw HTML files; see `docs/data-model.md`. Back up the whole volume. The app refuses to start in production if `SESSION_SECRET` is shorter than 32 characters or a known placeholder.

> **Warning:** if you change `APP_PORT`, set `BASE_URL` to the same port (`APP_PORT=3412` needs `BASE_URL=http://localhost:3412`). Otherwise the origin allowlist rejects every POST with a 403 and `/setup` silently fails. Compose defaults `BASE_URL` from `APP_PORT`, but set it explicitly for any other host name.

Finish `/setup` (first admin) before exposing the host: until then anyone who can reach it can claim the admin account.

## Caddy profile (automatic HTTPS)

Set in `.env`: `SITE_ADDRESS=recipes.example.com`, `BASE_URL=https://recipes.example.com`, `TRUSTED_PROXIES=172.28.0.10` (Caddy's fixed address). Then:

```sh
docker compose --profile caddy up -d --build
```

`docker-compose.yml` alone does not publish the app port; only Caddy exposes 80/443. Do not add `docker-compose.direct.yml` here. DNS must point to the host and ports 80/443 must be reachable for certificate issuance (manual check; not automatable offline).

**Photo upload size limit (v0.4.2).** A photo upload sends the raw image as the request body, up to 10 MiB. Any reverse proxy in front of the app must allow bodies of at least 10 MiB on `POST /api/recipes/:id/photos`; a 1 MB cap (the old Caddy default here) makes every phone photo fail. The bundled `Caddyfile` allows 11 MB for that one route and keeps 1 MB for everything else. That Caddyfile change has not been validated (Caddy was not installed where it was written): run `caddy validate --config Caddyfile --adapter caddyfile` before deploying. The app also sets Next.js `experimental.proxyClientMaxBodySize` to `11mb` (Next 16.4.5); with it the Next proxy layer buffers up to 11 MiB of any request body in memory. `X-Forwarded-*` headers are honored only from `TRUSTED_PROXIES`.

## Backup restore uploads (v0.5.1)

The **Backup** page (`/backup`) restores a backup by uploading it as the raw request body (JSON or zip) to `POST /api/import/backup`. See the README section "Backup and restore". Three things matter for the deployment.

**Body limit on the reverse proxy.** Any proxy in front of the app must allow a body of at least `RESTORE_BODY_MAX` bytes (default 268 435 456, 256 MiB) on `POST /api/import/backup`. The bundled `Caddyfile` has a route for exactly that path with `max_size 270MB`, and keeps 1 MB for everything else. Caddy counts `MB` as 1 000 000 bytes, so the earlier `260MB` refused a 255 MiB upload with 413 (measured with a stub upstream on 2026-11-17; `270MB` accepted it). **Raise the proxy limit together with `RESTORE_BODY_MAX`**: a proxy limit below the app limit makes the proxy refuse the upload first (413 from the proxy, not from the app). A real restore through Caddy and the app together has not been run.

**The Next.js proxy is skipped for this route.** `src/proxy.ts` buffers request bodies in memory and silently truncates them at `proxyClientMaxBodySize` (11 MiB, set in `next.config.ts` for photo uploads); a truncated zip is a corrupt zip. So the `matcher` in `src/proxy.ts` excludes `/api/import/backup` and everything below it. Consequences: the restore routes get no CSP or other security headers from the proxy and no cookie pre-check (the route checks the session and the CSRF origin itself and sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on its JSON answers). Do not raise `proxyClientMaxBodySize` to "fix" restores; every route would then buffer that much.

**Disk space.** A checked upload is written to `RESTORE_DIR` (default `<dir of UPLOADS_DIR>/restore`, `/data/restore` in Docker, inside the `app-data` volume) and stays there until it is applied, discarded or one hour old, whichever comes first; each user has at most one. During a restore of a zip the app also writes the re-encoded photos to the uploads directory. Plan for free space of **about the size of the upload plus the re-encoded photos** (each photo is re-encoded as WebP, at most 1600 px on the long edge, plus a 400 px thumbnail; the disk use of that was not measured). Cleanup is lazy: the staged files are removed by the next restore request, with no background timer, so a file whose owner never came back stays until someone calls a restore route again (after a restart the leftovers are removed once they are an hour old). There is no cap on the total disk used by staged files across users beyond one file per user, and no total upload time limit (only a 30 s stall limit): do not offer restore to accounts you do not trust. Restore is single process like the rest of the app.

## Public links (v0.5.0)

Recipe owners can create public links (`/r/<token>`, see the README section "Sharing and public links"). If you run the instance on the internet, check these before you leave public links on. To switch them off for the whole instance set `PUBLIC_LINKS_ENABLED=false` and restart.

- **Do not publish the app port.** The per-IP limit on `/r/*` (`RATE_LIMIT_PUBLIC_MAX` per `RATE_LIMIT_PUBLIC_WINDOW_SEC`, default 120 per 60 s) believes the right-most `X-Forwarded-For` address that is not in `TRUSTED_PROXIES`. Next.js 16 does not tell the app the real TCP peer, so a client that can reach the app directly can send a new `X-Forwarded-For` on every request and is never limited (security checkpoint finding L1, `docs/tasks/v0.5.0-security-checkpoint.md`: 40 requests with 40 spoofed addresses gave no 429 at a limit of 30). Login and registration limits have the same property. With the Caddy profile the app port is not published; do not add `docker-compose.direct.yml` and do not map port 3000 in a proxy setup of your own. The limit protects CPU, not secrecy: a link holds 128 random bits.
- **Forward the client address.** Your reverse proxy must set `X-Forwarded-For` to the client address and `TRUSTED_PROXIES` must list the proxy. Caddy does this itself. When the client is unknown the limit is skipped.
- **Do not cache `/r/*`.** The app answers every `/r/*` request (200, 404 and 429) with `Cache-Control: no-store` (the 200 and 404 add `private, no-cache, max-age=0, must-revalidate`) so that a revoked link stops working on the next request. A proxy or CDN that caches those paths, or ignores `Cache-Control`, keeps serving a revoked recipe. The bundled `Caddyfile` has no cache. Also keep `Referrer-Policy: no-referrer` as the app sends it for `/r/*`; do not override it with a proxy header rule.
- **The token is in the URL.** It appears in your proxy's access log and in browsers' history. The app itself logs no request URLs. Treat proxy access logs as holding live links.
- **Not tested here.** A real reverse proxy with real client addresses in front of a public link (including `docker compose --profile caddy`) was not run for v0.5.0. The repository ships a Caddy example only; there is no Traefik example, so check any Traefik or other proxy setup yourself against the points above.

## Headless import (optional)

Some recipe pages only exist after JavaScript runs, or refuse plain HTTP clients. The optional `browser` sidecar renders such a page in headless Chromium and hands the DOM back to the app, which runs it through the same sanitize/extract pipeline as any import. It is **off by default**: with `HEADLESS_URL` unset there is no sidecar request and import falls back to paste with a clear message.

Enable it in `.env`:

```sh
HEADLESS_URL=http://browser:3001
HEADLESS_TOKEN=<openssl rand -hex 32>   # required by the sidecar, sent by the app as a bearer token
```

```sh
docker compose --profile headless up -d --build        # add your usual -f / --profile flags
docker compose --profile headless down                 # stops both; the app volume is untouched
```

Without `--profile headless`, `docker compose up` starts exactly the same services as v0.3.1 (`app`, plus `caddy` with its profile).

**Cost.** Image about 1.2 GB on disk. Memory measured on amd64 (cgroup `memory.current`, Docker 29.9.3): about 106 MiB idle after start, about 178 MB after one render of a small public page, peak 195 MB. The limit was raised from 1 GiB to 2 GiB because the adversarial test suite is OOM-killed at 1 GiB (measured, see `docs/tasks/v0.3.2-carryover.md`); heavy real pages and arm64 are not yet measured. The compose limit is `mem_limit: 2g`, `cpus: 1.0`, `pids_limit: 256`, `shm_size: 256m`, no swap inside the container. A 1-2 GB VPS needs swap or a larger plan for the host as a whole (the 2 GiB cap can exceed the host RAM). Leave the profile off on Raspberry Pi and Home Assistant installs; arm64 is not verified.

**Test harness note.** The real-Chromium tests run inside the sidecar container next to the test runner; at 1 GB the 6 MB DOM case was flaky and the abuse suite OOMs, so run them with `--memory 2g --memory-swap 2g` (see `docker/browser/README.md`). The service limit is the same 2 GiB.

**Variables.** App: `HEADLESS_URL`, `HEADLESS_TOKEN` (32+ characters from `A-Za-z0-9+/_=-`, same value on both sides; required whenever `HEADLESS_URL` is set), `HEADLESS_TIMEOUT_MS`. Sidecar: `BIND_ADDR` (IP literal, default `0.0.0.0`), `HEADLESS_ALLOW_NO_TOKEN`. Full table in the README. **Upgrading from v0.3.1:** rebuild and start; migration `0004` applies automatically. **Upgrading the sidecar to v0.4.0:** the entry URL limit is now 2048 characters (it was 2000), matching the app, and a sidecar at capacity answers `busy`. Rebuild it: `docker compose --profile headless build`, then `up -d`. An old sidecar with a new app still works (a busy answer is just reported as unavailable).

**Numbers.** Sidecar image 1.21 GB on disk, app image 437 MB (amd64). Startup time was not measured.

### Isolation, stated honestly

- The `browser` service has no volumes, no published ports and never sees `app-data` or `SESSION_SECRET`. It runs as uid 10001 with a read-only root, `cap_drop: ALL` plus only `SYS_CHROOT`, `no-new-privileges` and the repository's custom seccomp profile (`docker/browser/seccomp.json`, the Docker default plus `clone`, `clone3`, `unshare`, `setns`). Chromium's own sandbox is always on.
- Networks: `headless-link` is `internal: true` and holds only `app` and `browser` (the app calls `http://browser:3001`). `headless-egress` is a normal bridge that holds only `browser` and gives it the internet. The app does not join `headless-egress`.
- **The compose networks do not stop the browser reaching the host or LAN.** An egress bridge routes to the host gateway and LAN, and on `headless-link` the browser container can open `app:3000` at the network level. The control that blocks these is the in-sidecar filtering proxy, which resolves each host once, pins the IP and refuses private, loopback, link-local and metadata addresses (fail closed), backed by the app's own pre-check. The optional snippet below adds a network-layer backstop and is recommended where the LAN is sensitive. It also covers UDP/QUIC, which the proxy does not carry.
- The sidecar executes untrusted JavaScript from any page a logged-in user imports. A Chromium zero-day is the residual risk; keep the image current.
- The sidecar needs outbound TCP 80/443 (and DNS) from the host.

### Optional DOCKER-USER firewall snippet

Drops anything leaving the `headless-egress` subnet toward private ranges, loopback and link-local (including the cloud metadata address). Defense in depth only: nothing depends on it. Run as root; adjust the network name if your project name is not `cellar`.

```sh
SUBNET=$(docker network inspect cellar_headless-egress --format '{{(index .IPAM.Config 0).Subnet}}')
GW=$(docker network inspect cellar_headless-egress --format '{{(index .IPAM.Config 0).Gateway}}')
for dst in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 127.0.0.0/8; do
  iptables -I DOCKER-USER -s "$SUBNET" -d "$dst" -j DROP
done
# Traffic to the host itself arrives via INPUT, not DOCKER-USER:
iptables -I INPUT -s "$SUBNET" -d "$GW" -j DROP
```

The subnet is assigned when the network is created, so re-run the snippet (or persist it with your firewall tooling) after `down` and `up`. IPv6 needs the equivalent `ip6tables` rules if enabled.

### Unsupported hosts and versions

Hosts with `user.max_user_namespaces=0` (or unprivileged user namespaces disabled) are **unsupported**: the Chromium sandbox needs them, the sidecar exits with an `UNSUPPORTED HOST` line and is not run unsandboxed. This is not worked around. Tested: Docker 29.9.3, Compose 5.7.0, linux/amd64. runc version and arm64 results are recorded in `docs/tasks/v0.3.2-spike.md` and CI.

### Upgrading the image

The base image and `playwright-core` are pinned in `docker/browser/Dockerfile` and `package-lock.json`. To upgrade, change the pinned tag and digest, keep `playwright-core` equal to the app's `@playwright/test`, then `docker compose --profile headless build --no-cache browser`.

## Upgrading to v0.4.0

Rebuild and start (`docker compose ... up -d --build`). Migrations `0005_search_tags` (tags, the `recipe_fts` search index with a backfill of every existing recipe) and `0006_fts_defer` apply automatically at app start; no profile, volume or environment change is needed, and there are no new environment variables. Search needs SQLite FTS5, which is part of the `better-sqlite3` build; the app checks for it at start (`assertFts5Available` in `src/instrumentation.ts`) and refuses to run without it. If you use the headless sidecar, rebuild it as described under "Headless import". **Not verified:** a real v0.3.2 Docker volume upgraded through compose to `0006` (the migrations are tested in unit tests on a rebuilt older database only), and the rebuilt sidecar image; see `docs/tasks/v0.4.0-carryover.md`.

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
- `sharp` (cover re-encoding) was added as a dependency. CI runs `require('sharp')` inside the built image for each platform it builds. The CI `arm64` job runs on a native GitHub arm64 runner (QEMU cannot create user namespaces, so it is not used for the sandbox) and re-encodes an image with `sharp` in the app image; it was green in CI run 42354517591 on `release/v0.3.2`. **Still unverified (T18):** that this works on a Raspberry Pi / Home Assistant OS host, and that a cover import works end to end inside Docker on arm64. The v0.3.0 gate ran on amd64 only. Check this before relying on cover images on arm64; imports without a cover do not depend on it.
- Seeding in the image needs confirmation: `docker compose exec app npm run seed -- --yes` (or `SEED_CONFIRM=1`).
