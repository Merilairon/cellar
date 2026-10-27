# Milestone 04: Search, Filter, Edit, and Delete

**Objective:** Let users find recipes by name, ingredient, or tag; let owners edit and delete their recipes while preserving attribution.

**Technical Context:**
-   Search: PostgreSQL `ILIKE` on title and ingredient names, `tsvector` full-text search (optional optimization, not required for MVP).
-   Authorization: read public recipes by anyone; read/edit/delete only own recipes (or public for read).
-   Data model: see `docs/data-model.md`.

**Requirements:**
1.  Implement `GET /api/recipes?query=&tag=&visible=mine|all` that:
    -   Searches title, ingredient names, and tag names (case-insensitive).
    -   Filters by one or more tags.
    -   Filters by visibility: `all` (public only, or public + own), `mine` (all owned).
    -   Returns a paginated list (page size 20) with title, tags, source, date.
2.  Implement a search UI on the home page: search bar + tag filter + results list.
3.  Implement `PUT /api/recipes/[id]` (owner only) for editing:
    -   Title, prepNote, servings, times, tags, image, isPublic.
    -   Ingredients and steps (including hierarchy) via a structured editor that mirrors the review screen from the import milestone.
    -   Attribution fields (`sourceUrl`, `sourceSite`, `sourceAuthor`) are locked: they cannot be changed, only added if missing.
4.  Implement `DELETE /api/recipes/[id]` (owner only) with soft delete (`deletedAt`).
5.  Add unit/integration tests:
    -   Search by name, ingredient, tag; combined filters.
    -   Edit by non-owner → 403.
    -   Edit preserves attribution.
    -   Delete makes the recipe invisible publicly and returns 404 on its URL.

**Instructions for LLM:**
-   Reuse the step/ingredient editor component from the import review screen; do not duplicate it.
-   All mutating routes must check ownership server-side; never trust the client.
-   Pagination: use `cursor` or `offset` with a stable sort (date desc).
-   Verify with: run the test suite; manually search for the seeded reference recipe by an ingredient (e.g., "cocoa") and confirm it appears with correct tags and attribution.
