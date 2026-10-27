# Milestone 05: Share and Export

**Objective:** Make public recipes shareable via URL and exportable as JSON or Markdown, with attribution always included.

**Technical Context:**
-   Public recipe page already exists from Milestone 02.
-   Export formats: JSON (full data model) and Markdown (human-readable, table included).
-   Data model: see `docs/data-model.md`.

**Requirements:**
1.  Ensure every public recipe has a canonical share URL (`/recipes/[id]`) and that the page works without login.
2.  Add a "Copy share link" button on the recipe page.
3.  Implement `GET /api/recipes/[id]/export?format=json|md` (owner or public):
    -   JSON: the full recipe object including ingredients, steps (with hierarchy), tags, and attribution.
    -   Markdown: a readable document with the recipe title, prep note, a Markdown table matching the strict layout, ingredients, steps, and a source attribution footer.
4.  Add an "Export" dropdown on the recipe page offering JSON and Markdown download.
5.  Add integration tests:
    -   Export JSON round-trips: importing the exported JSON produces an identical recipe.
    -   Markdown export includes the source URL and author.
    -   Export of a private recipe by a non-owner → 403/404.

**Instructions for LLM:**
-   The Markdown table must use the same merged-grouping logic as the web table (consecutive ingredients in the same step grouped under one action heading).
-   Exported files must include `sourceUrl`, `sourceSite`, and `sourceAuthor` when present.
-   Keep the export endpoint lightweight: stream the response, no client-side rendering.
-   Verify with: export a seeded recipe as Markdown, paste it into a Markdown viewer, and confirm the table matches the reference layout; export as JSON and re-import it to confirm round-trip fidelity.
