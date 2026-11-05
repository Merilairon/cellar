# Milestone 01 — Foundation (v0.1)

**Objective:** A deployable skeleton: Next.js app, SQLite database with migrations, invite-based auth, i18n plumbing, and Docker packaging.

**Technical Context:**
- Stack and layout: see [PROJECT.md](../docs/PROJECT.md). Schema: [data-model.md](../docs/data-model.md) (tables `user`, `session`, `invite` only in this milestone).
- Single container; data in `/data` (`app.db`, `uploads/`).
- Env vars: `DATABASE_PATH` (default `/data/app.db`), `SESSION_SECRET`, `BASE_URL`.

**Requirements:**
1. Initialize a TypeScript (strict) Next.js App Router project with Tailwind, ESLint, Prettier, Vitest, Playwright.
2. Add Drizzle ORM with better-sqlite3; create migration for `user`, `session`, `invite`; run migrations on startup.
3. First-run flow: if no users exist, `/setup` creates the admin account; afterwards `/setup` returns 404.
4. Login/logout with email + password (argon2id), DB-backed sessions, HTTP-only, SameSite=Lax, Secure when HTTPS cookies; CSRF protection on mutating routes.
5. Admin page `/admin/users`: create invite link (expiring token, stored hashed), list users, reset a user's password, deactivate user. The last admin cannot be removed.
6. `/register/:token` lets an invitee set name and password.
7. Route protection middleware: all pages except `/login`, `/setup`, `/register/*`, `/r/*` (later) require a session.
8. Set up `next-intl` with `messages/en.json`; every visible string uses message keys; locale from user profile or default `en`.
9. App shell: header with nav (Recipes, Import, Admin if admin), user menu (profile with `unit_pref`, logout), responsive layout, light/dark theme.
10. `Dockerfile` (multi-stage, non-root) and `docker-compose.yml` with volume `/data` and healthcheck `/api/health`. Also ship an example compose profile with a Caddy reverse proxy providing automatic HTTPS (the instance is internet-exposed).
10e. Multi-arch Docker image (linux/amd64 and linux/arm64) built in CI or by a documented `docker buildx` command; the app must run correctly behind a reverse proxy at a configurable `BASE_URL` (trust `X-Forwarded-*` only from configured proxies), keeping the door open for a Home Assistant add-on later. No native dependency may block arm64 builds (verify argon2 and better-sqlite3 prebuilds or compile steps).
10a. Generic rate-limit helper (`src/lib/security/rate-limit.ts`, SQLite- or memory-backed) applied to login, invite registration, and later import and public routes.
10b. Security headers (CSP, X-Content-Type-Options, frame-ancestors, Referrer-Policy) via middleware from this milestone onward; Secure cookies required when `BASE_URL` is https.
10d. CLI recovery: `docker compose exec app npm run admin:reset -- <email>` prints a one-time password-reset link, so a locked-out admin can recover without email.
10c. Admin user deletion flow: choose to reassign or delete the user's recipes (wired up in M2 once recipes exist); admin-issued password reset link.
11. README: run locally, run with Docker, env vars.

**Acceptance Criteria:**
- `docker compose up` on a clean machine → visit app → create admin → invite a second user → both can log in.
- Restarting the container keeps data.
- Unauthenticated requests to protected routes redirect to `/login`.
- Unit tests for password hashing and invite token expiry; one e2e test for setup → login.

**Instructions for LLM:**
* Implement in the order of the requirements; commit after each numbered item with Conventional Commit messages.
* Keep data access in `src/lib/db/` and auth in `src/lib/auth/`; no raw SQL in route handlers.
* Do not add features outside this list (no recipes yet).
* Never hard-code UI strings; add keys to `messages/en.json`.
* Validate all inputs with zod.
