# User Journeys: Recipe Book

## User Personas

### 1. "Saver" — Anna
-   A home cook who finds recipes on blogs and wants to save them without re-typing.
-   Needs: fast import, a view she can cook from, a way to fix small parsing errors.
-   Expectations: paste a URL → get a clean table in under a minute.

### 2. "Brawler" — Ben
-   Cooks for a family of four; browses the public collection before dinner.
-   Needs: quick search by ingredient (what's in the fridge), scannable layout, servings info.
-   Expectations: search "chocolate" → see 20 recipes in a consistent table format.

### 3. "Editor" — Carla
-   Runs a small cooking community; imports recipes, cleans them up, and shares them.
-   Needs: edit imported recipes, tag them, export for a newsletter, keep attribution.
-   Expectations: edit flow is quick; attribution always visible.

## Journey 1: Register and first import (Anna)

1.  **Touchpoint:** Landing page → "Sign up".
2.  **Step:** Enter email + password → account created, session cookie set.
3.  **Touchpoint:** Dashboard → "Import from URL" button.
4.  **Step:** Paste URL → app fetches page (loading indicator, ~10s max).
5.  **Step:** Extraction runs; result appears in a review screen:
    -   Title, prep note, ingredients with quantities, steps with actions, times, servings, tags.
    -   Any missing fields are highlighted and editable.
6.  **Edge case:** Fetch fails (site down, robots blocked) → show error with "Try manual entry" link.
7.  **Edge case:** Duplicate detected → warning banner "A recipe with this URL/title already exists" with link to existing recipe.
8.  **Step:** User edits fields, clicks "Save" → recipe stored, public by default.
9.  **Touchpoint:** Recipe view renders the strict table layout.

## Journey 2: Browse and cook (Ben)

1.  **Touchpoint:** Search bar → type "chocolate".
2.  **Step:** Results list shows title, tags, source, date; filter by tag narrows results.
3.  **Touchpoint:** Click a result → recipe page.
4.  **Step:** Strict table renders: title header, prep note, ingredient rows, merged action columns, final bake column.
5.  **Edge case:** Recipe has no steps → table still renders; action columns empty.
6.  **Edge case:** Recipe not public and not owned by user → 404 (not found).
7.  **Touchpoint:** "Export" / "Share" buttons → copy share URL or download JSON/Markdown.

## Journey 3: Edit and share (Carla)

1.  **Touchpoint:** Recipe page (owned) → "Edit".
2.  **Step:** Edit form with all fields; attribution (source URL, author) is visible but locked.
3.  **Step:** Save → updated recipe; edit history recorded.
4.  **Touchpoint:** "Delete" → confirmation dialog → recipe removed; share links return 404.
5.  **Step:** Export as Markdown for a newsletter; attribution included.

## Journey 4: Import failure recovery (Anna)

1.  **Touchpoint:** Paste URL → fetch succeeds but extraction is partial (missing steps).
2.  **Step:** Review screen shows the partial draft; missing sections are clearly marked.
3.  **Step:** User manually adds steps/ingredients in the same form.
4.  **Step:** Save → recipe stored with partial + manual data; source URL kept for attribution.

## Edge Cases Summary

| Scenario | Expected behavior |
|---|---|
| URL is not a recipe page | Extraction fails → error message + manual entry option |
| URL fetch times out (>10s) | Timeout error + retry option |
| robots.txt disallows fetch | Refuse fetch with clear message |
| Private/loopback IP in URL | Refuse fetch (SSRF protection) |
| Duplicate import | Warning + link to existing recipe; user can still save a copy |
| Non-owner views a private recipe | 404 (not found, no existence leak) |
| Edit while another user views | Last write wins; no locking in MVP |
| Empty ingredient quantity | Field is optional; renders without quantity |
