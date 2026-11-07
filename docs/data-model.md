# Cellar — Data Model

SQLite. IDs are ULIDs (text). Timestamps are ISO-8601 UTC text.

## 1. Entities

### user
| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| email | text unique | stored lowercased |
| display_name | text | |
| password_hash | text | argon2id (PHC string) |
| role | text | `admin` \| `member` |
| unit_pref | text | `metric` \| `us`, default `metric` |
| locale | text | default `en` |
| created_at | text | |
| deactivated_at | text | nullable; set = account cannot log in, sessions are deleted, row kept. Counts as "not active" for the last-admin guard |

### session
| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | SHA-256 hex of the random cookie token (not a ULID); a DB leak does not yield usable cookies |
| user_id | text FK user | `ON DELETE CASCADE` |
| expires_at | text | |
| created_at | text | |

Index on `user_id` (bulk invalidation) and `expires_at` (cleanup).

### invite
| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| token_hash | text unique | SHA-256 hex; plaintext token is shown once and never stored |
| email | text | nullable; if set, the registration form uses it |
| created_by | text FK user | `ON DELETE CASCADE` |
| expires_at | text | |
| used_at | text | nullable; set atomically on consumption (single use) |

### password_reset
Admin-issued or CLI-issued one-time reset links (`/reset/<token>`). Separate from `invite` because an invite creates a user and a reset targets an existing one.

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| user_id | text FK user | `ON DELETE CASCADE` |
| token_hash | text unique | SHA-256 hex |
| created_by | text FK user | nullable (null = issued by CLI `admin:reset`); `ON DELETE SET NULL` |
| expires_at | text | |
| used_at | text | nullable; single use |
| created_at | text | |

Using a reset link sets the new password, marks `used_at`, deletes all of the user's sessions, and voids other unused resets for that user. It never reactivates a deactivated user.

### recipe
| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| owner_id | text FK user | |
| title | text | |
| description | text | nullable |
| servings | real | base yield; nullable (not every recipe states one, e.g. the reference) |
| servings_label | text | e.g. "brownies" |
| prep_minutes / cook_minutes | integer | nullable |
| source_url | text | nullable, attribution |
| source_name | text | nullable |
| visibility | text | `private` \| `users` (all signed-in users, read-only) |
| share_token | text unique | nullable; when set, anyone with `/r/<token>` can read. Independent of `visibility`, so a recipe can be shared with all users *and* by link |
| copied_from_id | text FK recipe | nullable; set by **Save a copy** |
| view_mode | text | `grid` \| `list`; `list` until a grid mapping is confirmed |
| created_at / updated_at | text | |

### section
A recipe has one or more grid sections (e.g. "Cake", "Frosting"); each renders as its own grid. `id`, `recipe_id`, `position`, `title` (nullable for single-section recipes). Every recipe has at least one section.

### ingredient
One row per **grid row** (not per distinct ingredient), ordered by first use within its section. An ingredient used in two steps ("half the sugar now, half later") is stored as two rows that share a `split_group_id`.

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| recipe_id | text FK | cascade delete |
| section_id | text FK section | |
| position | integer | 0-based row index within the section |
| split_group_id | text | nullable; rows sharing a value are portions of the same ingredient |
| portion_label | text | nullable, e.g. "half", "remaining" |
| name | text | normalized, e.g. "unsalted butter" |
| note | text | nullable, e.g. "melted" |
| raw_text | text | original line as imported |
| metric_qty / metric_unit | real / text | e.g. 115, `g` |
| metric_qty_max | real | nullable upper bound of a range (`100-150 g`); added in migration `0002_qty_max` |
| us_qty / us_unit | real / text | e.g. 4, `oz` |
| us_qty_max | real | nullable upper bound of a range (`2-3 tbsp`); migration `0002_qty_max` |
| display_primary | text | `metric` \| `us` — which unit was original |
| group_label | text | nullable ("For the sauce") |

Either measure may be null; the missing one is derived by the conversion engine (§4).

### step
| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | |
| recipe_id | text FK | |
| section_id | text FK section | |
| position | integer | 0-based order within the section |
| kind | text | `banner_top` \| `column` \| `banner_bottom` |
| label | text | short verb, e.g. "mix", "fold in", "bake" |
| detail | text | full instruction text (shown expanded / in list view) |
| row_start | integer | nullable; first ingredient position covered (inclusive) |
| row_end | integer | nullable; last ingredient position covered (inclusive) |
| temp_c / temp_f | integer | nullable |
| minutes_min / minutes_max | integer | nullable, e.g. 30–40 |

- `banner_top` steps are full-width rows above the ingredients ("Preheat oven…"); `banner_bottom` steps are full-width rows below them for work after the last column step ("Cool 20 min, frost, serve").
- `column` steps require `row_start ≤ row_end` (rows are within the step's section).
- A step with no ingredients in the middle of a recipe ("rest 10 min") is a `column` step spanning all rows combined so far.

**Implementation notes (v0.2, migration `0001_recipes`)**
- Foreign keys: `section`, `ingredient`, `step` -> `recipe` and `ingredient`/`step` -> `section` are `ON DELETE CASCADE`. `recipe.owner_id` -> `user` is `RESTRICT` (a user delete must reassign or delete recipes explicitly, see `deleteUserGuarded`). `recipe.copied_from_id` -> `recipe` is `ON DELETE SET NULL`.
- Indexes: `recipe(owner_id)`, `recipe(copied_from_id)`, `recipe(visibility, updated_at)`, `ingredient(recipe_id)`, `step(recipe_id)`; unique `section(recipe_id, position)`, `ingredient(section_id, position)`, `step(section_id, position)`; unique `recipe(share_token)`.
- CHECK constraints: `recipe.visibility`, `recipe.view_mode`, `ingredient.display_primary`, `step.kind` enums; and on `step`: banners must have NULL `row_start`/`row_end`, a column has both null (list-mode recipe) or both set with `0 <= row_start <= row_end`. Range against the ingredient count is validated in `src/lib/grid/validate.ts`.
- `recipe.view_mode` defaults to `list`; the API computes `grid` when every column step has a valid span (and there is at least one). `step.detail` defaults to `''`. `split_group_id` is a plain ULID column (no table, no FK); the API rewrites client-supplied group values to fresh ULIDs.
- `share_token` exists but is unused until M5.
- Ingredient ranges ("2-3") store the lower bound in `*_qty` and the upper bound in `*_qty_max` (migration `0002_qty_max`; only the primary side (the first-written unit system) keeps a range, the other side of a dual-unit line is always a single quantity; null for single quantities; the API rejects a max without a qty or not above it). The original line stays in `raw_text`. Display renders `2-3 tbsp`. Unit conversion, when it arrives, must convert both bounds. Units outside metric/US (can, clove, pinch) are stored in `metric_qty` with the unit text in `metric_unit`; plain counts have a null unit.
- Until the grid editor (M4), `PUT /api/recipes/:id` replaces all sections/ingredients/steps atomically (child ids change). Omitting `visibility` keeps the stored value. Omitting `view_mode` keeps a stored `list`; a stored `grid` stays `grid` only while the spans are still valid (otherwise the recomputed default, `list`). Mutating recipe endpoints require `Content-Type: application/json` (415 otherwise). Authorization is re-checked inside the write transaction.

### tag / recipe_tag
Added in migration `0005_search_tags` (v0.4.0).

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `tag` | id | text PK | ULID |
| | name | text unique, not null | stored normalized (below); CHECK `length(name) BETWEEN 1 AND 40` |
| | created_at | text | |
| `recipe_tag` | recipe_id | text FK recipe | `ON DELETE CASCADE` |
| | tag_id | text FK tag | `ON DELETE CASCADE`; index `recipe_tag_tag_id_idx` |

`recipe_tag` has composite primary key `(recipe_id, tag_id)`. Tags outlive the recipes that use them (an unused tag row is harmless).

**Normalization and limits (owner decision Q7).** The service layer (T4) trims, collapses inner whitespace, applies Unicode NFC and lowercases, so "Dessert" and "dessert" are one tag; capitalization is not preserved and display is lowercase. 1 to 40 characters, no control characters. At most 20 tags per recipe. The DB enforces only what SQL can do reliably: the length CHECK, `name` uniqueness and a `BEFORE INSERT` trigger on `recipe_tag` (`recipe_tag_limit_bi`) that aborts with `recipe_tag_limit` when a recipe already has 20. Case folding is not a CHECK because SQLite `lower()` is ASCII-only. Tag names are rendered as React text only.

### photo
(migration `0003_import_photo`)

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | ULID |
| recipe_id | text FK recipe | `ON DELETE CASCADE`; the recipe delete service also removes the files (best effort) |
| file_path | text | relative to the uploads dir (`UPLOADS_DIR`, `/data/uploads` in Docker), server-generated `<ulid>.webp`, never absolute or user-supplied |
| width / height | integer | pixels after re-encode |
| position | integer | default 0 |
| is_cover | integer (boolean) | default 0; unique partial index `photo(recipe_id) WHERE is_cover = 1` allows one cover per recipe |
| created_at | text | |

### note
`id`, `recipe_id`, `user_id`, `body`, `shared` (bool: visible to everyone who can see the recipe), `created_at`.

### rating
`recipe_id`, `user_id`, `stars` (1–5); PK `(recipe_id, user_id)`.

### import_job
(migration `0003_import_photo`)

| Column | Type | Notes |
| --- | --- | --- |
| id | text PK | ULID |
| user_id | text FK user | `ON DELETE CASCADE` (drafts are disposable) |
| url | text | nullable (paste jobs have none) |
| status | text | `queued\|fetching\|parsed\|needs_review\|failed\|saved`, default `queued` |
| method | text | nullable until decided: `static\|headless\|paste` (`headless` is written from v0.3.2 only) |
| error_code | text | nullable: `blocked\|no_recipe\|timeout\|invalid_url\|private_address\|too_large\|fetch_failed` |
| raw_html_path | text | nullable; only set when `KEEP_RAW_HTML` is on |
| draft_json | text | nullable; the normalized draft (includes tags, which have no table until M4) |
| recipe_id | text FK recipe | nullable, `ON DELETE SET NULL`; set on save |
| created_at / updated_at | text | |

Indexes: `import_job(user_id, created_at)`, `import_job(recipe_id)`. CHECK constraints enforce the three enums. `recipe(source_url)` is indexed (migration `0003`) for duplicate detection; `recipe.source_url` is stored in canonical form **with the scheme the user entered** (`storedSourceUrl` in `src/lib/import/source-url.ts`), so an http-only site keeps a working link. Duplicate detection uses a separate comparison key (`normalizeSourceUrl`): always `https`, host lowercased (`www.` kept), fragment, default port, `utm_*`, `fbclid` and `gclid` removed, remaining query parameters sorted, trailing slash removed. The duplicate lookup matches both stored schemes. Rows written by v0.3.0 (always `https`) stay as they are.

**Retention (v0.3.2, no schema change).** `draft_json` (up to 512 KB) and kept raw HTML files would otherwise grow forever. Jobs whose `updated_at` is older than `IMPORT_JOB_TTL_DAYS` (default 30, `0` disables) are pruned lazily from `createImport` (at most once an hour per process, at most 100 rows per run, no background process): `failed`, `needs_review` and `parsed` rows are deleted; `saved` rows are kept (provenance, duplicate lookup) but lose `draft_json` and `raw_html_path`; `queued` and `fetching` are never touched (stale `fetching` becomes `failed` first). The raw HTML file `<RAW_HTML_DIR>/<job id>.html` is unlinked after the row change commits (best effort; paths outside `RAW_HTML_DIR` and the legacy v0.3.0 location `<dir of UPLOADS_DIR>/import-raw`, or with another name, are ignored). Each row is changed with a compare-and-set on status and `updated_at`, so a job saved concurrently is skipped. Recipes, photos and `recipe.source_url` are never touched. Re-running is a no-op.

v0.3.1 added no migration, table or column. The mapping proposal lives inside `draft_json` (see §3).

### recipe_fts
FTS5 virtual table, created in migration `0005_search_tags` (hand-written SQL: drizzle-kit cannot model FTS5 or triggers; `schema.ts` has a pointer comment and the `0005` snapshot covers only `tag` and `recipe_tag`).

```sql
CREATE VIRTUAL TABLE recipe_fts USING fts5(
  recipe_id UNINDEXED, title, description, ingredients, tags, notes,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
```

One ordinary (not contentless) row per recipe, so FTS row count equals recipe count.

| Column | Content |
| --- | --- |
| `recipe_id` | `recipe.id`; stored, not searchable |
| `title`, `description` | as stored (`''` when null) |
| `ingredients` | `ingredient.name` plus `ingredient.note` per row, space-joined (ordered by ingredient id). **Not** `raw_text`, **not** section titles (Q9) |
| `tags` | tag names of the recipe, space-joined, ordered by name |
| `notes` | **reserved, always `''`** until 04c adds triggers on the `note` table (Q2). Private notes cannot live in a shared row; 04c decides between a per-user second index and a join check |

`remove_diacritics 2` plus the unicode61 case folding make "creme" find "Crème" and "espresso" find "ESPRESSO"; `prefix = '2 3'` makes 2 and 3 character prefixes (`esp*`) cheap.

**Sync triggers.** Every trigger runs the same "rebuild row for recipe X": `DELETE FROM recipe_fts WHERE recipe_id = X`, then `INSERT ... SELECT` aggregating the ingredient and tag text for X (no row is inserted if the recipe no longer exists, which makes cascaded deletes safe whatever the firing order):

| Trigger | Fires on |
| --- | --- |
| `recipe_fts_recipe_ai` / `_au` / `_ad` | `recipe` insert / update of `title`, `description` / delete (delete only removes the row) |
| `recipe_fts_ingredient_ai` / `_au` / `_ad` | `ingredient` insert / update of `name`, `note` / delete |
| `recipe_fts_recipe_tag_ai` / `_ad` | `recipe_tag` insert / delete |
| `recipe_fts_tag_au` | `tag` update of `name` (rebuilds every recipe carrying the tag) |

Moving an ingredient to another recipe (`recipe_id` update) is not handled; the app never does it. Cost note: a `PUT` rewrites all ingredients, so a recipe with N ingredients fires about 2N rebuilds in one transaction; the `recipe_id` lookup in the FTS table is a scan (the column is UNINDEXED), accepted at this data size and to be measured by T6.

**Backfill.** The migration ends the table setup with one `INSERT INTO recipe_fts ... SELECT` over every existing recipe, so recipes created before v0.4.0 are searchable immediately; tags are empty at that point.

**Test.** `src/lib/db/search-schema.test.ts` applies `0000`-`0004` to a database with data, then `0005`, and asserts rows unchanged, backfill, `foreign_key_check` and `integrity_check` clean, re-run is a no-op, each trigger, and the invariant that after 200 seeded mixed writes the index equals an independently computed rebuild from the source tables.

## 2. Grid Model

Each **section** renders as its own grid, derived from its `ingredient.position` (rows) and its `step` rows (columns). The reference recipe is a single-section example.

```
row \ col   (banner rows span full width)
 BT0  Butter and flour an 8x8-in pan                      step kind=banner_top  pos 0
 BT1  Preheat oven to 350°F (170°C)                       step kind=banner_top  pos 1
 r0   4 oz unsalted butter     | melt |  mix | mix | fold | bake
 r1   1 cup sugar              |      |  ↑   |  ↑  |  in  |
 r2   1/4 tsp vanilla          |      |      |     |      |
 r3   1 shot espresso          |      |      |     |      |
 r4   2 large eggs             |      |      |  ↑  |      |
 r5   1/2 cup flour            |      |      |     |      |
 ...
 BB0  (optional full-width steps after the last column)    step kind=banner_bottom
```

| Column step | row_start | row_end |
| --- | --- | --- |
| melt | 0 | 0 |
| mix (1) | 0 | 3 |
| mix (2) | 0 | 4 |
| fold in | 0 | 8 |
| bake 350°F, 30–40 min | 0 | 8 |

> The spans above were verified against the reference image (melt = butter only; first mix = butter..espresso; second mix adds eggs; fold in and bake cover all nine rows).

**Validation rules (per section)**
1. Ingredient positions are contiguous from 0.
2. `row_start ≤ row_end`, both within range.
3. A column step must include at least one row.
4. Order: `banner_top` steps, then `column` steps by `position`, then `banner_bottom` steps.
5. Every row must be covered by at least one column step (warn, don't block).
6. Rows sharing a `split_group_id` must be in the same section.

**Rendering:** per section, CSS Grid (or a real `<table>` with `rowspan`; see M2) with `grid-row: row_start+1 / row_end+2` and `grid-column: (index among column steps only) + 2`. The ingredient column is column 1. Banners do **not** consume a column index.

**Does not fit?** If neither the mapper nor the user can produce a valid sectioned grid, the recipe stays in list view.

## 3. Import Pipeline

> Status: v0.3.0 implemented the static path (fetch, JSON-LD, normalize, paste fallback, review, save). v0.3.1 implements the auto-mapper below (pure TypeScript in `src/lib/import/map-*.ts`, no LLM, no network, no new dependency). v0.3.2 implements the optional headless sidecar: `import_job.method = headless` is now produced, `error_code` gains `headless_unavailable` (migration `0004`), and `ImportJobResponse` carries the `headless` field. The sidecar mechanism (filtering proxy, two-network layout, limits) is described in `docs/deployment.md` and `docs/tasks/v0.3.2-threat-model.md`. Microdata (`itemprop`) extraction was not built in v0.3.1.

```
URL ─► SSRF check ─► fetch (static) ─► JSON-LD Recipe found? ─┐
                         │ no / blocked                       │ yes
                         ▼                                    │
                  headless render ─► JSON-LD found? ──────────┤
                         │ no                                 │
                         ▼                                    ▼
                  paste fallback (text/HTML)        normalize draft
                                                            │
                                      ingredient parser ◄───┤
                                      (qty, unit, name)     │
                                                            ▼
                                       step ↔ ingredient auto-mapper
                                                            │
                                                            ▼
                                  Review screen (editable grid) ─► save
```

**Normalization**
- `recipeIngredient[]` → parsed to qty/unit/name/note; keep `raw_text`.
- `recipeInstructions` (string, `HowToStep`, `HowToSection`) → flat list of steps with `detail`.
- `recipeYield`, `prepTime`, `cookTime` (ISO-8601 durations), `image`, `author`, `keywords`, `recipeCategory` → fields and tags.

**Auto-mapper heuristic**
1. Extract a verb label for each step (first imperative verb from a controlled list: melt, mix, whisk, fold, bake, simmer, …).
2. Match ingredient names (and singular/plural/synonym forms) in step text → set of mentioned ingredients.
3. Reorder ingredients by first mention.
4. Compute each step's span as the contiguous range from row 0 (or first mentioned) through the last ingredient mentioned so far (cumulative "combined mixture" rule); the final step spans all rows.
5. Steps that mention no ingredients and appear before the first ingredient step become `banner_top`; those after the final cooking step with no new ingredients become `banner_bottom`.
5a. `HowToSection` (or headings such as "For the frosting") start a new **section**; each section is mapped independently.
5b. An ingredient mentioned with a partial quantity in two steps ("half the sugar") is split into two rows (`split_group_id`) only when the quantities are resolvable; otherwise keep one row and lower the confidence.
6. Compute a confidence score; low confidence leaves `view_mode = list`.

**`Draft.mapping` (v0.3.1)**

`draft_json` keeps `sections` exactly as the normalizer produced them (page order, one section, null spans, list mode) and adds `mapping: MappingProposal | null` (types in `src/lib/import/map-types.ts`):

```
mapping = {
  version: 1,
  confidence: number,            // 0..1, rounded to 2 decimals
  level: 'high' | 'medium' | 'low',
  sections: RecipeInput['sections'],  // the proposed grid: reordered rows, spans, banners, splits
  warnings: MappingWarning[],
  signals: { cov, unamb, verbs, splitOk, secFactor, groupRefs, columnSteps, distinctSpans }
}
```

- `mapping` is `null` when the mapper did not run or its output was rejected (error, operation budget, too many sections, output failing `validateRecipeGrid` or the recipe schema, proposal over 512 KB or draft over 1 MB). Rows stored before v0.3.1 read back as `null` (`readMapping` re-validates the block, so a tampered block also reads as `null`; it also derives `level` from `confidence`, so the two cannot disagree, and bounds `warnings` (100 strings of at most 300 characters) and `signals` (finite numbers)). `null` behaves as in v0.3.0.
- Thresholds (`CONFIDENCE_THRESHOLDS` in `map-confidence.ts`): `high` >= 0.70, `medium` 0.40 to below 0.70, `low` below 0.40, applied to the rounded score. Score = coverage squared times a weighted sum of unambiguous matches, recognized verbs and resolved splits, times a section factor, minus a group-reference penalty, with caps (fewer than two column steps 0.50, a single distinct (section, row_end) span 0.55, any unresolved split 0.69, more than 30 percent of ingredients unmatched 0.60, no recognized verb at all 0.39).
- Warning codes (a closed set; the UI maps each to a message, never shows free text): `ingredient_unmentioned:<name>`, `ambiguous_name:<token>`, `split_unresolved:<name>`, `group_reference`, `step_without_ingredients`, `sections_from_ingredients_only`, `section_merged`, `ingredient_shared_across_sections`, `too_many_sections`, `input_truncated`, `time_ambiguous`, `mapping_invalid`, `mapping_budget`, `mapping_too_large`, `warnings_more:<n>`. At most 10 of each data-carrying family are kept; the rest are counted in `warnings_more`.
- Matching: a single-word ingredient match on the imperative verb that opens a sentence ("Cream the butter" with a `cream` ingredient) is the action, not a mention. An ingredient seen only in a bottom banner is placed but counts as unmatched, so coverage and the score drop.
- Split groups in a proposal carry temporary ids (`split:<name>:<n>`); the save path rewrites client-supplied group ids to fresh ULIDs.
- Saving: the review screen sends whatever sections the user ended with, through the normal recipe schema. When a proposal was offered it also sends `view_mode`; the API still enforces valid spans for `grid`.
- Caps at mapper entry: 200 ingredients, 100 steps, 4000 characters per step, 120 000 step characters in total, 800 tokens per step, 6 sections, and a deterministic operation budget of 2 000 000.

**Safety**
The instance is internet-exposed (PRD §6), so this is a hard requirement. Block private/loopback/link-local IPs after DNS resolution, limit redirects (≤ 5), response size (≤ 5 MB), timeout (10 s static / 30 s headless), allow only http(s) on ports 80 and 443 (implemented in v0.3.0 for the static path). **Headless sidecar:** its own container on an isolated Docker network with no route to the host, LAN, or app database; intercept every browser request and apply the same IP checks (resolve once, then pin the IP to defeat DNS rebinding); disable downloads, `file://` and extensions; fresh context per job; memory/CPU limits; hard 30 s kill.

## 4. Unit Conversion & Scaling

- Canonical units: weight `g`, volume `mL`; US: `oz`, `lb`, `cup`, `tbsp`, `tsp`, `fl oz`; plus counts ("2 large eggs").
- **Within a dimension** convert exactly (4 oz → 113 g; imported metric value wins if present).
- **Across dimensions** (cup ↔ g) only via `density` table (flour, sugar, butter, …); else keep the original and show no alternate.
- Scaling multiplies both measures by `factor = target_servings / servings`; rounding to friendly fractions for US (¼, ⅓, ½) and to 5 g / 1 mL steps for metric.
- Display uses the user's `unit_pref` as primary and the other in parentheses, as in the reference.

## 5. API Surface (REST, JSON)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/auth/login, /logout, /register (invite) | Auth |
| GET/POST | /api/recipes | List/search (`?q=&tag=&min_rating=`), create |
| GET/PUT/DELETE | /api/recipes/:id | Read, update, delete |
| PUT | /api/recipes/:id/grid | Replace ingredient order + step spans atomically |
| PUT | /api/recipes/:id/visibility | Set `private` or `users` |
| POST/DELETE | /api/recipes/:id/share-link | Create / rotate / revoke the public link token |
| POST | /api/recipes/:id/copy | **Save a copy** of a visible recipe into the caller's book |
| GET | /r/:share_token | Public read-only page |
| POST | /api/import | Start import `{url}` or `{text}` (exactly one; text max 500 KB) → `{ id, status, method, draft, warnings, error_code, duplicate, confidence, mapping_level }` (`confidence` is `draft.mapping.confidence` or `null`; `mapping_level` is `high`, `medium`, `low` or `null`; both are derived from `draft_json`, not stored in their own columns). A failed fetch or no recipe returns 200 with `status: 'failed'` and `error_code`; 4xx is for bad input (400, 401, 403, 415, 422) and 429 with `Retry-After` |
| GET | /api/import/:id | Owner only: restore a review after reload |
| POST | /api/import/:id/save | Persist the edited draft (same schema as recipe create, plus `import_cover`); 201 `{ id }`, 404 if not the caller's job, 409 if already saved |
| GET | /api/photos/:id | Authenticated cover image, gated by the recipe's read permission |
| POST | /api/recipes/:id/photos | Upload photo |
| PUT | /api/recipes/:id/rating | Set own rating |
| POST/GET | /api/recipes/:id/notes | Notes |
| GET | /api/export | Full JSON backup |
| POST | /api/import/backup | Restore backup |

## 6. JSON Backup Format

```json
{
  "version": 1,
  "exported_at": "2026-11-05T10:00:00Z",
  "recipes": [
    {
      "title": "Espresso Brownies",
      "servings": null,
      "ingredients": [{ "position": 0, "name": "unsalted butter", "metric": {"qty": 115, "unit": "g"}, "us": {"qty": 4, "unit": "oz"} }],
      "steps": [{ "position": 0, "kind": "column", "label": "melt", "row_start": 0, "row_end": 0 }],
      "sections": [{ "title": null, "note": "ingredients and steps nested per section in the real format" }],
      "tags": ["dessert"], "notes": [], "ratings": []
    }
  ]
}
```
