# PRD: Recipe Book — Community Recipe Web App

**Status**: In Review
**Author**: Alex (Senior Product Manager)
**Last Updated**: 2026-10-27
**Version**: 3.0
**Stakeholders**: Engineering Lead, Design Lead, Legal (attribution), Marketing
**Related docs**: `docs/user-journeys.md`, `docs/data-model.md`, `milestones/01–05`

> **Current state:** Documentation and milestones exist; no production code yet. This PRD defines the feature set, prioritization, and launch plan for the initial build.

---

## 0. Press Release

For the first time, home cooks can import a recipe from any website in under two minutes and cook from it in a consistent, scannable table. Recipe Book lets you paste a URL, review the extracted recipe, and save it to a personal and shared collection that your community can browse, search, and import. Unlike recipe savers that lock you into one source or require manual re-typing, Recipe Book works with any site and renders every recipe in the same table layout — title, prep note, ingredients grouped by action, and a final bake column — so you can compare recipes at a glance and cook faster.

---

## 1. Problem Statement

**The pain:** Home cooks find recipes on blogs and websites weekly. Saving them is a habitual behavior, but existing tools either lock recipes into a single source, require manual re-typing, or render recipes in inconsistent layouts. The result: recipes get lost, time is wasted re-entering data, and browsing a collection is slow because every recipe looks different.

**Who experiences it:**
-   **Primary:** Home cooks who save and share recipes from websites.
-   **Secondary:** Small cooking communities (families, friends, clubs) who want a shared, browsable collection.

**How often:** Weekly discovery; saving is recurring.

**Cost of not solving it:**
-   Recipes lost or scattered across devices.
-   Time wasted re-typing recipes.
-   Inconsistent layouts make comparison and browsing slow.
-   Communities can't build a shared recipe archive.

**Evidence:**
-   **Competitive signal:** Existing recipe savers (browser extensions, personal note apps) have the limitations above; none combine any-URL import with a consistent table layout.
-   **Reference layout:** The provided example (a table with a title, prep note, ingredient rows grouped by action, and a final bake column) is the target consistency every recipe must match.
-   **Assumptions to validate:** (1) Users will paste URLs rather than re-type; (2) a consistent table layout is valued for browsing; (3) public-by-default is acceptable for community sharing. These are flagged for validation in Phase 1.

> **Note:** This is a pre-launch PRD. Evidence is competitive signal and the reference layout, not behavioral data. Assumptions are flagged for validation.

---

## 2. Goals & Success Metrics

| Goal | Metric | Current Baseline | Target | Measurement Window |
|------|--------|-----------------|--------|--------------------|
| Fast import | % of pasted URLs producing a usable draft | n/a (new) | ≥ 80% | 60 days post-launch |
| Low time-to-save | Paste→save time for a typical page | n/a | < 2 min | 60 days |
| Consistent layout | % of recipes rendered in the strict table | n/a | 100% | At launch |
| Adoption | % of registered users with ≥ 3 imported recipes | n/a | 50% | 90 days |
| Discovery | % of recipe views from search/browse (not direct links) | n/a | ≥ 30% | 90 days |
| Retention | 30-day return rate of active users | n/a | ≥ 60% | 90 days |
| Trust | Unresolved abuse reports within 48h | n/a | 0 | Ongoing (Phase 3) |

---

## 3. Non-Goals

Explicitly out of scope for v1:

-   **Recipe marketplace:** No payments, no sales, no monetization of recipes.
-   **Native mobile app:** Web only in v1; the table must work on mobile browsers, but we are not building a native app.
-   **OAuth in v1:** Email/password only; OAuth is P1.
-   **Admin panel:** Owner-only management; no platform-level admin in v1.
-   **AI-generated recipes:** Import only; no AI generation of recipes from scratch.
-   **Ratings/reviews:** Deferred until the community is large enough to be meaningful.
-   **User-to-user messaging:** No direct chat between users in v1.

---

## 4. User Personas & Stories

**Primary — Anna (Saver):** A home cook who finds recipes on blogs and wants to save them without re-typing. Needs fast import and a view she can cook from.

**Secondary — Ben (Browser):** A cook who browses the public collection before dinner. Needs quick search by ingredient and a scannable layout.

**Tertiary — Carla (Editor):** Runs a small cooking community; imports, cleans up, tags, and shares recipes. Needs editing, tagging, export, and preserved attribution.

### Core User Stories

**Story 1 — Import from URL (Anna):**
As a saver, I want to paste a recipe URL and save it in under two minutes so I don't lose recipes.
-   [ ] Given a valid recipe URL, when I paste it, then a draft appears within 10 seconds.
-   [ ] Given a non-recipe URL, when I paste it, then a clear error is shown and a manual-entry option is available.
-   [ ] Given a duplicate URL or title, when I paste it, then a warning is shown with a link to the existing recipe.
-   Performance: Fetch + parse completes in under 10 seconds for 90% of URLs.

**Story 2 — Review and edit before save (Anna):**
As a saver, I want to edit an imported recipe before saving so I can fix parsing errors.
-   [ ] Given a draft, when I open the review screen, then all fields (title, ingredients, steps, times, servings, tags) are editable.
-   [ ] Given missing fields, when I open review, then they are clearly marked for manual entry.
-   [ ] When I save, then the edited recipe is stored and public by default.

**Story 3 — Search by ingredient (Ben):**
As a browser, I want to search by ingredient so I can find recipes with what's in my fridge.
-   [ ] Given an ingredient, when I search, then recipes matching by name, ingredient, or tag appear.
-   [ ] Given a combined filter (ingredient + tag), when I search, then results are narrowed accordingly.

**Story 4 — Consistent table layout (Ben):**
As a browser, I want every recipe in the same table layout so I can compare recipes at a glance.
-   [ ] Given any recipe, when I view it, then it renders in the strict table (title header, prep note, ingredient rows, merged action columns, final bake column).
-   [ ] Given a recipe with no steps, when I view it, then the table still renders with empty action columns.

**Story 5 — Edit and delete (Carla):**
As an editor, I want to edit and delete my recipes so I can maintain quality.
-   [ ] Given an owned recipe, when I edit, then all fields update and attribution is preserved.
-   [ ] Given a non-owned recipe, when I attempt to edit, then a 403 is returned.
-   [ ] Given an owned recipe, when I delete, then it is soft-deleted, returns 404 publicly, and is restorable by the owner.

**Story 6 — Share and export (Carla):**
As an editor, I want to share and export recipes so I can distribute them outside the app.
-   [ ] Given a public recipe, when I copy the share link, then the link works without login.
-   [ ] Given a recipe, when I export as JSON or Markdown, then the file includes all fields and attribution.
-   [ ] Given an exported JSON, when I re-import it, then the recipe round-trips identically.

---

## 5. Solution Overview

Recipe Book is a full-stack web app (Next.js + PostgreSQL + Prisma) where users register, import recipes from any URL, review and edit them, and save them to a personal and shared collection. Every recipe renders in a strict table layout that matches the reference: a title header, a prep note, ingredient rows grouped by action in merged columns, and a final bake column. The community model is public-by-default: recipes are visible to all users unless the owner hides them.

The core loop is: **paste URL → server fetches and parses → review screen → save → browse/search → edit/share**. The parser uses a three-tier strategy (JSON-LD → microdata → HTML heuristics) to maximize the chance of successful extraction across any site. A review screen catches extraction failures and lets users fill in gaps before saving.

**Key Design Decisions:**
-   **Server-side fetching** over client-side fetching: avoids CORS issues and lets us enforce robots.txt and SSRF protection. Trade-off: more server infrastructure and latency.
-   **Three-tier parser** (JSON-LD → microdata → heuristics) over a single parser: JSON-LD is most reliable but not always present; heuristics catch the long tail. Trade-off: more complex parsing code.
-   **Editable review screen** over auto-save: extraction will be imperfect; users must be able to fix it. Trade-off: adds a step to the import flow.
-   **Hierarchical Step model** (via `parentStepId`) over flat steps: required to reproduce merged action columns for nested steps. Trade-off: more complex data model.
-   **Soft delete** over hard delete: safe for a public community; allows recovery. Trade-off: extra storage and query filters.
-   **Public-by-default** over private-by-default: drives discovery and community growth. Trade-off: users must be able to hide recipes easily.

---

## 6. Feature Inventory & Prioritization

The feature set is organized into three tiers. **Must-have (P0)** is the MVP — the minimum set without which the product does not solve the core problem. **Nice-to-have (P1)** improves the experience after the core loop works; each is independently shippable. **Improvements (P2)** are enhancements to shipped features and differentiators for a growing community.

### 6.1 Feature Inventory

| ID | Feature | Tier | Description |
|----|---------|------|-------------|
| F-01 | User accounts (email + password) | P0 | Register, login, logout; session cookies; ownership |
| F-02 | Strict table recipe view | P0 | Every recipe renders as the reference table |
| F-03 | Import recipe from any URL | P0 | Server-side fetch + parse + review screen |
| F-04 | Search and filter | P0 | Search by name, ingredient, tag; filter by tag and visibility |
| F-05 | Edit and delete | P0 | Owner-only edit and delete; attribution preserved |
| F-06 | Share and export | P0 | Public share URLs; export to JSON and Markdown |
| F-07 | Manual entry fallback | P0 | Full recipe form when extraction fails |
| F-08 | Duplicate detection | P0 | Warn on import if same URL or title exists |
| F-09 | Import safety | P0 | robots.txt, SSRF protection, HTTPS, size/time limits |
| F-10 | Attribution | P0 | Store and display source URL, site, author |
| F-11 | Public-by-default visibility | P0 | Imported/created recipes public unless hidden |
| F-12 | Recipe listing and browsing | P0 | Paginated list of public recipes |
| F-13 | Soft delete | P0 | Deleted recipes disappear publicly, restorable |
| F-14 | Password reset + email verification | P0 | Secure onboarding and account recovery |
| F-15 | Rate limiting (imports) | P1 | Per-user cap on URL imports |
| F-16 | OAuth (Google/Apple) | P1 | Faster onboarding |
| F-17 | Categories and browsing pages | P1 | Browse by category |
| F-18 | User profiles and history | P1 | Public profile with owned recipes |
| F-19 | Image handling | P1 | Optimized display, lazy loading |
| F-20 | Quantity normalization | P1 | Parse and display dual units ("1/4 tsp. (2.5 mL)") |
| F-21 | Responsive table | P1 | Table works on mobile (horizontal scroll or stacked) |
| F-22 | Accessibility | P1 | Keyboard nav, ARIA, screen-reader-friendly table |
| F-23 | Full-text search | P1 | PostgreSQL tsvector for better ranking and typos |
| F-24 | Bulk import | P1 | Import multiple URLs at once |
| F-25 | Print view | P2 | Print-friendly recipe layout |
| F-26 | Edit history | P2 | Audit trail per recipe |
| F-27 | Share with permissions | P2 | Grant edit access to specific users |
| F-28 | Notifications | P2 | Notify on new public recipes matching tags |
| F-29 | Similar recipes | P2 | Suggest recipes by shared ingredients/tags |
| F-30 | Content moderation | P2 | Report/flag inappropriate content |
| F-31 | Data portability and account deletion | P2 | Export personal data; delete account |
| F-32 | Analytics dashboard | P2 | Import success, usage, growth metrics |

### 6.2 Must-Have (P0 — MVP)

These are required for the product to solve the core problem. Without them, the value proposition does not exist.

| ID | Feature | Rationale |
|----|---------|-----------|
| F-01 | User accounts | Ownership, editing, and the community model all depend on accounts |
| F-02 | Strict table view | The core differentiator; every feature is consumed through this layout |
| F-03 | Import from any URL | The primary value proposition; without it users must re-type |
| F-04 | Search and filter | Primary discovery mechanism for the community collection |
| F-05 | Edit and delete | Imported recipes need cleanup; owners must manage content |
| F-06 | Share and export | Makes recipes portable and shareable, reinforcing the community loop |
| F-07 | Manual entry fallback | Required for the import journey to be complete (extraction fails on some pages) |
| F-08 | Duplicate detection | Prevents the collection from filling with duplicates |
| F-09 | Import safety | Legal/operational requirement (robots.txt, SSRF); protects the platform |
| F-10 | Attribution | Legal and trust requirement for imported content |
| F-11 | Public-by-default | Defines the community model and drives discovery |
| F-12 | Recipe listing and browsing | Users must be able to find recipes after importing |
| F-13 | Soft delete | Safe deletion for a public community platform |
| F-14 | Password reset + email verification | Production-grade auth is a must, not a nice-to-have |

### 6.3 Nice-to-Have (P1 — Phase 2)

Improves the experience after the core loop works. Each is independently shippable and does not block MVP.

| ID | Feature | Rationale |
|----|---------|-----------|
| F-15 | Rate limiting (imports) | Protects from abuse; cheap once import infra exists |
| F-16 | OAuth | Faster onboarding; defer until email auth is proven |
| F-17 | Categories and browsing pages | Complements search; needs a tag taxonomy first |
| F-18 | User profiles and history | Community social layer; low urgency until the collection is large |
| F-19 | Image handling | Recipes without images feel incomplete; needed for a polished browse |
| F-20 | Quantity normalization | Improves reference fidelity (dual units) and search quality |
| F-21 | Responsive table | Mobile is a primary cooking context; the table must not break on small screens |
| F-22 | Accessibility | Broadens the audience; low cost against an existing table renderer |
| F-23 | Full-text search | Better ranking and typo tolerance; upgrade to F-04 |
| F-24 | Bulk import | Power-user feature; defer until single import is polished |

### 6.4 Improvements (P2 — Phase 3)

Enhancements to shipped features and differentiators for a growing community.

| ID | Feature | Rationale |
|----|---------|-----------|
| F-25 | Print view | Practical for cooks; cheap static export |
| F-26 | Edit history | Trust and safety for a community platform |
| F-27 | Share with permissions | Enables small-group sharing beyond public |
| F-28 | Notifications | Retention driver for returning users |
| F-29 | Similar recipes | Discovery engine; differentiator vs. a plain archive |
| F-30 | Content moderation | Required as the community grows; plan before scale |
| F-31 | Data portability and account deletion | Compliance and user trust |
| F-32 | Analytics dashboard | Informs P2/P3 prioritization with real data |

### 6.5 MoSCoW Summary

| Feature | Must | Should | Could | Won't (v1) |
|---------|------|--------|-------|------------|
| F-01 Accounts | ✔ | | | |
| F-02 Table view | ✔ | | | |
| F-03 URL import | ✔ | | | |
| F-04 Search | ✔ | | | |
| F-05 Edit/delete | ✔ | | | |
| F-06 Share/export | ✔ | | | |
| F-07 Manual entry | ✔ | | | |
| F-08 Duplicate detection | ✔ | | | |
| F-09 Import safety | ✔ | | | |
| F-10 Attribution | ✔ | | | |
| F-11 Public by default | ✔ | | | |
| F-12 Listing/browsing | ✔ | | | |
| F-13 Soft delete | ✔ | | | |
| F-14 Password reset/verification | ✔ | | | |
| F-15 Rate limiting | | ✔ | | |
| F-16 OAuth | | | ✔ | |
| F-17 Categories | | | ✔ | |
| F-18 Profiles | | | ✔ | |
| F-19 Images | | ✔ | | |
| F-20 Quantity normalization | | ✔ | | |
| F-21 Responsive table | | ✔ | | |
| F-22 Accessibility | | ✔ | | |
| F-23 Full-text search | | ✔ | | |
| F-24 Bulk import | | | ✔ | |
| F-25 Print | | | ✔ | |
| F-26 Edit history | | | ✔ | |
| F-27 Share permissions | | | ✔ | |
| F-28 Notifications | | | ✔ | |
| F-29 Similar recipes | | | ✔ | |
| F-30 Moderation | | | ✔ | |
| F-31 Data portability | | | ✔ | |
| F-32 Analytics | | | ✔ | |

### 6.6 RICE Score for Top 10 (P0 + highest P1)

RICE = (Reach × Impact × Confidence) ÷ Effort.
-   **Reach:** estimated users affected per quarter (pre-launch estimate).
-   **Impact:** 0.25 / 0.5 / 1 / 2 / 3.
-   **Confidence:** % based on evidence.
-   **Effort:** person-months.

| Feature | Reach | Impact | Confidence | Effort | RICE |
|---------|--------|--------|------------|--------|------|
| F-03 URL import | 1000 | 3 | 80% | 2 | 1200 |
| F-02 Table view | 1000 | 3 | 90% | 1.5 | 1800 |
| F-01 Accounts | 1000 | 2 | 95% | 1 | 1900 |
| F-04 Search | 800 | 2 | 85% | 1 | 1360 |
| F-05 Edit/delete | 800 | 1.5 | 90% | 0.5 | 1080 |
| F-06 Share/export | 800 | 1.5 | 85% | 0.5 | 1020 |
| F-07 Manual entry | 500 | 2 | 80% | 0.5 | 1600 |
| F-09 Import safety | 1000 | 2 | 95% | 1 | 1900 |
| F-19 Images | 800 | 1 | 70% | 1 | 560 |
| F-21 Responsive table | 800 | 1.5 | 80% | 0.5 | 2400 |

> **Note:** RICE is a planning tool, not a precise prediction. The pre-launch Reach estimates are assumptions to be validated with usage data.

---

## 7. Technical Considerations

**Dependencies:**
-   PostgreSQL + Prisma — required for the data model (hierarchical steps, soft delete). Owner: Eng. Timeline risk: Low.
-   Server-side fetch infrastructure — required for URL import (robots.txt, SSRF). Owner: Eng. Timeline risk: Medium (needs careful implementation).
-   Parser library — required for JSON-LD/microdata/heuristics. Owner: Eng. Timeline risk: Medium (complexity in the long tail).

**Known Risks:**

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Extraction fails on popular sites | High | High | Three-tier parser + manual entry fallback + per-site heuristics later |
| Sites block scraping | Medium | Medium | robots.txt compliance, polite User-Agent, HTTPS only |
| Inconsistent step structure | High | Medium | Hierarchical Step model + editable review screen |
| Duplicate/low-quality imports | Medium | Medium | Duplicate detection + attribution + moderation later |
| Image licensing | Low | Low | Store URL by default; lazy copy; attribution |
| Scope creep on parser | High | Medium | Lock parser scope at MVP; defer per-site heuristics to P2 |

**Open Questions (must resolve before dev start):**
-   [ ] Should imported recipes be editable by the community, or only by the owner? (Current: owner only; F-27 extends this.) Owner: PM. Deadline: Before Phase 1 kickoff.
-   [ ] Is a tag taxonomy needed before categories (F-17)? (Recommend: free tags first, curated categories later.) Owner: PM. Deadline: Phase 2.
-   [ ] What is the acceptable import latency budget on slow sites? (Current: 10s timeout; revisit with real data.) Owner: Eng. Deadline: Phase 1.
-   [ ] What is the data retention policy for deleted accounts? (Current: soft delete; hard purge after 90 days.) Owner: PM + Legal. Deadline: Phase 3.

---

## 8. Roadmap (Now / Next / Later)

### 🌟 North Star Metric

**Weekly active importers:** the number of users who import at least one recipe per week. This captures both the core loop (import) and engagement.
**Current:** n/a (pre-launch)  **Target by EOY:** 500 weekly active importers.

### 🟢 Now — Active This Quarter (Phase 1: MVP)

| Initiative | User Problem | Success Metric | Owner | Status | ETA |
|-----------|-------------|----------------|-------|--------|-----|
| F-01 Accounts | Secure onboarding and ownership | 100% of users can register/login | Eng | Scoped | Week 2 |
| F-02 Table view | Consistent, scannable recipes | 100% of recipes in strict table | Eng | Scoped | Week 4 |
| F-03 URL import | Save recipes without re-typing | ≥80% of URLs produce a usable draft | Eng | Scoped | Week 6 |
| F-04 Search | Find recipes by ingredient/tag | ≥80% of searches return relevant results | Eng | Scoped | Week 7 |
| F-05 Edit/delete | Owners manage their recipes | 100% of edits/deletes work for owners only | Eng | Scoped | Week 7 |
| F-06 Share/export | Distribute recipes outside the app | 100% of exports include attribution | Eng | Scoped | Week 8 |
| F-07 Manual entry | Complete import when extraction fails | 100% of failed imports can be saved manually | Eng | Scoped | Week 6 |
| F-08 Duplicate detection | Avoid duplicate recipes | 100% of duplicates warned on import | Eng | Scoped | Week 6 |
| F-09 Import safety | Legal/operational compliance | 0 robots.txt violations, 0 SSRF incidents | Eng | Scoped | Week 5 |
| F-10 Attribution | Trust and legal compliance | 100% of imported recipes have attribution | Eng | Scoped | Week 6 |
| F-11 Public by default | Community discovery | 100% of new recipes public unless hidden | Eng | Scoped | Week 5 |
| F-12 Listing/browsing | Find recipes after importing | Paginated list with title/tags/source | Eng | Scoped | Week 5 |
| F-13 Soft delete | Safe deletion | 100% of deletes are soft and restorable | Eng | Scoped | Week 5 |
| F-14 Password reset | Account recovery | 100% of password resets work | Eng | Scoped | Week 3 |

**Exit criteria (Phase 1):** A registered user can import a real recipe URL, review it, save it, find it by search, edit it, share it, and delete it. All recipes render in the strict table layout. No P0 bugs.

### 🟡 Next — Next 1–2 Quarters (Phase 2: Polish and Trust)

| Initiative | Hypothesis | Expected Outcome | Confidence | Blocker |
|------------|------------|-----------------|------------|---------|
| F-21 Responsive table | If the table works on mobile, mobile users will adopt | ≥40% of traffic from mobile with no layout break | High | None |
| F-19 Image handling | If recipes show images, browse time increases | +20% time-on-page | High | None |
| F-20 Quantity normalization | If dual units render, fidelity improves | 0 complaints on quantity display | Medium | None |
| F-22 Accessibility | If the table is accessible, more users can use it | WCAG AA compliance | High | None |
| F-23 Full-text search | If search is full-text, ranking improves | +15% search success rate | Medium | None |
| F-15 Rate limiting | If imports are rate-limited, abuse drops | 0 abuse incidents | High | None |
| F-16 OAuth | If OAuth is available, onboarding is faster | +10% registration conversion | Medium | None |
| F-17 Categories | If categories exist, browsing improves | +20% browse sessions | Medium | Needs tag taxonomy |
| F-18 Profiles | If profiles exist, community engagement grows | +15% profile views | Low | None |
| F-24 Bulk import | If bulk import exists, power users import more | +30% imports per power user | Low | None |

### 🔵 Later — 3–6 Month Horizon (Phase 3: Community Growth)

| Initiative | Strategic Hypothesis | Signal Needed to Advance |
|------------|---------------------|--------------------------|
| F-29 Similar recipes | If we suggest similar recipes, discovery improves | ≥30% of views from search/browse |
| F-28 Notifications | If we notify on matches, retention improves | ≥60% 30-day return rate |
| F-30 Content moderation | If we moderate, trust improves | First abuse report received |
| F-31 Data portability | If we allow export/delete, trust and compliance improve | First compliance request |
| F-26 Edit history | If we show history, trust improves | First edit dispute |
| F-27 Share permissions | If we allow shared editing, small groups adopt | First request from a group |
| F-25 Print view | If we allow print, cooks use it | First print request |
| F-32 Analytics dashboard | If we have analytics, we can prioritize P3 | Phase 2 complete |

### ❌ What We're Not Building (and Why)

| Request | Source | Reason for Deferral | Revisit Condition |
|---------|--------|---------------------|-------------------|
| Recipe marketplace (payments) | Stakeholder | No monetization model validated; scope creep | Revenue model validated + demand signal |
| Native mobile app | Stakeholder | Web first; mobile app is a large lift | ≥20% mobile traffic sustained |
| AI-generated recipes | Stakeholder | Core value is import, not generation; quality risk | User demand for generation |
| User-to-user messaging | Stakeholder | Not needed for the core loop; scope creep | Community size > 10k users |
| Recipe ratings/reviews | Stakeholder | Not meaningful until the community is large | ≥1k public recipes |

---

## 9. Launch Plan

| Phase | Audience | Success Gate |
|-------|----------|-------------|
| Internal alpha | Team + 5 design partners | No P0 bugs, core flow complete, import success ≥80% on test URLs |
| Closed beta | 50 opted-in users | <5% error rate, import success ≥80%, 0 SSRF/robots incidents |
| GA rollout | 20% → 100% over 2 weeks | Metrics on target at 20% (import success, time-to-save, adoption) |

**Rollback Criteria:** If import error rate exceeds 5% or SSRF/robots.txt violations occur, revert the import flag and page on-call.

---

## 10. Appendix

-   `docs/user-journeys.md` — User journeys and edge cases
-   `docs/data-model.md` — Entities, relationships, rendering rules
-   `milestones/01-foundation.md` through `milestones/05-share-export.md` — Implementation milestones
-   Reference layout: the provided recipe table image (title, prep note, ingredient rows, action columns, final bake column)
