# Milestone 04 — Search, Units, Editor & Media (v0.4)

**Objective:** Make the recipe collection usable day to day: search and tags, unit conversion and scaling, a visual grid editor, and photos/notes/ratings.

**Technical Context:**
- Search via SQLite FTS5 (`recipe_fts`); unit rules in [data-model.md](../docs/data-model.md) §4.
- Tables to add: `tag`, `recipe_tag`, `note`, `rating`, `recipe_fts` (`photo` exists since M3).
- **Delivery slices (PM decision; each is releasable):** **4a (v0.4.0)** search, tags, units, scaling (requirements 1–4). **4b (v0.4.1)** grid editor (5). **4c (v0.4.2)** photos, notes, ratings, cook mode (6–9). The grid editor is the riskiest slice, so it ships on its own.
- Components from M2 (`RecipeGrid`, validation) are reused by the editor.

**Requirements:**
1. **Search:** FTS5 index over title, description, ingredient names, tags, shared notes and the user's own notes; triggers keep it in sync; prefix matching; `GET /api/recipes?q=&tag=&min_rating=&author=`; results respect visibility. Search bar in header with debounce.
2. **Tags:** add/remove on recipe form with autocomplete; tag filter chips on `/recipes`; tags created from imports (keywords/category).
3. **Units:** `src/lib/units/` with unit table, within-dimension conversion, small density table (flour, sugar, butter, milk, water, oil, honey, cocoa…), friendly rounding. Populate missing alternate measure at save/import time when determinable; `unit_pref` selects the primary display; per-recipe quick toggle.
4. **Scaling:** servings control (½×, 1×, 2×, custom) on the recipe page; recompute quantities client-side; times and temperatures are unchanged; show ≈ for rounded counts.
5. **Grid editor** `GridEditor` component: reorder ingredients (drag or buttons), edit text inline; add/rename/delete sections; split an ingredient into portion rows; add top/bottom banner steps; for each step column, drag top/bottom handles to set `row_start`/`row_end` (also keyboard operable); add/delete/reorder steps; convert step to banner; live validation warnings (uncovered ingredients); undo/redo; atomic save via `PUT /api/recipes/:id/grid`.
6. **Photos:** upload (jpeg/png/webp, ≤ 10 MB), re-encode and resize (e.g. 1600 px + 400 px thumbnail), cover selection, delete; served from `/data/uploads` with authorization.
7. **Notes:** private and shared notes per recipe; list under the recipe.
8. **Ratings:** one 1–5 star rating per user; average shown on cards and recipe page; filter by min rating.
9. **Cook mode:** optional full-screen larger-text grid, checkboxes on ingredients/steps (local state), Wake Lock where supported.

**Acceptance Criteria:**
- Searching "espresso" finds the sample recipe by ingredient; a private recipe is not found by another user.
- 4 oz butter displays `115 g` when metric is preferred; scaling ×2 shows `8 oz (230 g)` or the equivalent per preference.
- Editor can recreate the sample grid from scratch using only the mouse and also only the keyboard.
- Uploaded oversized or non-image files are rejected.
- Unit-conversion tests cover ≥ 30 cases including fractions and rounding.

**Instructions for LLM:**
* Implement units and scaling as pure, tested functions before touching UI.
* Reuse `validateGrid` from M2 in both editor and API.
* Keep the editor state in a reducer so undo/redo is straightforward.
* All new strings go to `messages/en.json`; avoid user-facing hard-coded units/labels.
