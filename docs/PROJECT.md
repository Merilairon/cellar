# Cellar — Project Overview

Self-hosted recipe book for family and friends. Imports recipes from URLs and shows them in a step-by-ingredient **grid**.

## Document Map

| Document | Purpose |
| --- | --- |
| [PRD.md](PRD.md) | What and why: problem, features, requirements, metrics |
| [data-model.md](data-model.md) | Entities, grid model, import pipeline, API surface |
| [user-journeys.md](user-journeys.md) | Personas, flows, edge cases |
| [RELEASE_PLAN.md](RELEASE_PLAN.md) | Milestone order, definition of done, release checklist |
| [../milestones/](../milestones) | Implementation specs for AI coding tools, one file per milestone |

## Decisions Log

| Decision | Choice | Rationale |
| --- | --- | --- |
| Audience | Family/friends, simple accounts | Small trusted group; no public SaaS concerns |
| Hosting | Self-hosted, Docker | Owner control, cheap, one volume to back up |
| Import strategy | Schema.org JSON-LD → auto-map → human review | Most recipe sites publish JSON-LD; review covers the rest |
| Import fallbacks | Headless browser, then paste text/HTML | Handles JS-rendered and blocked pages |
| Grid for imports | Auto-detect + review; list view if unmapped | Imported steps are plain text |
| Units | Dual units, per-user preference, scaling | Reference shows both metric and US |
| Sharing | Per-recipe: private or all users (read-only), plus an independent public link | Flexible without complexity |
| Export | Print-friendly grid + JSON backup | Cheapest useful options; PDF later |
| Language | English shipped, i18n-ready; recipe content English-only | Avoids retrofitting later; parser stays simple |
| Grid scope | Sections, repeatable rows, top+bottom banners | Real recipes (cake + frosting, split ingredients) must fit |
| Shared recipes | Read-only + Save a copy | No edit conflicts; each person owns their version |
| Exposure | Internet via reverse proxy, HTTPS from M1 | Security work is front-loaded, not a release afterthought |
| Public links | Allowed with copyright warning and source banner; `PUBLIC_LINKS_ENABLED` kill switch | Useful for sharing, controllable for risk |
| Account recovery | Admin-issued reset + CLI `admin:reset`; no email in MVP | No SMTP dependency; no admin lockout |
| Delivery | M3 and M4 split into releasable slices; headless sandbox last in M3 | Earlier value, risk isolated |
| Metrics | DB counts + import report; no analytics | Privacy and simplicity |
| Hardware targets | x86 server, Raspberry Pi/Home Assistant, small VPS; multi-arch image; headless optional | Must run on modest hardware |
| Pace | Weekend sprints, one slice per 1–2 weekends, no fixed deadline | Matches available time |
| Devices | Phone and tablet/laptop equal weight; visual tests at 375/768/1280 px | Family cooks from mixed devices |
| Third-party notice | `THIRD_PARTY_NOTICE.md` restored (MIT agent definitions) | Keeps attribution with the repo |

## Proposed Tech Stack (recommendation, adjustable)

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| App | Next.js (App Router) — UI + API routes in one container |
| Styling | Tailwind CSS; CSS Grid for the recipe grid |
| DB | SQLite (better-sqlite3) + Drizzle ORM + FTS5 for search |
| Auth | Email/password, argon2, DB-backed sessions in HTTP-only cookies |
| Import | `fetch` + `cheerio` + JSON-LD parsing; Playwright in an optional sidecar container |
| Ingredient parsing | `parse-ingredient` (or equivalent) + custom unit table |
| i18n | `next-intl`, message catalogs in `messages/en.json` |
| Tests | Vitest (unit), Playwright (e2e) |
| Deploy | Docker multi-stage image; `docker-compose.yml` with `app` and optional `browser` services; volume `/data` |

## Repository Layout (target)

```
cellar/
├─ docs/               planning documents
├─ milestones/         implementation specs
├─ src/
│  ├─ app/             routes, pages, API handlers
│  ├─ components/      RecipeGrid, RecipeList, GridEditor, ...
│  ├─ lib/
│  │  ├─ db/           schema, migrations, queries
│  │  ├─ import/       fetch, jsonld, ingredient parser, mapper
│  │  ├─ units/        parsing, conversion, scaling
│  │  └─ auth/
│  └─ messages/        i18n catalogs
├─ tests/
├─ Dockerfile
└─ docker-compose.yml
```
