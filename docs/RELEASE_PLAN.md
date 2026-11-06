# Cellar — Release Plan

Milestones are sequential; each one is a runnable, deployable version. Specs live in [../milestones/](../milestones).

| Version | Milestone | Outcome |
| --- | --- | --- |
| v0.1 | [01 Foundation](../milestones/01-foundation.md) | App skeleton, DB, auth, i18n, Docker, HTTPS proxy example, rate limiting, security headers |
| v0.2 | [02 Recipe View](../milestones/02-recipe-view.md) | Manual recipes + grid/list view |
| v0.3.0 | [03a URL Import: static](../milestones/03-url-import.md) | Static fetch + paste, JSON-LD, cover image, basic review (list view) |
| v0.3.1 | 03b Auto-mapper | Grid auto-mapping with confidence and grid preview |
| v0.3.2 | 03c Headless sidecar | Sandboxed browser for JS-rendered/blocked pages |
| v0.4.0 | [04a Search & Units](../milestones/04-search-edit.md) | Search, tags, unit conversion, scaling |
| v0.4.1 | 04b Grid editor | Visual editor with sections, split rows, banners |
| v0.4.2 | 04c Media & notes | Photos, notes, ratings, cook mode |
| v1.0 | [05 Share & Export](../milestones/05-share-export.md) | Visibility, public links, print, JSON backup, hardening |

## Planning Status (PM)

Open topics carried past v0.2: [tasks/v0.2-carryover.md](tasks/v0.2-carryover.md). Past v0.3.0: [tasks/v0.3.0-carryover.md](tasks/v0.3.0-carryover.md). Past v0.3.1: [tasks/v0.3.1-carryover.md](tasks/v0.3.1-carryover.md). Past v0.3.2: [tasks/v0.3.2-carryover.md](tasks/v0.3.2-carryover.md).

| Item | Status |
| --- | --- |
| Release status | v0.1 released. v0.2 released. **v0.3.0: implemented, pending gate** (code review, testing-reality-checker verdict, then tag `v0.3.0`; see [tasks/v0.3.0-tasklist.md](tasks/v0.3.0-tasklist.md)). **v0.3.1: implemented, pending gate** (code review, testing-reality-checker verdict, then tag `v0.3.1`; open topics in [tasks/v0.3.1-carryover.md](tasks/v0.3.1-carryover.md); see [tasks/v0.3.1-tasklist.md](tasks/v0.3.1-tasklist.md)). **v0.3.2: implemented, pending gate** (code review, testing-reality-checker verdict, then tag `v0.3.2`; arm64 and several checks unverified, listed in [tasks/v0.3.2-carryover.md](tasks/v0.3.2-carryover.md); see [tasks/v0.3.2-tasklist.md](tasks/v0.3.2-tasklist.md)) |
| Owner | Jan Baetens (product, review); AI coding tools (implementation) |
| Pace | Weekend sprints, no fixed deadline. Plan: **one slice (or one small milestone) per 1–2 weekends**; M1 and M2 get two weekends each. Rough total to v1.0: 12–16 weekends. Re-split any slice that cannot finish in two weekends |
| Pre-M2 spike | Wireframe/prototype the grid (desktop + 375 px phone) and the grid editor. Brownie spans already verified against the reference image |
| Pre-M3c spike | **Done (S0, 2026-11-06):** x86 verified, arm64 pending the CI QEMU job ([tasks/v0.3.2-spike.md](tasks/v0.3.2-spike.md)). Goal: verify the headless sidecar on x86 and arm64. It stays optional (off by default, `HEADLESS_URL` unset) so Raspberry Pi, Home Assistant and small-VPS installs work without it |
| Cut line | If time runs short: cut cook mode, then ratings, then 4c entirely. Never cut sections, sandboxing, or backup/restore |
| Metric tracking | From DB counts and the import fixture report; no analytics |

## Deployment Targets (decided)

| Target | Notes |
| --- | --- |
| Dedicated x86 server (primary) | Docker Compose with optional headless sidecar and Caddy profile |
| Raspberry Pi / Home Assistant OS | **arm64 image required** from M1 (multi-arch build, amd64 + arm64). A Home Assistant add-on is a possible post-1.0 packaging (v1.1): it needs a single container, add-on config, persistent `/data`, and a decision on ingress vs the app's own accounts. No headless sidecar there by default |
| Small cloud VPS (1–2 GB) | Works without the headless sidecar; with it, add swap or a bigger plan |

## Dependencies

```
01 ─► 02 ─► 03 ─► 04 ─► 05
          └────────▲
   (grid editor in 04 reuses components from 02; import review in 03 uses a basic editor upgraded in 04)
```

## Definition of Done (every milestone)

- Acceptance criteria in the milestone file are met.
- Unit tests for new logic; e2e test for the main flow.
- No TypeScript errors; lint clean.
- All new UI strings are in the message catalog.
- `docker compose up` works from a clean checkout; migrations run automatically.
- Docs updated (README, data-model if schema changed).

## Test Corpus

Maintain `tests/fixtures/import/` with saved HTML for ~30 recipe pages (varied JSON-LD shapes, a JS-rendered site, a paywalled one, a non-recipe page) used for import success-rate measurement (target ≥ 85 %).

## v1.0 Release Checklist

- [ ] Security review: SSRF, auth, upload validation, CSRF, public link scoping
- [ ] Accessibility pass on grid (keyboard, screen reader table semantics)
- [ ] Backup and restore verified on a clean instance
- [ ] Docker image size and startup documented; headless sidecar optional
- [ ] README with install, configuration (env vars), backup and upgrade instructions
- [ ] Invite family; collect feedback for 2 weeks

## Post-1.0 Backlog

Shopping list · meal planner · PDF export · Schema.org export · more languages · browser bookmarklet · OIDC login · AI-assisted import mapping.
