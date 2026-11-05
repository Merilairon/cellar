# Recipe Book — Task Assignments

Maps each release slice to the specialist agents in [.claude/agents/](../.claude/agents). Slices follow [RELEASE_PLAN.md](RELEASE_PLAN.md). **Lead** owns delivery of the slice; **Support** contributes; **Gate** must sign off before the slice is marked done.

## Governance (all slices)

| Role | Agent | Responsibility |
| --- | --- | --- |
| Pipeline owner | agents-orchestrator | Runs the dev → QA loop per slice, blocks on failed gates |
| Task breakdown | project-manager-senior | Converts each milestone spec into a task list; guards scope and the cut line |
| Prioritisation | product-sprint-prioritizer | Fits slices into weekend sprints; re-splits any slice over 2 weekends |
| Product owner proxy | product-manager | Keeps PRD acceptance criteria and metrics honest |
| Architecture | engineering-software-architect | Stack decisions, module boundaries (`lib/db`, `lib/import`, `lib/units`, `lib/auth`) |
| Git hygiene | engineering-git-workflow-master | Branching per slice, conventional commits, release tags |
| Code review | engineering-code-reviewer | Review every slice diff before merge |
| Final QA | testing-reality-checker | Default "NEEDS WORK" gate; checks the Definition of Done |

## Pre-work spikes

| Spike | Lead | Support |
| --- | --- | --- |
| Grid + grid editor prototype (375 / 768 / 1280 px) | design-ux-architect | design-ui-designer, design-ux-researcher |
| Headless sidecar on x86 + arm64 (before 03c) | engineering-devops-automator | security-architect |

## v0.1 — M1 Foundation

| Task | Lead | Support |
| --- | --- | --- |
| App skeleton, Next.js + Tailwind, folder layout | engineering-frontend-developer | engineering-software-architect |
| SQLite + Drizzle schema, migrations, FTS5 setup | engineering-backend-architect | engineering-database-reliability-engineer |
| Auth: argon2, DB sessions, admin reset + `admin:reset` CLI | engineering-identity-access-engineer | security-appsec-engineer |
| Rate limiting, security headers, CSRF | security-appsec-engineer | engineering-backend-architect |
| i18n scaffolding (`next-intl`, `messages/en.json`) | engineering-i18n-engineer | engineering-frontend-developer |
| Docker multi-stage, multi-arch (amd64 + arm64), compose, Caddy example | engineering-devops-automator | security-architect |
| Test harness (Vitest, Playwright), CI | testing-test-automation-engineer | engineering-devops-automator |
| README, env var reference | engineering-technical-writer | — |
| Gate | security-architect (threat model), testing-reality-checker | |

## v0.2 — M2 Recipe View

| Task | Lead | Support |
| --- | --- | --- |
| Recipe CRUD API and queries | engineering-backend-architect | engineering-database-reliability-engineer |
| Grid component (sections, repeatable rows, banners) + list view | engineering-frontend-developer | design-ui-designer |
| Responsive layout and visual system | design-ui-designer | design-ux-architect |
| Grid table semantics, keyboard navigation | testing-accessibility-auditor | engineering-frontend-developer |
| Visual tests at 375 / 768 / 1280 px | testing-evidence-collector | testing-test-automation-engineer |
| Gate | testing-reality-checker | |

## v0.3.x — M3 URL Import

| Slice | Task | Lead | Support |
| --- | --- | --- | --- |
| 03a | Fetch, cheerio, JSON-LD parsing, ingredient parser | engineering-backend-architect | engineering-software-architect |
| 03a | SSRF protection (allowlist of schemes, private-IP blocking, redirect limits) | security-appsec-engineer | security-penetration-tester |
| 03a | Paste fallback, cover image, basic review UI | engineering-frontend-developer | design-ux-architect |
| 03a | Fixture corpus (~30 pages) and success-rate report (target ≥ 85 %) | testing-api-tester | testing-test-automation-engineer |
| 03b | Step-by-ingredient auto-mapper with confidence score | engineering-backend-architect | engineering-knowledge-graph-engineer |
| 03b | Grid preview and mapping review UX | design-ux-architect | engineering-frontend-developer |
| 03c | Sandboxed Playwright sidecar, optional `HEADLESS_URL` | engineering-devops-automator | security-architect |
| 03c | Sandbox escape and SSRF pen test | security-penetration-tester | — |
| All | Gate | testing-reality-checker, engineering-code-reviewer | |

## v0.4.x — M4 Search, Units, Editor, Media

| Slice | Task | Lead | Support |
| --- | --- | --- | --- |
| 04a | FTS5 search and tags | engineering-database-reliability-engineer | engineering-backend-architect |
| 04a | Unit table, dual-unit conversion, scaling | engineering-backend-architect | engineering-i18n-engineer |
| 04a | Search and preference UI | engineering-frontend-developer | design-ui-designer |
| 04b | Visual grid editor (sections, split rows, banners) | engineering-frontend-developer | design-ux-architect |
| 04b | Editor usability check with family personas | design-ux-researcher | — |
| 04c | Photo upload and validation, notes, ratings | engineering-backend-architect | security-appsec-engineer |
| 04c | Cook mode (first to cut) | engineering-frontend-developer | design-ui-designer |
| 04c | Performance baseline (search, image sizes, Pi-class hardware) | testing-performance-benchmarker | engineering-devops-automator |
| All | Gate | testing-reality-checker, testing-accessibility-auditor | |

## v1.0 — M5 Share & Export

| Task | Lead | Support |
| --- | --- | --- |
| Visibility model, Save a copy, public links + `PUBLIC_LINKS_ENABLED` | engineering-backend-architect | engineering-identity-access-engineer |
| Copyright warning, source banner, sharing UX | design-ux-architect | support-legal-compliance-checker |
| Print-friendly grid | engineering-frontend-developer | design-ui-designer |
| JSON backup and restore on a clean instance | engineering-database-reliability-engineer | engineering-devops-automator |
| Security review (SSRF, auth, uploads, CSRF, public link scoping) | security-penetration-tester | security-appsec-engineer, security-architect |
| Accessibility pass on grid | testing-accessibility-auditor | — |
| Install, config, backup and upgrade docs | engineering-technical-writer | specialized-developer-advocate |
| Release tag and changelog | engineering-git-workflow-master | — |
| Gate | testing-reality-checker (full checklist) | |

## Not assigned

These agents do not fit the project and are left idle: game-designer, narrative-designer, engineering-data-visualization-engineer, engineering-realtime-collaboration-engineer (no live editing; shared recipes are read-only), specialized-mcp-builder, project-assistant, explore (use for codebase lookups on demand).

## Per-slice workflow

1. project-manager-senior writes the task list from the milestone file.
2. Leads implement; support agents review their area.
3. engineering-code-reviewer reviews the diff.
4. testing-reality-checker verifies the Definition of Done; failures loop back to the lead.
5. engineering-git-workflow-master tags the release.
