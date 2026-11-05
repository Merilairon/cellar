# Milestone 02 — Recipe View (v0.2)

**Objective:** Create, view, and delete recipes manually, with the signature **grid view** (matching the reference table) and a list-view fallback.

**Technical Context:**
- Tables `recipe`, `section`, `ingredient`, `step`: see [data-model.md](../docs/data-model.md) §1–2. **Prerequisite spikes:** wireframes for grid (desktop and 375 px) and confirmation of the brownie spans against the original image.
- Grid rules: [PRD.md](../docs/PRD.md) §4. Rendering with CSS Grid; semantics must be accessible (`role="table"`, `rowheader`, `cell` with `aria-rowspan`, or a real `<table>` with `rowspan` — choose a real `<table>` if feasible, since spans are contiguous per column).
- Reference example: Espresso Brownies is a layout study only (third-party source; see PRD §9). Seed data and the visual-regression fixture use a self-written sample recipe with the same structure (two top banners, 9 rows, columns 1/4/5/9/9 rows).

**Requirements:**
1. Migration for `recipe`, `section`, `ingredient`, `step` (including `split_group_id`, `portion_label`, step kinds `banner_top|column|banner_bottom`, `copied_from_id`, `visibility` private|users); zod schemas shared by client and server.
2. `POST/GET/PUT/DELETE /api/recipes` per data-model §5, owner-or-admin authorization; visibility defaults to `private`.
3. Ingredient line parser in `src/lib/import/ingredient-parser.ts`: free text → `{qty, unit, name, note}`; handles fractions (`1/2`, `½`), ranges, dual units (`1 cup (200 g)`), counts (`2 large eggs`), and unparseable lines (kept as `raw_text`).
4. `RecipeGrid` component: renders one grid per section, with top and bottom banner rows, sticky ingredient column, one column per `column` step with `row_start..row_end` spans; shows label + temp/time (`bake 350°F (170°C) 30 to 40 min`); tap/click expands `detail`.
5. `RecipeList` component: ingredients + numbered steps.
6. Recipe page `/recipes/:id`: title, meta (servings, times, source), view toggle grid/list (remember per user in localStorage), ingredients shown with primary unit and the other in parentheses.
7. Default `view_mode`: `grid` if all column steps have valid spans, else `list`. List view shows **Convert to grid** that opens a minimal editor (assign start/end rows per step via number inputs; the full drag editor comes in M4).
8. `/recipes` index: card list with title, tags placeholder, last updated; empty state with calls to action.
9. `/recipes/new` and `/recipes/:id/edit`: form for fields, ingredient textarea (one per line, live parsed preview), steps editor (label, detail, kind banner/column, span inputs). Validation errors inline.
10. Seed script that inserts the self-written sample recipe plus a two-section sample (cake + frosting, with a split ingredient and a bottom banner). Add a `NOTICE` entry only if third-party assets are bundled (fonts, icons, images); the sample recipe is self-written.
11. Responsive (decision, to be validated by the prototype): below 640 px the grid keeps a sticky ingredient column and fixed-width step columns (~72 px) in a horizontally scrollable container; tapping a step opens a bottom sheet with its full text; the grid/list choice is remembered per device and defaults to grid. A recipe with more than 8 column steps in one section defaults to list on phones.
12. `POST /api/recipes/:id/copy` (**Save a copy**) and `PUT /api/recipes/:id/visibility`; shared recipes are read-only for non-owners.
13. Complete the user-deletion flow from M1 (reassign or delete recipes).

**Acceptance Criteria:**
- The single-section sample renders with the reference structure (two banner rows; 9 ingredient rows; columns spanning rows 0–0, 0–3, 0–4, 0–8, 0–8); the two-section sample renders two grids with a split ingredient and a bottom banner.
- Mixed-device decision: phone and tablet/laptop get equal weight. Playwright visual tests run at 375, 768 and 1280 px for both sample recipes; the pre-M2 prototype covers all three widths.
- Keyboard navigation reaches every cell; screen reader announces row/column headers.
- Parser unit tests cover ≥ 25 ingredient-line cases.
- A recipe with invalid spans cannot be saved as grid (server returns 422 with field errors).

**Instructions for LLM:**
* Build the data layer and parser first with tests, then API, then components, then pages.
* Keep `RecipeGrid` presentational (props in, markup out); put span validation in `src/lib/grid/validate.ts` with unit tests.
* Do not implement unit conversion, import, search, or sharing here.
* Use a snapshot or visual test of the brownie fixture to protect the grid layout.
