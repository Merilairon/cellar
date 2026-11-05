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
`tag(id, name unique)`, `recipe_tag(recipe_id, tag_id)`.

### photo
`id`, `recipe_id`, `file_path`, `width`, `height`, `position`, `is_cover`.

### note
`id`, `recipe_id`, `user_id`, `body`, `shared` (bool: visible to everyone who can see the recipe), `created_at`.

### rating
`recipe_id`, `user_id`, `stars` (1–5); PK `(recipe_id, user_id)`.

### import_job
(created in M3) `id`, `user_id`, `url`, `status` (`queued|fetching|parsed|needs_review|failed|saved`), `method` (`static|headless|paste`), `error_code`, `raw_html_path` (nullable), `draft_json`, `created_at`.

### recipe_fts
FTS5 virtual table over `title`, `description`, ingredient names, tags, notes; kept in sync by triggers.

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

**Safety**
The instance is internet-exposed (PRD §6), so this is a hard requirement. Block private/loopback/link-local IPs after DNS resolution, limit redirects (≤ 5), response size (≤ 5 MB), timeout (10 s static / 30 s headless), allow only http(s). **Headless sidecar:** its own container on an isolated Docker network with no route to the host, LAN, or app database; intercept every browser request and apply the same IP checks (resolve once, then pin the IP to defeat DNS rebinding); disable downloads, `file://` and extensions; fresh context per job; memory/CPU limits; hard 30 s kill.

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
| POST | /api/import | Start import `{url}` or `{text}` → returns draft |
| POST | /api/import/:id/save | Persist reviewed draft |
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
