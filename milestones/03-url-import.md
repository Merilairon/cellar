# Milestone 03 — URL Import (v0.3)

**Objective:** Import a recipe from a URL: fetch → parse Schema.org → auto-map grid → review → save, with headless and paste fallbacks.

**Technical Context:**
- Pipeline and heuristics: [data-model.md](../docs/data-model.md) §3. Table `import_job`.
- Parser from M2 (`ingredient-parser.ts`) is reused.
- Headless fetching runs in an optional sidecar container (`browser` service, Playwright) exposed on the internal Docker network only; the app calls it over HTTP.
- Security is critical: this feature makes the server fetch user-supplied URLs, and the instance is internet-exposed.
- Tables created here: `import_job` and `photo` (the cover image is stored in this milestone; M4 adds the upload UI).

**Delivery slices (PM decision; each is releasable):**
- **3a (v0.3.0) Static import:** requirements 1–4 (static fetch and paste only), 6–9, with a basic review screen that saves in list view.
- **3b (v0.3.1) Auto-mapper:** requirements 5 and 12, plus grid preview and confidence in the review screen.
- **3c (v0.3.2) Headless sidecar:** requirements 10, 11 and the headless step in 4. Optional everywhere: when `HEADLESS_URL` is unset (Raspberry Pi, Home Assistant, small VPS) the app skips it and falls back to paste mode with a clear message.
- Requirements 13–14 apply from 3a.

**Requirements:**
1. **SSRF guard** `src/lib/import/safe-fetch.ts`: http/https only; resolve DNS and reject loopback, private, link-local, and metadata IPs (IPv4 and IPv6); re-check on each redirect (max 5); 5 MB size cap; 10 s timeout; custom User-Agent. Unit tests for bypass attempts (decimal IPs, `0.0.0.0`, DNS rebinding to private IP, redirect to localhost).
2. **JSON-LD extractor**: find all `<script type="application/ld+json">`, handle `@graph`, arrays, and `@type` of string or array; select the `Recipe` node.
3. **Normalizer**: map to draft per data-model §3 (ISO-8601 durations, `recipeYield` forms, `HowToStep`/`HowToSection`, image variants, keywords → tags).
4. **Fallback chain** (recorded in `import_job.method`): static fetch → headless sidecar if no Recipe found or HTTP 403/429/JS-only → `paste` mode where the user submits recipe text or page HTML. Microdata (`itemprop`) as an extra static parser if time allows.
5. **Auto-mapper** `src/lib/import/map-grid.ts` implementing heuristic steps 1–6 in data-model §3 with a verb list, ingredient-name matching (singular/plural, synonyms, parenthetical removal), banner detection, and a 0–1 confidence score. Pure functions, heavily unit-tested.
6. **API:** `POST /api/import` (`{url}` or `{text}`) creates job, runs pipeline, returns draft + confidence + warnings; `POST /api/import/:id/save` persists the (possibly edited) draft as a recipe with `source_url`, `source_name`. Rate-limit per user.
7. **UI:** Import dialog with progress states (fetching, rendering page, parsing); review screen showing editable metadata, ingredients, steps, and live `RecipeGrid` preview with the confidence badge; paste-fallback form; clear, translated error messages per `error_code` (`blocked`, `no_recipe`, `timeout`, `invalid_url`, `private_address`).
8. Duplicate detection on `source_url` with a link to the existing recipe.
9. Download the cover image to `/data/uploads` on save (validate type and size; re-encode).
10. Docker: add the optional `browser` service under a compose profile and an env var `HEADLESS_URL`; if unset, skip the headless step with a clear message.
11. **Headless sandbox** per data-model §3 Safety: isolated network, request interception with IP checks and DNS pinning, no downloads/file://, fresh context per job, resource limits, 30 s kill. Tests: page that redirects to `http://127.0.0.1`, page with a sub-resource pointing at a private IP, DNS-rebinding fixture.
12. Sections: map `HowToSection` and "For the …" headings to sections; support split ingredients and bottom banners in the auto-mapper.
13. Use the M1 rate-limit helper on `/api/import`.
14. Fixture corpus stores extracted JSON-LD and minimal HTML, not full copyrighted pages.

**Acceptance Criteria:**
- On the fixture corpus (`tests/fixtures/import/`, ≥ 30 pages) ≥ 85 % produce a valid draft; the report is printed by `npm run test:import`.
- Auto-mapper reproduces the sample recipe's grid (same structure as the reference) from its plain-text steps with confidence ≥ 0.7.
- SSRF tests (including the headless cases) all pass; no request is ever made to a blocked address.
- Failed imports never create a recipe; user can recover via paste mode.

**Instructions for LLM:**
* Build `safe-fetch` first and test it before any other import code.
* Make the extractor, normalizer and mapper pure functions that take strings/objects and return objects; fetching lives only in `safe-fetch.ts` and the headless client.
* Sanitize all imported text (strip HTML tags/scripts) before storing or rendering.
* Never store raw HTML permanently unless the `KEEP_RAW_HTML` env var is set.
* Do not add AI/LLM calls.
