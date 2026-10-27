# Milestone 02: Strict Table Recipe View

**Objective:** Render every recipe in the exact strict table layout of the reference — title header, prep note, ingredient rows, merged action columns per step level, and a final bake column — so the layout is identical for all recipes.

**Technical Context:**
-   Rendering rules: see `docs/data-model.md` → "Rendering Rules (strict table)".
-   Data available: Recipe, Ingredient (with `stepId`), Step (with `parentStepId`, `sortOrder`).
-   Frontend: Next.js React components; table rendered server-side (SSR) for the public recipe page.

**Requirements:**
1.  Create a `RecipeTable` component that:
    -   Renders the title as a full-width header row.
    -   Renders the `prepNote` as a full-width sub-header row (omitted if empty).
    -   Renders one row per ingredient (quantity + name) in `sortOrder`.
    -   Renders one action column per step level: consecutive ingredients in the same step get a merged cell labeled with the step's `action`.
    -   Renders the last root step as the final column, merged across all rows, combining `action` + `temperature` + `detail` (e.g., "bake 350°F (170°C) 30 to 40 min").
    -   Handles recipes with no steps: table renders with empty action columns.
2.  Create a recipe detail page (`/recipes/[id]`) that:
    -   Shows the `RecipeTable`.
    -   Shows meta info: servings, times, tags, source attribution (URL, site, author), owner name.
    -   Returns 404 for missing, deleted, or private recipes not owned by the current user.
3.  Create a recipe list page (`/`) showing public recipes (title, tags, source) with links to detail pages.
4.  Add unit tests for the table rendering logic covering:
    -   Flat steps (single level).
    -   Hierarchical steps (nested action columns).
    -   Missing steps.
    -   Empty quantities.

**Instructions for LLM:**
-   The merged-cell algorithm must be deterministic: group consecutive ingredients by their step, preserving `sortOrder`.
-   Do not modify the data model in this milestone; render from existing relations.
-   Style the table with clear column borders matching the reference (green border style is optional, but column separation must be visible).
-   Verify with: render the seeded reference recipe and visually compare to the reference image; run the unit tests.
