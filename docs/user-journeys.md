# Cellar — User Journeys

## Personas

| Persona | Description | Goals |
| --- | --- | --- |
| **Jan (admin/owner)** | Runs the server, collects many recipes | Easy import, backup, invite family |
| **Marie (home cook, phone)** | Cooks daily, mostly from her phone in the kitchen | Glanceable recipe, scaling, no fuss |
| **Tom (occasional cook, tablet)** | Cooks for friends occasionally | Clear steps, unit he knows, share with friends |
| **Guest (friend with link)** | No account | Read one recipe via public link |

## Journey 1 — Import a recipe from a URL (Jan)

| Step | User action | System response | Touchpoint |
| --- | --- | --- | --- |
| 1 | Clicks **Import** and pastes a URL | Validates URL, shows progress ("Fetching…") | Import dialog |
| 2 | Waits | Fetches page, finds JSON-LD, parses ingredients/steps, auto-maps grid | Progress indicator |
| 3 | Sees **review screen** | Editable draft: title, servings, ingredients, grid preview with confidence badge. *Built in v0.3.1 (03b).* | Review grid |
| 4 | Fixes a span (drags a step's end handle), renames a step label | Live preview updates. *Dragging a handle is a v0.4.1 (04b) feature, in the grid editor (**Edit grid layout** on the saved recipe; a low-confidence import is saved as a list first, then **Convert to grid**, then fine-tune). In v0.3.1 you fix a span by typing the first and last ingredient row in the step; the preview updates as you type.* | Grid editor |
| 5 | Adds tags, picks visibility | | Form |
| 6 | Clicks **Save** | Recipe saved, opens grid view | Recipe page |

**Edge cases**
- *No JSON-LD:* retry with headless browser automatically; show "Rendering page…".
- *Still nothing / blocked / paywall:* show reason and **Paste recipe text** option.
- *URL is not a recipe:* explain and offer manual create.
- *Invalid/private-network URL:* reject with clear message (SSRF guard).
- *Duplicate (same source URL exists):* warn and link to existing recipe.
- *Ingredient line unparseable ("salt, to taste"):* keep as raw text with no quantity.
- *Low mapping confidence:* save in list view, banner suggests "Convert to grid". *In v0.3.1 the review screen opens in list view with a "Could not map reliably" badge and a secondary "Try the grid anyway" action; the recipe page's existing **Convert to grid** is the later route. A banner that suggests it is 04b.*
- *Timeout:* offer retry and paste fallback.

## Journey 2 — Cook from the grid view (Marie, phone)

| Step | User action | System response |
| --- | --- | --- |
| 1 | Opens app, searches "brownie" | Instant results with cover photos |
| 2 | Opens the recipe | Grid view: banner steps, ingredient column (sticky), step columns |
| 3 | Taps **×2** | Quantities double in both units; times unchanged |
| 4 | Taps a step cell ("fold in") | Expands full instruction text |
| 5 | Switches unit to US | Primary unit swaps (saved to her profile) |
| 6 | Optionally taps ingredient/step to check off | Visual strike-through (local state) |

**Edge cases**
- Narrow screen: horizontal scroll with sticky ingredient column; toggle to list view.
- *As built in v0.4.0:* search results are a list of recipe cards with tags and no cover photos (photos are shown from v0.4.2). **×2** is one of 1/2x, 1x, 2x and Custom; amounts show the preferred unit first with the other in parentheses when known. The unit switch on the recipe page applies to that recipe only and resets on reload; the saved preference is set on the profile page. Scaling does not touch times or temperatures.
- Scaling yields odd values (e.g., 1.5 eggs): show rounded value with ≈ and tooltip.
- Ingredient has only one unit system: show only that one.
- Screen sleeping: use Wake Lock API where available (cook mode).

## Journey 3 — Create or edit a recipe manually (Tom)

1. **New recipe** → enters title, servings, times.
2. Adds ingredients line by line (free text parsed into qty/unit/name, with live preview of parsed fields).
3. Adds steps (label + detail; mark prep steps as banners).
4. Opens **Grid editor**: drags span handles per step; warnings for uncovered ingredients.
5. Uploads a photo, adds tags.
6. Saves; recipe appears in list.

**Edge cases:** a recipe with several parts uses **sections** (Cake / Frosting); an ingredient used twice is split into two rows; steps after baking go in a bottom banner; ingredient reorder updates existing spans; deleting an ingredient inside a span shrinks it; deleting a whole span range removes step or asks to confirm; unsaved changes prompt on navigation.

## Journey 4 — Share a recipe (Tom → friend)

1. Opens recipe → **Share**.
2. Selects visibility: Private or All users (read-only), and optionally turns on a public link.
3. Copies link (`/r/<token>`); can **rotate/revoke** it.
4. Guest opens link, sees read-only grid view without notes or ratings from others, no edit controls.

**Edge cases:** revoked link shows "not available"; turning the link off invalidates the token; guests can print; making an imported, unedited recipe public shows a copyright/attribution warning; a signed-in user viewing a shared recipe sees **Save a copy**, which creates their own editable recipe with `copied_from` and the source attribution kept.

## Journey 5 — Search and organize (Marie)

1. Types a query; results match title, ingredient, tag, notes.
2. Filters by tag ("dessert") and rating ≥ 4.
3. Adds a private note ("less sugar next time") and a 5-star rating.

**Edge cases:** no results → suggest clearing filters or importing; typos → prefix match.

*As built in v0.4.0 (slice 4a):* step 1 searches title, ingredient names and notes on ingredients, and tags (recipe notes arrive in v0.4.2). Step 2 is tag filtering only; there is no rating filter until v0.4.2 (`min_rating` is rejected). Step 3 is not available yet. There is no typo tolerance: only prefix matching, and no stemming.

## Journey 6 — Print and back up (Jan)

1. **Print**: grid view on one page; print CSS hides navigation; row/column borders preserved.
2. **Backup**: Settings → Export JSON → downloads all recipes (admin: all users; member: own).
3. **Restore**: Settings → Import backup → preview counts → confirm; duplicates skipped or renamed.

**Edge cases:** incompatible backup version → error with upgrade hint; photos included as zip or referenced by path (decide in M5).

## Journey 7 — Onboarding (Jan and family)

1. First launch: create admin account.
2. Admin creates invite link; relative opens it, sets name and password.
3. New user lands on an empty state with **Import** and **New recipe** actions and a sample recipe.

**Edge cases:** expired invite; forgot password (admin issues a reset link; no email in MVP); last admin cannot be deleted; deleting a user asks the admin to reassign or delete that user's recipes.
