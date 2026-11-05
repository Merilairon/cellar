# Cellar

A self-hosted recipe book for you and the people you invite. Next.js 16, SQLite, one container.

This is v0.3.1. It builds on v0.2 (manual recipes with a grid view and a list view), v0.3.0 (importing a recipe from a web address or pasted text) and adds an automatic step-to-ingredient grid mapper for imports. Earlier versions added accounts, invites, password recovery, security hardening and Docker packaging. It runs as a single process with a single SQLite file.

## Features

- **Create, edit and delete recipes by hand.** Ingredients are typed as free-text lines and parsed into quantity, unit, name and note (fractions, ranges, dual units; lines that cannot be parsed are kept as written).
- **Grid view.** Recipes with sections, a split ingredient, and top and bottom banner steps render as a table in which each step column spans the ingredient rows it applies to. Spans are validated: a recipe with invalid spans cannot be saved as a grid (the API returns 422 with field errors).
- **List view.** Every recipe can be shown as a plain list. A recipe whose spans are missing or invalid is a list recipe; **Convert to grid** on the recipe page lets you add spans and switch it.
- **View preference.** Your choice of grid or list is remembered per user in the browser. With no saved choice, a recipe defaults to grid, except on a phone when a section has more than 8 step columns (then list).
- **Phone, tablet and desktop layouts.** Tested at 375, 768 and 1280 px. On a phone the ingredient column stays fixed, a scroll cue shows that the grid scrolls sideways, and tapping a step opens it in a bottom sheet.
- **Sharing and copies.** The owner (or an admin) can share a recipe read-only with all signed-in users. Another user can save an independent private copy.
- **User deletion.** When an admin deletes a user, they choose to delete that user's recipes or reassign them to another active user.
- **Recipe import (v0.3.0) with automatic grid mapping (v0.3.1).** Import a recipe from a web address or from pasted text, review and edit it, then save it. Cellar proposes which ingredients each step uses and shows a grid preview. See [Import a recipe](#import-a-recipe).
- **Sample recipes.** `npm run seed` adds two self-written samples (see [Sample data](#sample-data)).

Not yet available: pages that need JavaScript to show the recipe (planned v0.3.2), search and tags, unit conversion and scaling, a photo gallery, notes and ratings, public links, and the drag-and-drop grid editor.

## Routes

| Route               | What it shows                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/recipes`          | Your recipes and recipes shared with you. Shows an empty state with calls to action when there are none.                                                       |
| `/recipes/new`      | Form to create a recipe.                                                                                                                                       |
| `/recipes/:id`      | A recipe in grid or list view, with a toggle. The owner and admins see edit, delete and share controls; other users see a read-only view with **Save a copy**. |
| `/import`           | Import a recipe from a web address or pasted text (see [Import a recipe](#import-a-recipe)).                                                                   |
| `/import/:id`       | Review screen for an import: edit the draft, then save or discard.                                                                                             |
| `/recipes/:id/edit` | Form to edit a recipe you own (admins can edit any recipe). Saving replaces the recipe's sections, ingredients and steps.                                      |

The JSON API lives under `/api/recipes` (`/api/recipes`, `/api/recipes/:id`, `/api/recipes/:id/copy`, `/api/recipes/:id/visibility`). See [docs/data-model.md](docs/data-model.md).

## Import a recipe

Open **Import** (`/import`). There are two ways in.

**From a web address.** Enter the address of a recipe page and choose **Import recipe**. Cellar fetches the page and reads the Schema.org `Recipe` data (JSON-LD) that most recipe sites publish. Only pages that contain that data in their static HTML can be read.

**Paste the recipe.** Use the **Paste the recipe** tab when a site blocks the fetch or has no readable data. You can paste either:

- the page's HTML source (or just its JSON-LD block), which goes through the same reader as a fetched page, or
- plain recipe text. The first non-empty line is the title; a line reading `Ingredients` starts the ingredients (one per line), and a line reading `Instructions`, `Directions`, `Method` or `Steps` starts the steps. Without those headings the import fails with `no_recipe`.

Pasted text is limited to 500,000 characters. A paste import makes no network request.

Either way you land on a review screen. Everything is editable, tags found on the page are shown but not saved yet, and a banner appears when you already have a recipe from the same address (you can still choose **Import anyway**). Nothing is written to your recipes until you press **Save imported recipe**. A failed import never creates a recipe. If **Include the cover image** is checked, the image is downloaded when you save, re-encoded to WebP at up to 1600 px with metadata removed, and stored under the uploads directory. The cover is not displayed in the app yet (planned with the media work in v0.4.2).

### Automatic grid mapping

After the recipe is read, Cellar tries to work out which ingredients each step uses, so the recipe can be saved as a grid instead of a plain list. It does this with fixed rules on your server: it matches ingredient names in the step text (singular and plural, a small synonym list, parentheticals ignored), orders the ingredient rows by first use, and gives each step the rows combined so far. Steps before the first ingredient ("Preheat the oven") become top banners, trailing steps with no new ingredient become bottom banners, section headings ("For the frosting") start new sections, and an ingredient used in two steps ("half the sugar now") is split into two rows when the amounts can be worked out. Nothing is sent to an AI service. The step wording is read in English only.

Every proposal gets a match score from 0 to 1 and a level:

| Level                         | Score              | What you see on the review screen                                                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| High, "Good match"            | 0.70 and above     | The grid is applied and the screen opens with **Grid** selected, with a grid preview above the form.                      |
| Medium, "Check the mapping"   | 0.40 to below 0.70 | The screen opens in **List** (page order, no row ranges). **Preview as grid** applies the proposal so you can look at it. |
| Low, "Could not map reliably" | below 0.40         | The screen opens in **List**. **Try the grid anyway** is available but secondary.                                         |

The badge is text plus an icon, and **Why this score** lists the reasons (for example an ingredient that no step mentions, or a name such as "sugar" that could mean two ingredients). If the mapper could not run at all (too long, too many sections, or a failed check), there is no badge and the screen behaves as in v0.3.0.

To correct a mapping, change the ingredient row numbers (first and last row) in a step below the preview; the preview updates as you type. Do not reorder the ingredient lines, change the numbers instead. **Reset to proposal** restores the suggestion and **Use list view instead** goes back to the page order. Both ask before replacing edits to ingredients and steps; title and other details are kept. The score describes the proposal, not your edits.

Saving as a grid requires every step to have a valid row range; otherwise the API refuses it and the recipe stays a list. List view is always available: choose it and save, and the recipe is stored exactly as imported. An imported recipe saved as a list can be converted later with **Convert to grid** on its page.

Limits: the mapper works on at most 200 ingredients and 100 steps (anything longer is cut, with a note), at most 6 sections, and a fixed amount of work per recipe. A proposal that is too large to keep with the draft is dropped. These limits keep untrusted text from tying up the server.

Known weaknesses: spelling variants between the ingredient list and the steps ("yoghurt" and "yogurt"), ingredient names that are also cooking verbs, recipes that run two parallel preparations, and any language other than English. Such recipes usually end at medium or low and stay in list view, but a high score is still a guess: always look at the preview.

### Error codes

When an import fails, the API still answers 200 with `status: "failed"` and one of these codes, and the page offers the paste fallback.

| Code              | Meaning                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `invalid_url`     | Not an http or https address, contains a username or password, or uses a port other than 80 or 443.                          |
| `private_address` | The host resolves to a private, loopback, link-local or otherwise internal address, at the first request or at any redirect. |
| `blocked`         | The site answered 403 or 429, or showed a bot wall.                                                                          |
| `timeout`         | The whole fetch, including redirects, took longer than 10 seconds.                                                           |
| `too_large`       | The response exceeded 5 MB.                                                                                                  |
| `fetch_failed`    | DNS failure, connection error, a non-HTML content type, or a server error.                                                   |
| `no_recipe`       | The page was fetched but no usable recipe (title, at least one ingredient and one step) was found.                           |

Requests that are malformed are rejected with HTTP 400 (invalid JSON), 401, 403 (origin check), 415 (not JSON) or 422 (validation). Exceeding the rate limit returns 429 with a `Retry-After` header.

### Limits

| Limit                | Value                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Response size        | 5 MB, counted on streamed bytes                                                                                           |
| Total time per fetch | 10 seconds, including redirects                                                                                           |
| Ports                | 80 and 443 only                                                                                                           |
| Redirects            | 5, each one re-validated                                                                                                  |
| Pasted text          | 500,000 characters                                                                                                        |
| Rate limit           | `RATE_LIMIT_IMPORT_MAX` imports (default 20) per user per `RATE_LIMIT_IMPORT_WINDOW_SEC` (default 3600 s); failures count |

### How the fetch is restricted (SSRF guard)

Because the instance may be internet-exposed, the fetcher in `src/lib/import/safe-fetch.ts` is the only code that talks to the network for imports. It resolves the host once, rejects every resolved address in private, loopback, link-local (including cloud metadata), CGNAT, multicast and reserved ranges (IPv4 and IPv6, including mapped forms), and connects to the validated address so DNS cannot change between check and connect. Redirects are followed manually. The tests use an injected resolver and transport.

What this has not been tested against: a real network. TLS certificate and SNI handling with the pinned address is covered by the code design but unverified against live sites (see [docs/tasks/v0.3.0-carryover.md](docs/tasks/v0.3.0-carryover.md)).

### Stored data

- The imported draft is kept in the `import_job` table (`draft_json`) and is not pruned automatically.
- Raw HTML is **not** stored unless `KEEP_RAW_HTML=true`. When enabled, files are written to `import-raw/` next to the uploads directory and are never deleted automatically.
- Covers are stored in the uploads directory (`UPLOADS_DIR`; `/data/uploads` in Docker, inside the `app-data` volume, so the [backup](#backup) covers them).
- `source_url` is stored in a normalized form (host lowercased, fragment, default port and tracking parameters removed, query parameters sorted, trailing slash removed) with the scheme you entered, so an `http`-only site keeps a working link. For the duplicate warning, `http` and `https` are treated as equal.
- The mapping proposal is part of the draft in `draft_json`; no new table or column was added in v0.3.1.

### Import fixture report

`npm run test:import` runs the import pipeline offline (a fake fetcher, no network) over the 44 hand-written fixtures in `tests/fixtures/import/` and prints a table and a success rate. It currently reports 34 of 34 valid drafts (100 percent, target 85 percent), 5 of 5 deliberate rejections, and 5 out-of-slice pages.

What the 100 percent means: every fixture that a static JSON-LD reader should handle produces a draft that passes the recipe schema, and the pages that must be rejected are rejected. What it does not mean: that 100 percent of real recipe sites import. The fixtures are small hand-written pages written for this reader, so they cannot predict real-world markup. The 5 out-of-slice pages (3 JavaScript-only, 2 microdata-only) are excluded from the rate by definition and currently produce `no_recipe`. Expect a lower rate on real sites; the report is a regression guard, not a coverage measurement.

### Mapper accuracy report

`npm run test:mapper` runs the mapper offline over the hand-written fixtures in `tests/fixtures/mapper/` (65 files) plus five references derived from the sample recipes, and prints a per-fixture table, calibration buckets and pass/fail gates. `npm run test:import` prints the same section. It exits 1 when a gate fails. The last run on this branch: references 5 of 5 exact, clean set 27 of 27 exact (114 of 114 step spans), hard set 23 of 25 exact (31 hard fixtures, 12 of them added after the code review as adversarial cases), 0 recipes wrong at a score of 0.70 or more, negatives 6 of 6 ended as list or no proposal. Any `hard` fixture that misses its stated expectation fails CI unless it carries a `known_miss` reason.

What the numbers mean: the fixtures were written by the same people who wrote the mapper, so the clean set at 100 percent is a regression guard, not an accuracy estimate. The hard set is the honest signal: it holds the ambiguous cases, and the two it gets wrong (a "yoghurt" versus "yogurt" spelling difference, and steps with no recognisable verbs) both score below 0.70, which is the behaviour we want; a third, `basil leaves` not matching "the basil", also scores 0.69 and is listed as a known miss. The 12 added fixtures were written from general cooking-writing shapes without tuning, and the first run exposed one confident-wrong case (a trailing step such as "Finish with the remaining butter" was treated as a banner), which was fixed in the mapper. The "no confident wrong answer" gate is only as strong as the fixtures. The mapper has not been measured on real recipe pages. Expect real pages to score lower and to need correction more often.

Imports do not use any AI or LLM service.

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

> **Dev database note (v0.2).** If your local dev database already applied the earlier, unreleased `0001` migration from a v0.2 work-in-progress branch, it no longer matches the released migrations and must be reset: stop the dev server and delete the file at `DATABASE_PATH` (`./data/app.db`, plus any `app.db-wal` and `app.db-shm` next to it), then start again to recreate it (and create the admin again at `/setup`). Databases created by v0.1 (including Docker volumes) need nothing: migrations `0001` and later apply automatically on start.

| Command                              | What it does                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Dev server                                                                                                                                                                                                                                                                            |
| `npm run build`                      | Production build (standalone output). To run it, see [Run the production build locally](#run-the-production-build-locally)                                                                                                                                                            |
| `npm test`                           | Unit tests (Vitest)                                                                                                                                                                                                                                                                   |
| `npm run test:e2e`                   | End-to-end tests (Playwright), including the visual and accessibility specs. Builds the app and serves it on port 3100 with a throwaway `data/e2e.db`. If browsers are missing, run `npx playwright install chromium` first. See [Visual end-to-end tests](#visual-end-to-end-tests). |
| `npm run test:import`                | Import fixture report: runs the pipeline offline over `tests/fixtures/import/` and prints the success rate (exits 1 below 85 percent). See the README in that folder.                                                                                                                 |
| `npm run test:mapper`                | Auto-mapper accuracy report over `tests/fixtures/mapper/` (exits 1 when a gate fails). See [Mapper accuracy report](#mapper-accuracy-report).                                                                                                                                         |
| `npm run seed`                       | Insert the two sample recipes. Dev and demo only; see [Sample data](#sample-data).                                                                                                                                                                                                    |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript                                                                                                                                                                                                                                                                   |

### Sample data

`npm run seed` is a demo tool: it inserts sample recipes into the real database that `DATABASE_PATH` points at (the same one the app uses), owned by an actual account. Do not run it against a database holding data you want kept clean. It inserts two self-written sample recipes for demos and development: _Mocha Skillet Cookie_ (one section) and _Vanilla Cake with Frosting_ (two sections, a split ingredient and a bottom banner). Both open in grid view.

The seed needs an existing user to own the recipes. Create the first admin at `/setup` first (see [First run](#first-run)). Without `--user` it uses the oldest active admin; with `--user` it uses that active account. If no matching user exists, it prints an error and exits with code 1. It is safe to run twice: a sample whose title the owner already has is skipped.

The script reads its settings from the environment and does not load `.env` itself, so export them first (it needs `SESSION_SECRET` and uses `DATABASE_PATH`):

```bash
set -a; . ./.env; set +a
npm run seed
npm run seed -- --user member@example.com
```

Example output:

```
created: Mocha Skillet Cookie (owner admin@example.com)
created: Vanilla Cake with Frosting (owner admin@example.com)
```

**Docker:** the image ships the seed as an esbuild bundle (`dist/seed.mjs`) and maps it like `admin:reset`, so this works against a running instance, after the first admin exists:

```bash
docker compose exec app npm run seed -- --yes
docker compose exec app npm run seed -- --user member@example.com --yes
```

**Production guard:** when `NODE_ENV=production` (always the case in the Docker image) the seed refuses to run, naming the database it would write to, unless you pass `--yes` or set `SEED_CONFIRM=1`.

It opens the same SQLite file as the app (WAL mode), so the app does not need to be stopped and no database file needs to be copied around.

### Visual end-to-end tests

`tests/e2e/recipes-visual.spec.ts` compares screenshots of both sample recipes at 375, 768 and 1280 px (plus dark theme and the phone bottom sheet) with the PNG baselines in `tests/e2e/__screenshots__/`. `tests/e2e/recipes-a11y.spec.ts` runs axe-core and keyboard checks on the grid.

```bash
npx playwright install chromium   # once
npm run test:e2e                  # everything
npx playwright test recipes-visual
```

**The baselines are Linux x86_64 Chromium only** (file names end in `-chromium-linux`). Font rendering differs on macOS, Windows and arm64, so the visual specs fail there for reasons unrelated to your change. Run them on Linux x86_64, or in CI.

To regenerate the baselines after an intentional UI change, run this on Linux x86_64:

```bash
npx playwright test recipes-visual --update-snapshots
```

Review every changed PNG by eye before you commit it.

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
docker buildx build --platform linux/amd64,linux/arm64 -t cellar:multi .
```

Add `--push` and a registry tag to publish.

### Backup

Back up the `/data` volume. The SQLite database and, since v0.3.0, the uploads directory (`/data/uploads`, imported covers) live in it. With the app stopped (`docker compose stop app`), for example:

```bash
docker run --rm -v cellar_app-data:/data -v "$PWD":/backup alpine tar czf /backup/cellar-data.tgz -C /data .
```

The volume name is `<compose project>_app-data`; check with `docker volume ls`.

### Troubleshooting

- **Every form submit returns 403, or `/setup` does nothing:** `BASE_URL` does not match the address in your browser. Make the host and port identical (`APP_PORT=3412` needs `BASE_URL=http://localhost:3412`), then run `docker compose ... up -d` again so the container picks it up.
- **`Pool overlaps with other one on this address space` on `up`:** the compose network uses the fixed subnet `172.28.0.0/24` (Caddy is `172.28.0.10`). A second compose project, or any other Docker network, using that range conflicts. Stop the other project or change the `subnet` and `ipv4_address` in `docker-compose.yml` (and `TRUSTED_PROXIES` to match).

## Environment variables

Validated at startup in `src/lib/env.ts`. See `.env.example` for a template.

| Variable                         | Required      | Default                                       | Description                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`                  | no            | `/data/app.db`                                | Path of the SQLite file. The directory is created if missing. Compose sets it to `/data/app.db`; `.env.example` uses `./data/app.db` for local runs.                                                                                                                                                                |
| `SESSION_SECRET`                 | yes           | none                                          | At least 32 characters. In production, known placeholders (`changeme`, `replace-with...`, `your-...`, a single repeated character) are rejected.                                                                                                                                                                    |
| `BASE_URL`                       | in production | `http://localhost:3000` (non-production only) | Public origin, for example `https://recipes.example.com`. **Must use the same port you open in the browser (`APP_PORT`); on a mismatch every POST gets 403.** No path, no trailing slash. Used for invite and reset links and the origin allowlist. With `https://`, the CSP also gets `upgrade-insecure-requests`. |
| `TRUSTED_PROXIES`                | no            | empty (trust none)                            | Comma-separated IPs or CIDRs whose `X-Forwarded-*` headers are trusted. With the Caddy profile use `172.28.0.10`.                                                                                                                                                                                                   |
| `RATE_LIMIT_LOGIN_MAX`           | no            | `20`                                          | Failed login attempts per client IP per window (successful logins and malformed requests are not counted). Skipped when the client IP is unknown.                                                                                                                                                                   |
| `RATE_LIMIT_LOGIN_EMAIL_MAX`     | no            | `10`                                          | Failed login attempts per account email per window (reset on a successful login). Always enforced.                                                                                                                                                                                                                  |
| `RATE_LIMIT_LOGIN_WINDOW_SEC`    | no            | `900`                                         | Login window in seconds.                                                                                                                                                                                                                                                                                            |
| `RATE_LIMIT_REGISTER_MAX`        | no            | `10`                                          | Invite registration, reset and setup POSTs per client IP per window. Skipped when the client IP is unknown.                                                                                                                                                                                                         |
| `RATE_LIMIT_REGISTER_WINDOW_SEC` | no            | `3600`                                        | Registration window in seconds.                                                                                                                                                                                                                                                                                     |
| `RATE_LIMIT_IMPORT_MAX`          | no            | `20`                                          | URL/paste imports (`POST /api/import`) per user per window; every attempt counts, including failures.                                                                                                                                                                                                               |
| `RATE_LIMIT_IMPORT_WINDOW_SEC`   | no            | `3600`                                        | Import window in seconds.                                                                                                                                                                                                                                                                                           |
| `KEEP_RAW_HTML`                  | no            | `false`                                       | When `true`, fetched or pasted HTML is kept at `<uploads dir>/../import-raw/<job id>.html` (mode 0600). Off by default (nothing is written). Kept files are never deleted automatically.                                                                                                                            |
| `UPLOADS_DIR`                    | no            | `<dir of DATABASE_PATH>/uploads`              | Where recipe photos (imported cover images) are stored. `/data/uploads` in Docker.                                                                                                                                                                                                                                  |
| `IMPORT_ALLOW_LOCAL_FETCH`       | no            | `false`                                       | Development and tests only: lets the importer fetch private addresses and non-80/443 ports (local fixture server). **Disables the SSRF guard; startup fails if set in production.**                                                                                                                                 |

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

- **Import covers only.** Cover images are stored but not displayed in the UI until v0.4.2. The automatic grid mapping is a proposal measured only on hand-written fixtures, works for English only, and there is no drag-and-drop grid editor until v0.4.1 (correct a mapping by editing row numbers). JavaScript-only pages cannot be imported until v0.3.2, and microdata-only pages are not read (the microdata extractor was not built in v0.3.1).
- **Raw HTML and import drafts are never pruned.** See [Import a recipe](#import-a-recipe).
- **Rate limiting is in memory.** Counters reset when the app restarts and are not shared between processes.
- **Single process only.** Because of the in-memory rate limiter and the single SQLite file, run exactly one app instance.
- **`TRUSTED_PROXIES` can be spoofed if the app port is reachable.** Any client that can connect directly from a trusted address can forge `X-Forwarded-For` and evade per-IP limits. Behind Caddy, do not publish the app port (do not add `docker-compose.direct.yml` as shown above).
- **`style-src` allows `'unsafe-inline'`.** Scripts use a per-request nonce, but styles do not.

## License

See [THIRD_PARTY_NOTICE.md](THIRD_PARTY_NOTICE.md) for third-party notices.
