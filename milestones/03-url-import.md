# Milestone 03: Import Recipe from Any URL

**Objective:** Let users paste any URL and have the app fetch, parse, and present an editable recipe draft that can be saved with full attribution.

**Technical Context:**
-   Fetching must happen server-side (Next.js API route) to avoid CORS issues.
-   Parsing strategy (in priority order):
    1.  JSON-LD `Recipe` schema (`<script type="application/ld+json">`).
    2.  Microdata (`itemtype="https://schema.org/Recipe"`).
    3.  HTML heuristics: ingredient lists (`<ul>`/`<li>` near "Ingredients" heading), step lists (near "Instructions"/"Directions" heading).
-   Data model: see `docs/data-model.md`; extraction must map to Step hierarchy where possible.

**Requirements:**
1.  Implement `POST /api/recipes/import` that:
    -   Validates the URL (HTTPS required, no private/loopback IP ranges — SSRF protection).
    -   Checks `robots.txt` before fetching; refuses if the URL path is disallowed.
    -   Fetches with a 10-second timeout, 5 MB size limit, and a browser-like User-Agent.
    -   Runs the extraction pipeline (JSON-LD → microdata → heuristics).
    -   Returns a draft object: title, prepNote, ingredients (name, quantity, unit), steps (action, detail, temperature, nested steps), times, servings, tags, image, sourceUrl, sourceSite, sourceAuthor.
    -   Logs the attempt to `ImportAttempt` (succeeded/failed + error message).
2.  Implement a review screen (`/import/review`) that:
    -   Shows the draft in a form with all fields editable (including a step editor supporting nested steps).
    -   Highlights fields that extraction could not fill.
    -   Shows a duplicate warning if a recipe with the same `sourceUrl` or normalized title exists.
    -   On save: creates the Recipe with `isPublic: true`, stores attribution, and navigates to the recipe page.
3.  Implement a manual-entry fallback (`/import/manual`) for when extraction fails.
4.  Add integration tests with a local test server serving sample HTML pages covering:
    -   A page with JSON-LD.
    -   A page with only HTML heuristics.
    -   A page that is not a recipe (expect graceful failure).
    -   A blocked-by-robots page.

**Instructions for LLM:**
-   Extraction must be defensive: never throw on malformed HTML; return a partial draft with missing fields flagged.
-   Map step grouping when the source provides it (e.g., sub-lists under a step heading); otherwise produce flat steps and let the user group them in the review screen.
-   Quantities: keep the original string (e.g., "1/4 tsp (2.5 mL)") in a `rawQuantity` field during review; store parsed decimal + unit only if confidently parseable.
-   Respect rate limits: max 5 imports per minute per user (simple in-memory or DB counter).
-   Verify with: run the integration tests against the local test server; import a real public recipe URL and confirm the review screen shows a usable draft.
