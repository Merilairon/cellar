# Recipe Book

A self-hosted recipe book for you and the people you invite. Next.js 16, SQLite, one container.

This is v0.1: accounts, invites, password recovery, security hardening and Docker packaging. It runs as a single process with a single SQLite file.

## Run locally

**Prerequisites**: Node.js 22 or newer (`.nvmrc` pins 24), npm.

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `SESSION_SECRET` to a random string of at least 32 characters:

```bash
openssl rand -base64 48
```

Start the dev server:

```bash
npm run dev
```

Open <http://localhost:3000>. You are redirected to `/login`; see [First run](#first-run) to create the admin.

The database is created at `DATABASE_PATH` (`./data/app.db` in `.env.example`) and migrations run on app start.

| Command                              | What it does                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Dev server                                                                                                                                                            |
| `npm run build`                      | Production build (standalone output). To run it, see [Run the production build locally](#run-the-production-build-locally)                                           |
| `npm test`                           | Unit tests (Vitest)                                                                                                                                                   |
| `npm run test:e2e`                   | End-to-end tests (Playwright). Builds the app and serves it on port 3100 with a throwaway `data/e2e.db`. If browsers are missing, run `npx playwright install` first. |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript                                                                                                                                                   |

### Run the production build locally

`output: 'standalone'` means `npm start` (`next start`) prints a warning and is not supported. Run the standalone server instead. It does not read `.env`, so export the variables first, and copy the static assets next to it (without them every `/_next/static` file returns 404):

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
set -a; . ./.env; set +a
BASE_URL=http://localhost:3000 PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production node .next/standalone/server.js
```

If you change `PORT`, set `BASE_URL` to the same port (see [Changing the port](#changing-the-port)).

## Run with Docker

**Prerequisites**: Docker with the Compose plugin.

```bash
cp .env.example .env
# set SESSION_SECRET in .env (openssl rand -base64 48)
docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build
```

Open <http://localhost:3000>. Compose refuses to start if `SESSION_SECRET` is unset, and the app refuses to start in production if it is shorter than 32 characters or a known placeholder such as the one in `.env.example`.

#### Changing the port

> **Warning:** if you change `APP_PORT`, you must set `BASE_URL` to the same port, for example `APP_PORT=3412` and `BASE_URL=http://localhost:3412`. Otherwise the origin allowlist rejects every POST with a 403, and the first-run `/setup` form fails without a useful message. Compose defaults `BASE_URL` to `http://localhost:${APP_PORT:-3000}`, but set it explicitly in `.env` for any other host name or when using HTTPS.

`docker-compose.direct.yml` is the opt-in file that publishes the app port; it is not loaded automatically, so a plain `docker compose up` or `--profile caddy` run never exposes the app port by accident. Data lives in the `app-data` volume, mounted at `/data`.

### Caddy profile (automatic HTTPS)

Use this to put the app on a public host name with a Let's Encrypt certificate. Set in `.env`:

```bash
SITE_ADDRESS=recipes.example.com
BASE_URL=https://recipes.example.com
TRUSTED_PROXIES=172.28.0.10
```

`172.28.0.10` is the fixed address Caddy gets on the compose network. DNS must point at the host, and ports 80 and 443 must be reachable. Then start with:

```bash
docker compose --profile caddy up -d --build
```

The app port is **not** published in this mode; only Caddy listens (80, 443). Do not combine this with `docker-compose.direct.yml`: with the app port reachable, `TRUSTED_PROXIES` can be spoofed (see [Known limitations](#known-limitations)).

The app does not send `Strict-Transport-Security`. If you want HSTS, let Caddy add it, for example `header Strict-Transport-Security "max-age=15552000"` inside the site block of `Caddyfile`. Only do this once you are sure the host will stay on HTTPS.

See [docs/deployment.md](docs/deployment.md) for details.

### Multi-arch image

Build for amd64 and arm64 with buildx (cross-building needs QEMU; see [docs/deployment.md](docs/deployment.md)):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t recipe-book:multi .
```

Add `--push` and a registry tag to publish.

### Backup

Back up the `/data` volume (the SQLite database lives in it). With the app stopped (`docker compose stop app`), for example:

```bash
docker run --rm -v recipe-book_app-data:/data -v "$PWD":/backup alpine tar czf /backup/recipe-book-data.tgz -C /data .
```

The volume name is `<compose project>_app-data`; check with `docker volume ls`.

### Troubleshooting

- **Every form submit returns 403, or `/setup` does nothing:** `BASE_URL` does not match the address in your browser. Make the host and port identical (`APP_PORT=3412` needs `BASE_URL=http://localhost:3412`), then run `docker compose ... up -d` again so the container picks it up.
- **`Pool overlaps with other one on this address space` on `up`:** the compose network uses the fixed subnet `172.28.0.0/24` (Caddy is `172.28.0.10`). A second compose project, or any other Docker network, using that range conflicts. Stop the other project or change the `subnet` and `ipv4_address` in `docker-compose.yml` (and `TRUSTED_PROXIES` to match).

## Environment variables

Validated at startup in `src/lib/env.ts`. See `.env.example` for a template.

| Variable                         | Required      | Default                                       | Description                                                                                                                                                                                                     |
| -------------------------------- | ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`                  | no            | `/data/app.db`                                | Path of the SQLite file. The directory is created if missing. Compose sets it to `/data/app.db`; `.env.example` uses `./data/app.db` for local runs.                                                            |
| `SESSION_SECRET`                 | yes           | none                                          | At least 32 characters. In production, known placeholders (`changeme`, `replace-with...`, `your-...`, a single repeated character) are rejected.                                                                |
| `BASE_URL`                       | in production | `http://localhost:3000` (non-production only) | Public origin, for example `https://recipes.example.com`. **Must use the same port you open in the browser (`APP_PORT`); on a mismatch every POST gets 403.** No path, no trailing slash. Used for invite and reset links and the origin allowlist. With `https://`, the CSP also gets `upgrade-insecure-requests`. |
| `TRUSTED_PROXIES`                | no            | empty (trust none)                            | Comma-separated IPs or CIDRs whose `X-Forwarded-*` headers are trusted. With the Caddy profile use `172.28.0.10`.                                                                                               |
| `RATE_LIMIT_LOGIN_MAX`           | no            | `20`                                          | Failed login attempts per client IP per window (successful logins and malformed requests are not counted). Skipped when the client IP is unknown.                                                               |
| `RATE_LIMIT_LOGIN_EMAIL_MAX`     | no            | `10`                                          | Failed login attempts per account email per window (reset on a successful login). Always enforced.                                                                                                              |
| `RATE_LIMIT_LOGIN_WINDOW_SEC`    | no            | `900`                                         | Login window in seconds.                                                                                                                                                                                        |
| `RATE_LIMIT_REGISTER_MAX`        | no            | `10`                                          | Invite registration, reset and setup POSTs per client IP per window. Skipped when the client IP is unknown.                                                                                                     |
| `RATE_LIMIT_REGISTER_WINDOW_SEC` | no            | `3600`                                        | Registration window in seconds.                                                                                                                                                                                 |

**Rate limiting and unknown clients.** Per-IP limits only work when the app can tell clients apart, which needs `TRUSTED_PROXIES` to match your reverse proxy. Without it (the default for direct mode or `npm run dev`) every visitor looks like the same "unknown" client; rather than let a few bad requests lock everybody out, the per-IP limits are then skipped and only the per-email login limit applies. Register and reset links carry unguessable tokens, so they stay safe without a per-IP limit. Counters are in memory and reset on restart.

Docker-only variables read by Compose (not by the app): `APP_PORT` (published host port, default `3000`; `BASE_URL` must use the same port) and `SITE_ADDRESS` (Caddy host name, default `localhost`).

## First run

On a fresh database, open `/setup` (for example <http://localhost:3000/setup>) and create the first admin account with an email, display name and password. After that, sign in at `/login`.

> **Warning:** until the first admin exists, `/setup` is open to anyone who can reach the app, and whoever submits it first becomes the admin. Complete setup before you expose the host to a network or the internet (for example, finish it on `localhost` or before opening ports 80/443).

## Invite users

Signed in as an admin, open **Admin > Users** (`/admin/users`) and create an invite, optionally for a specific email. The app shows an invite link once; send it to the person. The link is single use and expires after 7 days. The person opens it, sets a display name and password, and has a member account.

## Password recovery

An admin can issue a reset link for a user from `/admin/users`. If you are locked out of every admin account, run this on the host:

```bash
docker compose exec app npm run admin:reset -- user@example.com
```

When running locally, use `npm run admin:reset -- user@example.com`. The command prints a one-time reset link (`/reset/<token>`) that expires after 1 hour; opening it sets a new password and signs the user out everywhere. It applies pending migrations first, so it also works on a fresh volume.

Deactivated accounts are not reactivated: the command exits with an error for them.

## Notes

- Text strings live in `messages/` at the repository root (currently `messages/en.json`).
- `src/proxy.ts` is the Next.js 16 name for what used to be `middleware.ts`. It gates unauthenticated requests and sets the security headers (CSP with a per-request nonce, and others).
- The data model is documented in [docs/data-model.md](docs/data-model.md).

## Known limitations

- **Rate limiting is in memory.** Counters reset when the app restarts and are not shared between processes.
- **Single process only.** Because of the in-memory rate limiter and the single SQLite file, run exactly one app instance.
- **`TRUSTED_PROXIES` can be spoofed if the app port is reachable.** Any client that can connect directly from a trusted address can forge `X-Forwarded-For` and evade per-IP limits. Behind Caddy, do not publish the app port (do not add `docker-compose.direct.yml` as shown above).
- **`style-src` allows `'unsafe-inline'`.** Scripts use a per-request nonce, but styles do not.

## License

See [THIRD_PARTY_NOTICE.md](THIRD_PARTY_NOTICE.md) for third-party notices.
