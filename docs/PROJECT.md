# PROJECT: Recipe Book — Task Plan & Agent Assignments

**Reference docs**: `docs/PRD.md`, `docs/data-model.md`, `docs/user-journeys.md`, `milestones/01–05`
**Stack**: Next.js (App Router, TypeScript), PostgreSQL, Prisma, zod
**Status**: In Review
**Release plan**: `docs/RELEASE_PLAN.md` (waves, dependencies, parallelization)

---

## Phase 1 — Foundation (Week 1–2)

### Task 1.1: Project bootstrap
**Assign**: `engineering-software-architect`
**Scope**:
- Init Next.js + TypeScript + App Router
- PostgreSQL via Docker, Prisma schema per `docs/data-model.md`
- `.env` handling (DB_URL, SESSION_SECRET)
- Lint config + CI script (lint + typecheck + test)
- Git workflow setup
**Accept**:
- `npm run lint && npm run typecheck && npm test` pass
- Prisma migrate runs clean on fresh DB
- 3 seed recipes stored with full step hierarchy

### Task 1.2: Auth (register, login, logout, reset)
**Assign**: `engineering-identity-access-engineer`
**Scope**:
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- bcrypt hash, httpOnly session cookie, CSRF on all mutating routes
- Password reset + email verification (F-14)
- Session middleware protecting all `/api/recipes/*` mutating routes
**Accept**:
- Register → login → logout cycle works
- Password reset flow works end-to-end
- Unauthenticated requests to mutating routes return 401
- CSRF token required on all POST/PUT/DELETE

### Task 1.3: Seed data
**Assign**: `engineering-database-reliability-engineer`
**Scope**:
- 3 seed recipes matching reference table structure
- Hierarchical steps (melt → mix → fold in → bake)
- Tags, attribution fields populated
**Accept**:
- Seed script runs idempotent
- 3 recipes queryable with full step hierarchy intact

---

## Phase 2 — Strict Table View (Week 3–4)

### Task 2.1: RecipeTable component
**Assign**: `engineering-frontend-developer`
**Scope**:
- React component: title header row, prepNote sub-header, ingredient rows, merged action columns, final bake column
- Merged-cell algorithm: group consecutive ingredients by step, preserve `sortOrder`
- Handle: no steps (empty action columns), empty quantities, hierarchical steps
- SSR for public recipe page
**Accept**:
- Unit tests pass: flat steps, hierarchical steps, missing steps, empty quantities
- Rendered table matches reference layout visually

### Task 2.2: Recipe detail page (`/recipes/[id]`)
**Assign**: `engineering-frontend-developer`
**Scope**:
- Shows RecipeTable + meta (servings, times, tags, attribution, owner)
- 404 for missing/deleted/private-not-owned recipes
- Accessible markup (ARIA table semantics)
**Accept**:
- Public recipe renders without login
- Private recipe returns 404 to non-owner
- ARIA labels present on table

### Task 2.3: Recipe list page (`/`)
**Assign**: `engineering-frontend-developer`
**Scope**:
- Paginated list (20/page) of public recipes: title, tags, source, date
- Links to detail pages
**Accept**:
- Pagination works (cursor-based, date desc sort)
- All public recipes visible; deleted ones not

### Task 2.4: Table styling
**Assign**: `design-ui-designer`
**Scope**:
- CSS for table: column borders, merged cells, header styling
- Match reference layout (green border style optional)
- Responsive: horizontal scroll on narrow screens (P1, but basic mobile now)
**Accept**:
- Column separation visible
- Table usable on 360px viewport (no horizontal overflow beyond scroll)

### Task 2.5: Unit tests for table rendering
**Assign**: `testing-test-automation-engineer`
**Scope**:
- Test suite: flat steps, hierarchical steps, missing steps, empty quantities
- Deterministic merged-cell grouping
**Accept**:
- All tests pass; coverage on rendering logic > 90%

---

## Phase 3 — URL Import (Week 5–6)

### Task 3.1: Server-side fetch + safety
**Assign**: `engineering-backend-architect`
**Scope**:
- `POST /api/recipes/import`
- URL validation: HTTPS only, no private/loopback IPs (SSRF)
- robots.txt check before fetch
- 10s timeout, 5 MB size limit, browser-like User-Agent
- Rate limit: 5 imports/min per user
- Log to `ImportAttempt` (succeeded/failed + error)
**Accept**:
- Valid URL fetches and returns draft
- Private IP URL rejected (SSRF)
- robots-disallowed URL rejected
- Timeout > 10s returns clean error
- Rate limit enforced (6th import in 1 min → 429)

### Task 3.2: Parser (JSON-LD → microdata → heuristics)
**Assign**: `engineering-backend-architect`
**Scope**:
- Three-tier extraction pipeline
- JSON-LD `Recipe` schema first
- Microdata `itemtype="https://schema.org/Recipe"` second
- HTML heuristics: ingredient lists near "Ingredients" heading, steps near "Instructions"
- Defensive: never throw on malformed HTML; return partial draft with missing fields flagged
- Map to Step hierarchy where possible; flat steps otherwise
**Accept**:
- JSON-LD page extracts fully
- Heuristic page extracts title + ingredients + steps
- Non-recipe page returns graceful failure (not a 500)
- Malformed HTML does not crash

### Task 3.3: Review screen (`/import/review`)
**Assign**: `engineering-frontend-developer`
**Scope**:
- Form with all fields editable: title, prepNote, ingredients, steps (nested), times, servings, tags
- Highlight fields extraction could not fill
- Duplicate warning: same `sourceUrl` or normalized title → link to existing
- Save: create Recipe with `isPublic: true`, store attribution, navigate to recipe page
**Accept**:
- All fields editable
- Missing fields visually marked
- Duplicate warning shows on import of same URL
- Save persists and navigates correctly

### Task 3.4: Manual entry fallback (`/import/manual`)
**Assign**: `engineering-frontend-developer`
**Scope**:
- Full recipe form (same as review screen, no draft prefill)
- For when extraction fails
**Accept**:
- Manual entry saves a complete recipe
- Form validation: title required, at least 1 ingredient

### Task 3.5: Integration tests for import
**Assign**: `testing-api-tester`
**Scope**:
- Local test server serving sample pages:
  - JSON-LD page
  - Heuristic-only page
  - Non-recipe page (expect graceful failure)
  - robots-blocked page
- Test full flow: paste URL → fetch → parse → review → save
**Accept**:
- All 4 test scenarios pass
- Import of real public URL produces usable draft
- Round-trip: export JSON → re-import → identical recipe

### Task 3.6: Import safety audit
**Assign**: `security-appsec-engineer`
**Scope**:
- Review SSRF implementation
- Review robots.txt enforcement
- Review rate limiting
- Review input validation on URL field
**Accept**:
- No SSRF bypass found
- robots.txt respected
- Rate limit enforced correctly
- All findings resolved or logged as P1

---

## Phase 4 — Search, Edit, Delete (Week 7)

### Task 4.1: Search API
**Assign**: `engineering-backend-architect`
**Scope**:
- `GET /api/recipes?query=&tag=&visible=mine|all`
- ILIKE on title, ingredient names, tag names (case-insensitive)
- Filter by tag(s)
- Visibility: `all` (public + own), `mine` (all owned)
- Paginated (cursor, 20/page, date desc)
**Accept**:
- Search by name returns correct results
- Search by ingredient returns correct results
- Combined filters narrow results
- Pagination stable (no duplicates, no gaps)

### Task 4.2: Search UI
**Assign**: `engineering-frontend-developer`
**Scope**:
- Search bar + tag filter on home page
- Results list: title, tags, source, date
**Accept**:
- Search bar submits query
- Tag filter narrows results
- Results match API response

### Task 4.3: Edit API
**Assign**: `engineering-backend-architect`
**Scope**:
- `PUT /api/recipes/[id]` (owner only)
- Edit: title, prepNote, servings, times, tags, image, isPublic
- Edit ingredients + steps (hierarchy) via structured editor
- Attribution fields locked: cannot change, only add if missing
- Server-side ownership check; never trust client
**Accept**:
- Owner can edit all fields
- Non-owner edit → 403
- Attribution fields unchanged after edit
- Step hierarchy preserved on edit

### Task 4.4: Edit UI
**Assign**: `engineering-frontend-developer`
**Scope**:
- Reuse step/ingredient editor from review screen (no duplication)
- Edit form with all fields
- Locked attribution fields (read-only)
**Accept**:
- Edit form opens for owner
- Non-owner sees no edit button
- Attribution fields read-only in form

### Task 4.5: Delete API + soft delete
**Assign**: `engineering-backend-architect`
**Scope**:
- `DELETE /api/recipes/[id]` (owner only)
- Soft delete: set `deletedAt`
- Public queries filter `deletedAt IS NULL`
- Restorable by owner
**Accept**:
- Owner delete works
- Non-owner delete → 403
- Deleted recipe returns 404 on its URL
- Owner can restore soft-deleted recipe

### Task 4.6: Search/edit/delete tests
**Assign**: `testing-api-tester`
**Scope**:
- Search by name, ingredient, tag; combined filters
- Edit by non-owner → 403
- Edit preserves attribution
- Delete: invisible publicly, 404 on URL, restorable
**Accept**:
- All tests pass
- Ownership checks enforced server-side

---

## Phase 5 — Share and Export (Week 8)

### Task 5.1: Share URLs
**Assign**: `engineering-backend-architect`
**Scope**:
- Canonical share URL: `/recipes/[id]`
- Page works without login for public recipes
- "Copy share link" button on recipe page
**Accept**:
- Share URL works without auth
- Private recipe share URL → 404
- Copy button copies correct URL

### Task 5.2: Export API
**Assign**: `engineering-backend-architect`
**Scope**:
- `GET /api/recipes/[id]/export?format=json|md` (owner or public)
- JSON: full recipe object (ingredients, steps hierarchy, tags, attribution)
- Markdown: title, prepNote, Markdown table matching strict layout, ingredients, steps, attribution footer
- Stream response; no client-side rendering
**Accept**:
- JSON export round-trips: import → identical recipe
- Markdown export includes source URL + author
- Private recipe export by non-owner → 403/404

### Task 5.3: Export UI
**Assign**: `engineering-frontend-developer`
**Scope**:
- "Export" dropdown on recipe page: JSON + Markdown
- Download triggers browser save
**Accept**:
- Dropdown offers JSON and Markdown
- Download works for both formats
- Exported files include attribution

### Task 5.4: Export tests
**Assign**: `testing-api-tester`
**Scope**:
- JSON round-trip test
- Markdown includes source URL + author
- Private export by non-owner → 403/404
**Accept**:
- All tests pass
- Round-trip fidelity confirmed

---

## Phase 6 — QA & Hardening (Week 8–9)

### Task 6.1: End-to-end test suite
**Assign**: `testing-evidence-collector`
**Scope**:
- Full user journey: register → import URL → review → save → search → edit → share → delete
- Edge cases from `docs/user-journeys.md`
**Accept**:
- All E2E scenarios pass
- No P0 bugs in core loop

### Task 6.2: Performance benchmark
**Assign**: `testing-performance-benchmarker`
**Scope**:
- Import latency: p50, p90, p99 (target < 10s for 90%)
- Search latency: p95 < 500ms
- Table render time: < 200ms client-side
**Accept**:
- Import success rate ≥ 80% on test URL set
- Search p95 < 500ms
- No N+1 queries in list/detail pages

### Task 6.3: Accessibility audit
**Assign**: `testing-accessibility-auditor`
**Scope**:
- Keyboard navigation on all pages
- ARIA labels on tables, forms, navigation
- Screen-reader test on recipe table
- Color contrast on table borders
**Accept**:
- WCAG AA pass
- Keyboard-only navigation works end-to-end
- Table semantics correct (th, td, scope)

### Task 6.4: Code review
**Assign**: `engineering-code-reviewer`
**Scope**:
- Review all Phase 1–5 PRs
- Check: ownership enforcement, SSRF, input validation, soft delete, attribution preservation
**Accept**:
- All P0 findings resolved
- No security gaps in auth/ownership/SSRF

### Task 6.5: Documentation
**Assign**: `engineering-technical-writer`
**Scope**:
- API reference (all endpoints, request/response examples)
- Setup guide (env vars, DB, seed)
- Contributor guide (branching, PR, CI)
**Accept**:
- API docs cover all endpoints
- Setup guide reproducible from scratch
- Contributor guide complete

---

## Phase 7 — P1 Features (Week 10–14)

| Task | Assign | Scope | Accept |
|------|--------|-------|--------|
| 7.1 Rate limiting (imports) | `engineering-backend-architect` | Per-user cap, 429 on exceed | 6th import in 1 min → 429 |
| 7.2 Image handling | `engineering-frontend-developer` + `engineering-backend-architect` | Fetch, store, optimize, lazy load | Images display; no layout shift |
| 7.3 Quantity normalization | `engineering-backend-architect` | Parse dual units ("1/4 tsp. (2.5 mL)"), display both | Reference layout fidelity |
| 7.4 Responsive table | `design-ui-designer` + `engineering-frontend-developer` | Mobile: horizontal scroll or stacked view | 360px viewport usable |
| 7.5 Accessibility (full) | `testing-accessibility-auditor` | WCAG AA full pass | All interactive elements keyboard-navigable |
| 7.6 Full-text search | `engineering-database-reliability-engineer` | PostgreSQL tsvector, ranking | Typo tolerance, better ranking |
| 7.7 OAuth (Google/Apple) | `engineering-identity-access-engineer` | OAuth flow, session integration | Login via OAuth works |
| 7.8 Categories | `product-sprint-prioritizer` (scope) + `engineering-backend-architect` (impl) | Tag taxonomy → categories page | Browse by category works |
| 7.9 User profiles | `engineering-frontend-developer` + `engineering-backend-architect` | Public profile, owned recipes list | Profile page renders correctly |
| 7.10 Bulk import | `engineering-frontend-developer` + `engineering-backend-architect` | Import N URLs at once | 10 URLs imported in batch |

---

## Phase 8 — P2 Features (Week 15+)

| Task | Assign | Scope | Accept |
|------|--------|-------|--------|
| 8.1 Print view | `engineering-frontend-developer` | Print-friendly CSS | `@media print` layout correct |
| 8.2 Edit history | `engineering-backend-architect` | Audit trail per recipe | History list shows changes |
| 8.3 Share permissions | `engineering-backend-architect` | Grant edit to specific users | Non-owner with permission can edit |
| 8.4 Notifications | `engineering-backend-architect` | New public recipes matching tags | User gets notification |
| 8.5 Similar recipes | `engineering-backend-architect` | Suggest by shared ingredients/tags | Suggestion list on recipe page |
| 8.6 Content moderation | `security-appsec-engineer` + `support-legal-compliance-checker` | Report/flag, takedown flow | Abuse report → reviewed → action |
| 8.7 Data portability | `engineering-backend-architect` | Export personal data, account deletion | Full data export + account delete |
| 8.8 Analytics dashboard | `engineering-data-visualization-engineer` | Import success, usage, growth | Dashboard shows core metrics |

---

## Agent Assignment Summary

| Agent | Tasks | Phase |
|-------|-------|-------|
| `engineering-software-architect` | 1.1 | 1 |
| `engineering-identity-access-engineer` | 1.2, 7.7 | 1, 7 |
| `engineering-database-reliability-engineer` | 1.3, 7.6 | 1, 7 |
| `engineering-frontend-developer` | 2.1, 2.2, 2.3, 3.3, 3.4, 4.2, 4.4, 5.3, 7.2, 7.4, 7.9, 7.10, 8.1, 8.3, 8.5 | 2–8 |
| `design-ui-designer` | 2.4, 7.4 | 2, 7 |
| `engineering-backend-architect` | 3.1, 3.2, 4.1, 4.3, 4.5, 5.1, 5.2, 7.1, 7.2, 7.3, 7.8, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8 | 3–8 |
| `security-appsec-engineer` | 3.6, 8.6 | 3, 8 |
| `support-legal-compliance-checker` | 8.6 | 8 |
| `testing-api-tester` | 3.5, 4.6, 5.4 | 3–5 |
| `testing-test-automation-engineer` | 2.5 | 2 |
| `testing-evidence-collector` | 6.1 | 6 |
| `testing-performance-benchmarker` | 6.2 | 6 |
| `testing-accessibility-auditor` | 6.3, 7.5 | 6, 7 |
| `engineering-code-reviewer` | 6.4 | 6 |
| `engineering-technical-writer` | 6.5 | 6 |
| `product-sprint-prioritizer` | 7.8 (scope) | 7 |
| `engineering-data-visualization-engineer` | 8.8 | 8 |

---

## Quality Requirements

- All mutating routes check ownership server-side
- No SSRF bypass: HTTPS only, no private/loopback IPs
- robots.txt enforced before every fetch
- Soft delete: `deletedAt` filter on all public queries
- Attribution preserved on edit; locked on edit form
- Input validation via zod on all API inputs
- CI: lint + typecheck + test on every PR
- No background processes in any commands
- Rate limiting: 5 imports/min per user

## Technical Notes

- **Stack**: Next.js App Router, TypeScript, PostgreSQL, Prisma, zod
- **Auth**: bcrypt, httpOnly session cookie, CSRF tokens
- **Parser**: three-tier (JSON-LD → microdata → heuristics), defensive, no throws
- **Data model**: hierarchical Step via `parentStepId`, soft delete via `deletedAt`
- **Rendering**: SSR for public pages, merged-cell algorithm for action columns
- **API**: REST under `/api/auth`, `/api/recipes`
- **Testing**: unit (table, parser), integration (import, search, export), E2E (full journey), performance (latency), accessibility (WCAG AA)
