# Cellar — Product Requirements Document

**Status:** Draft v1 · **Owner:** Jan Baetens

## 1. Problem Statement

Recipes live in bookmarks, screenshots, and scattered websites full of ads, life stories and pop-ups. Standard recipe layouts (ingredient list, then numbered paragraphs) force the cook to keep flipping between "what do I need" and "what do I do now". The result is mistakes and lost context mid-cooking.

Cellar is a self-hosted web app that:

1. Stores a family's recipes in one place.
2. Imports recipes from any URL.
3. Shows every recipe in a **grid layout** (see §4) where each step visually spans exactly the ingredients it uses, so the whole process is readable at a glance.

## 2. Target Audience

Family and friends of the owner, a small group (2–20 people) sharing one self-hosted instance.

| Need | Expectation |
| --- | --- |
| Quickly save a recipe found online | Paste a URL, get a clean recipe |
| Cook from a phone/tablet in the kitchen | Readable, touch-friendly, screen stays usable |
| Share favorites with relatives | Control who sees what |
| Zero maintenance | One Docker container, easy backup |

## 3. Goals and Non-Goals

**Goals (MVP)**
- Grid recipe view that matches the reference design.
- URL import with a review/fix step.
- Manual add and edit, search and tags, unit conversion and scaling, photos/notes/ratings, sharing and export.
- Simple multi-user accounts; self-hosted via Docker.

**Non-goals (MVP)**
- Meal planning, shopping lists, nutrition calculation.
- Native mobile apps (responsive web only).
- Public sign-ups or a hosted multi-tenant service.
- AI/LLM features (may be revisited post-MVP).
- UI languages other than English (but the UI must be i18n-ready), and non-English recipe content: the ingredient parser and step-verb detection are English-only in MVP.
- Collaborative editing of someone else's recipe (others get read-only access plus **Save a copy**).
- Sub-recipes, ingredient ranges, and non-numeric yields beyond a free-text label (backlog).

## 4. The Grid Recipe View (core differentiator)

Reference: the "brownie" recipe table — ingredients as rows on the left, steps as columns to the right.

**Layout rules**

1. **Banner rows:** full-width rows at the top for steps that need no ingredient, e.g. "Butter and flour an 8x8-in pan", "Preheat oven to 350°F (170°C)"; and optional full-width rows at the bottom for work after the last column step ("Cool 20 min, frost, serve").
2. **Ingredient column:** one row per ingredient, in order of first use, showing quantity (dual units, e.g. `1 cup (200 g)`) and name.
3. **Step columns:** each step is its own column to the right, in order. A step is a cell that **spans a contiguous range of ingredient rows**, the ingredients that have been combined at that point.
4. A later step usually spans more rows than an earlier one, because it works on the combined mixture (e.g. `melt` spans butter only; `mix` spans butter..espresso; the next `mix` adds eggs; `fold in` spans down to the salt).
5. The final step (e.g. `bake 350°F (170°C) 30 to 40 min`) spans all rows.
6. Cells are short: a verb plus optional parameters (temperature, time). Longer instructions go in an expandable detail shown on tap/hover.
7. Rows not covered by a step in a column stay empty.
7a. **Sections:** a recipe may have several grids (e.g. "Cake", "Frosting"), each with its own banners, rows, and columns.
7b. **Repeatable rows:** an ingredient used in two steps ("half the sugar now") appears as two rows with a portion label; scaling treats each row separately.
7c. A mid-recipe step with no ingredients ("rest 10 min") is a column that spans all rows combined so far.
7d. If a recipe can't be expressed validly in sections, it stays in list view.
8. On narrow screens, the grid stays horizontally scrollable with a sticky ingredient column; a user toggle switches to **list view**.

**List view (fallback):** ingredient list plus numbered steps. It is used for recipes that have no grid mapping yet (e.g. just imported); the user can click **Convert to grid** to start the mapping editor.

## 5. Features

### 5.1 Must-have (MVP)

| ID | Feature | Description |
| --- | --- | --- |
| F1 | Accounts | Email + password login; admin invites users; roles: `admin`, `member` |
| F2 | Recipe CRUD | Create, edit, delete recipes manually (title, description, servings, times, source, ingredients, steps, tags) |
| F3 | Grid view | Render recipes per §4; list view fallback and toggle |
| F4 | Grid editor | Edit ingredient order and step spans visually (drag handles for start/end row); live preview |
| F5 | URL import | Fetch URL → parse Schema.org Recipe JSON-LD → auto-detect step↔ingredient mapping → review screen → save |
| F6 | Import fallbacks | Headless-browser render for JS-heavy pages; paste-text/HTML fallback when blocked or paywalled; clear error messages |
| F7 | Search & tags | Full-text search over title, ingredients and notes; tags/categories; filter by tag, rating, author |
| F8 | Units & scaling | Per-user metric/US preference; scale servings (×½, ×2, custom); quantities recomputed |
| F9 | Photos, notes, ratings | Recipe photo(s), private and shared notes, 1–5 star rating per user |
| F10 | Sharing | Per-recipe: visibility **private** or **all users (read-only)**, plus an independent revocable **public read-only link**; others can **Save a copy** to their own book and edit that |
| F11 | Export | Print-friendly grid view (print CSS); full JSON backup/restore |
| F12 | i18n-ready | All UI strings externalized; English shipped |
| F13 | Docker deploy | Single `docker compose up`; data in a mounted volume |

### 5.2 Later (post-MVP)
Shopping list, meal planner, PDF export, Schema.org JSON-LD export, additional languages, browser extension / bookmarklet, SSO/OIDC, AI-assisted import mapping.

## 6. Non-Functional Requirements

- **Performance:** recipe page renders < 1 s on a home server; import completes < 15 s typical (headless fallback < 30 s).
- **Exposure:** the instance is reachable from the internet through a reverse proxy. HTTPS is mandatory (documented Caddy compose example shipped in M1), with login and public-link rate limiting and security headers from M1, not just at release.
- **Security:** hashed passwords (argon2), HTTP-only session cookies, CSRF protection, **SSRF protection on URL import** (block private/loopback IP ranges, limit redirects, size and time limits), sanitize imported HTML. The headless browser runs in an isolated sidecar (no route to the LAN or database).
- **Privacy:** no third-party analytics; public links are unguessable tokens.
- **Accessibility:** WCAG 2.1 AA target; grid must be navigable by keyboard and expose table semantics to screen readers.
- **Backup:** all state is one SQLite file plus an uploads directory; JSON export as a second path.
- **Compatibility:** latest two versions of Chrome, Firefox, Safari; mobile and tablet responsive.

## 7. Success Metrics

| Metric | Target |
| --- | --- |
| Import success (valid recipe produced without manual typing) on a test set of 30 popular recipe sites | ≥ 85 % |
| Auto-detected grid mapping accepted without edits | ≥ 60 % of imports |
| Time from pasting a URL to saved recipe | < 60 s |
| Family adoption | ≥ 5 active users within 1 month of launch |
| Recipes saved | ≥ 50 within 3 months |

## 8. Prioritization

**MVP order** (see [RELEASE_PLAN.md](RELEASE_PLAN.md)): foundation → recipe view/CRUD → URL import → search/units/media → share/export. Grid view (F3) and URL import (F5) are the highest value; if time is cut, cut F9 (ratings) and cook mode first; PDF export is already post-MVP.

## 9. Risks & Open Questions

| Risk | Mitigation |
| --- | --- |
| Auto-mapping steps to ingredients is inaccurate | Always show a review step; ship a good grid editor; list view fallback |
| Sites block scraping / change markup | Headless fallback, paste fallback, clear errors |
| Unit conversion between volume and weight needs ingredient density | Convert within a dimension; use small density table for common ingredients; otherwise keep original unit |
| Headless browser inflates the Docker image | Make it a separate optional container/profile |
| Copyright of imported content | Store source URL and attribution; keep instance private by default |

| Imported recipes are copyrighted; public links republish them to the internet | Store source URL and attribution; show a source banner on public pages; warn when making an imported, unedited recipe public; keep `noindex` |
| Reference recipe and image may be copyrighted | Use a self-written sample recipe for seed and test fixtures; the reference is a layout study only; test-fixture pages are stored as extracted JSON-LD, not full copyrighted pages. The recipe *layout* idea is not a licensed asset |
| Third-party agent definitions in `.kilo/` and `.vibe/` (MIT) | Keep the MIT notice (`THIRD_PARTY_NOTICE.md`) if those folders stay in the repo or are distributed |
| Success metrics have no analytics | Measure from the DB (recipe and active-user counts), `import_job` rows, and the fixture-corpus report; no third-party analytics |
| Headless Chromium image size and ARM support | Optional everywhere (off by default); arm64 verified in the pre-3c spike; primary targets x86 server, Raspberry Pi/Home Assistant, small VPS |
| Grid on a 375 px phone with 5+ columns | Wireframe and prototype the mobile grid before M2 build |

**Roles & data ownership (assumed defaults, change if wrong):** admins manage users but cannot read other users' private recipes. Deleting a user lets the admin choose to reassign their recipes to another user or delete them. Password reset is admin-issued in MVP (no email/SMTP).

**Open:** choice of full-text search (SQLite FTS5 assumed); retention of imported raw HTML for re-parsing.
