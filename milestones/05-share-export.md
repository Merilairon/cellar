# Milestone 05 — Share & Export (v1.0)

**Objective:** Finish the MVP: per-recipe visibility with public read-only links, a print-friendly grid view, JSON backup/restore, and release hardening.

**Technical Context:**
- Fields `recipe.visibility` (`private|users`) and `recipe.share_token` (independent public link) exist from M2; copy and visibility endpoints too.
- Backup format: [data-model.md](../docs/data-model.md) §6.
- Release checklist: [RELEASE_PLAN.md](../docs/RELEASE_PLAN.md).

**Requirements:**
1. **Visibility enforcement:** central `canView(user, recipe)` / `canEdit(user, recipe)` helpers used by every query and route (recipes, photos, notes, search, export). Tests for every combination (owner, other member, admin, anonymous).
2. **Share dialog** on the recipe page: choose Private or All users (read-only), and separately toggle a public link; generate a 128-bit random token; copy-link button; **Revoke/rotate** link; turning the link off clears the token. Env `PUBLIC_LINKS_ENABLED` (default `true`) lets the admin disable public links instance-wide. Making an imported, unedited recipe public shows a copyright/attribution warning, and public pages show the source banner.
3. **Public page** `/r/:token`: read-only grid/list view (unit toggle and scaling allowed), source attribution, no private/shared notes, ratings, or editing controls; `noindex` meta and `Referrer-Policy: no-referrer`; uniform 404 for invalid/revoked tokens; rate limit on the route.
4. **Print view:** print stylesheet and **Print** button; the grid fits one page (landscape hint), preserves borders and spans, hides navigation and controls, shows title, servings, source, and notes optionally.
5. **JSON export:** `GET /api/export` (member: own recipes; admin: option for all); includes ingredients, steps/spans, tags, notes, ratings; photos exported as a zip with relative paths (`/api/export?photos=1`).
6. **JSON restore:** upload backup → validate schema/version → preview counts and conflicts → import with strategy skip/rename duplicates; transaction per recipe; clear error on version mismatch.
7. **Hardening** (headers and rate limiting exist since M1; verify and extend): public-route rate limit, upload path traversal tests, dependency audit, structured logs, `/api/health`.
8. **Docs:** README sections for configuration, backup/restore (volume copy and JSON), upgrades, and reverse proxy (Caddy/Traefik example).
9. Run the v1.0 checklist in RELEASE_PLAN.md and fix findings.

**Acceptance Criteria:**
- Anonymous user can open a public link and nothing else; revoking the link makes it 404 immediately.
- Printing the sample recipe produces a single page with the grid intact.
- Export from instance A and restore into a fresh instance B yields identical recipes (grid spans included).
- Authorization test suite passes; manual security review checklist signed off.

**Instructions for LLM:**
* Start with the permission helpers and their tests; refactor existing routes to use them before adding new features.
* Never include secrets, password hashes, or other users' private data in exports.
* Use constant-time comparison for share tokens and return identical responses for missing vs revoked.
* Keep the backup `version` field and write a migration hook for future formats.
