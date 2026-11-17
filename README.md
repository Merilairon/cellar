# Cellar

A self-hosted recipe book for you and the people you invite. Next.js 16, SQLite, one container.

This is v0.4.2 (implemented, pending the release gate). It builds on v0.2 (manual recipes with a grid view and a list view), v0.3.0 (importing a recipe from a web address or pasted text), v0.3.1 (an automatic step-to-ingredient grid mapper for imports) and v0.3.2 (an optional headless browser for JavaScript-only pages), v0.4.0 (search, tags, unit conversion and scaling), v0.4.1 (a visual grid editor), and adds photos, notes, ratings and a cook mode. Earlier versions added accounts, invites, password recovery, security hardening and Docker packaging. It runs as a single process with a single SQLite file.

The branch `release/v0.5.0` (slice A of v1.0, not tagged yet) adds sharing by public link and printing; see [Sharing and public links](#sharing-and-public-links) and [Printing](#printing). The branch `release/v0.5.1` (slice B, not tagged yet) adds JSON export and restore; see [Backup and restore](#backup-and-restore).

## Features

- **Create, edit and delete recipes by hand.** Ingredients are typed as free-text lines and parsed into quantity, unit, name and note (fractions, ranges, dual units; lines that cannot be parsed are kept as written).
- **Grid view.** Recipes with sections, a split ingredient, and top and bottom banner steps render as a table in which each step column spans the ingredient rows it applies to. Spans are validated: a recipe with invalid spans cannot be saved as a grid (the API returns 422 with field errors).
- **List view.** Every recipe can be shown as a plain list. A recipe whose spans are missing or invalid is a list recipe; **Convert to grid** on the recipe page lets you add spans and switch it.
- **View preference.** Your choice of grid or list is remembered per user in the browser. With no saved choice, a recipe defaults to grid, except on a phone when a section has more than 8 step columns (then list).
- **Phone, tablet and desktop layouts.** Tested at 375, 768 and 1280 px. On a phone the ingredient column stays fixed, a scroll cue shows that the grid scrolls sideways, and tapping a step opens it in a bottom sheet.
- **Sharing and copies.** The owner (or an admin) can share a recipe read-only with all signed-in users, and, since v0.5.0, also with anyone who has a public link. Another user can save an independent private copy.
- **User deletion.** When an admin deletes a user, they choose to delete that user's recipes or reassign them to another active user.
- **Recipe import (v0.3.0) with automatic grid mapping (v0.3.1).** Import a recipe from a web address or from pasted text, review and edit it, then save it. Cellar proposes which ingredients each step uses and shows a grid preview. See [Import a recipe](#import-a-recipe).
- **Search (v0.4.0).** A search box in the header finds recipes you can read by title, description, ingredient names and notes on ingredients, and tags. See [Search and tags](#search-and-tags).
- **Tags (v0.4.0).** Add tags on the recipe form (with suggestions from tags already in use), see them on recipe cards and pages, and filter `/recipes` by tag. Tags found on an imported page appear as editable chips on the review screen and are saved with the recipe.
- **Units and scaling (v0.4.0).** Choose metric or US as your preferred unit on your profile. A recipe page shows your preferred unit first, with the other in parentheses when it is known, and offers 1/2x, 1x, 2x and a custom scale plus a per-recipe unit switch. See [Units and scaling](#units-and-scaling).
- **Visual grid editor (v0.4.1).** On a grid recipe you own (or as an admin), **Edit grid layout** opens an editor on the recipe page. You can edit ingredient text in place, move, add, delete and split ingredient rows into portions, add, rename and delete sections, add, delete and reorder steps, convert a step to a top or bottom banner, and set which rows a step covers. Changes show live warnings (for example a row no step covers), support undo and redo, and are saved in one step with **Save**. See [Grid editor](#grid-editor).
- **Sample recipes.** `npm run seed` adds two self-written samples (see [Sample data](#sample-data)).

- **Photos (v0.4.2).** On a saved recipe you own (or as an admin) you can upload up to 10 photos (JPEG, PNG or WebP, up to 10 MiB and 16 megapixels each), choose the cover and delete photos. Uploads are re-encoded to WebP (long edge at most 1600 px, plus a 400 px thumbnail) and metadata such as GPS is removed. The cover shows on recipe cards and the recipe page. Photos are served only to people who can read the recipe. You cannot upload from the new-recipe form; save first, then add photos on the recipe page.
- **Notes (v0.4.2).** Any signed-in reader of a recipe can add plain-text notes (up to 4000 characters). A note is private to you by default; mark it shared to show it to everyone who can read the recipe. Search finds shared notes and your own private notes, never anyone else's private notes.
- **Ratings (v0.4.2).** Rate any recipe you can read from 1 to 5 stars. Recipe cards show the average, and `/recipes` can filter by minimum average rating (`?min_rating=`).
- **Public links (v0.5.0).** **Share** on a recipe page opens a dialog to choose Private or All users and to turn a public link (`/r/<token>`) on, copy it, replace it or turn it off. Anyone with the link reads the recipe without an account. See [Sharing and public links](#sharing-and-public-links).
- **Print (v0.5.0).** A **Print** button on the recipe page and the public page prints the grid on one landscape page. See [Printing](#printing).
- **Cook mode (v0.4.2).** **Cook** opens a full-screen view of the recipe with large check-off items for ingredients and steps, at the scale and unit you had chosen. Checks are not saved. It asks the browser to keep the screen on (HTTPS or localhost only) and says so when it cannot.

- **Backup and restore (v0.5.1).** The **Backup** page downloads your recipes as a JSON file or a zip with photos, and restores such a file into any Cellar instance after a preview. See [Backup and restore](#backup-and-restore).

Not yet available: sorting by rating.

## Routes

| Route               | What it shows                                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/recipes`          | Your recipes and recipes shared with you, newest first. Accepts `?q=`, `?tag=` and `?author=` (see [Search and tags](#search-and-tags)). Shows an empty state with calls to action when there are none.                                                                                     |
| `/profile`          | Your preferred unit system (metric or US).                                                                                                                                                                                                                                                  |
| `/recipes/new`      | Form to create a recipe.                                                                                                                                                                                                                                                                    |
| `/recipes/:id`      | A recipe in grid or list view, with a toggle. The owner and admins see edit, **Edit grid layout**, delete and share controls; other users see a read-only view with **Save a copy**.                                                                                                        |
| `/import`           | Import a recipe from a web address or pasted text (see [Import a recipe](#import-a-recipe)).                                                                                                                                                                                                |
| `/import/:id`       | Review screen for an import: edit the draft, then save or discard.                                                                                                                                                                                                                          |
| `/recipes/:id/edit` | Form to edit a recipe you own (admins can edit any recipe). Saving replaces the recipe's sections, ingredients and steps.                                                                                                                                                                   |
| `/r/:token`         | The public, read-only page of a recipe shared by link. No sign-in. Shows the recipe without photos, notes, ratings or owner; every invalid, revoked or unknown link shows the same "This link is invalid or has expired." page (see [Sharing and public links](#sharing-and-public-links)). |
| `/backup`           | Download a backup of your recipes (JSON, or a zip with photos) and restore one: choose a file, check it, read the preview, then restore. Admins can also download every user's recipes (see [Backup and restore](#backup-and-restore)). Linked as **Backup** in the header.                 |

The JSON API lives under `/api/recipes` (`/api/recipes`, `/api/recipes/:id`, `/api/recipes/:id/copy`, `/api/recipes/:id/visibility`, `/api/recipes/:id/share-link`, `/api/recipes/:id/grid`), `/api/tags`, `/api/export` and `/api/import/backup`. See [docs/data-model.md](docs/data-model.md).

## Sharing and public links

**What you can do.** On a recipe you own (an admin can do this for any recipe), **Share** opens a dialog with two independent settings:

- **Who can see this:** Private (only you) or All users (every signed-in user reads it and can save a copy). A label next to **Share** shows the current state (for example "All users · Public link").
- **Public link:** a switch. Turning it on creates a link of the form `https://<your host>/r/<22 characters>`. **Copy link** copies it, **New link** replaces it (the old one stops working at once, after a confirmation), and turning the switch off makes the link stop working (after a confirmation). A recipe can be shared with all users and by link at the same time.

Turning a link on or off, or replacing it, does not change the recipe's "last edited" time. Changing between Private and All users no longer changes it either (it did before v0.5.0).

**What a visitor sees.** The public page shows the title, description, servings and times, tags, the source (a banner that names it and links to the original page), the grid or list with the scale and unit controls, and a **Print** button. It shows no photos, notes, ratings, owner name, dates, navigation or edit controls, and it has no sign-in prompt. Anyone who holds the link can read that recipe until you turn the link off or replace it; there is no expiry.

**Invalid links.** A mistyped, replaced or turned-off link, a deleted recipe, and any link while public links are disabled all show the same page ("This link is invalid or has expired.") with the same status and headers, so a visitor cannot tell them apart or find out which recipes exist. The page is never cached and sends `Referrer-Policy: no-referrer` (the link does not leave in a `Referer` header), `<meta name="robots" content="noindex, nofollow">`, and `/robots.txt` asks all crawlers to stay out. Keep in mind that the link is a secret in the address bar: it is also in browser history and in your reverse proxy's access log.

**Copyright notice.** When a recipe was imported from a web page and has not been edited since, the Share dialog shows a notice that the recipe text may be protected by copyright and that you are responsible for publishing it. It is shown for the whole dialog (both the All users and the public link setting), and it only warns: it never blocks sharing. Editing the recipe removes it. Whether it should apply to the public link only is an open owner question, see [docs/tasks/v0.5.0-carryover.md](docs/tasks/v0.5.0-carryover.md).

**Turn public links off for the whole instance.** Set `PUBLIC_LINKS_ENABLED=false` (default `true`) and restart. Every `/r/<token>` answers the invalid-link page, the Share dialog hides the switch and says an admin turned links off, and `POST` and `DELETE /api/recipes/:id/share-link` answer 403 `public_links_disabled`. Stored links are kept but inert; set the variable back to `true` and the same links work again.

**Rate limit and the reverse proxy.** `/r/*` is limited per client IP to `RATE_LIMIT_PUBLIC_MAX` requests per `RATE_LIMIT_PUBLIC_WINDOW_SEC` (120 per 60 seconds by default), and answers 429 with `Retry-After` beyond that. For the limit to apply:

- your reverse proxy must forward the client address in `X-Forwarded-For`, and
- `TRUSTED_PROXIES` must list the proxy (with the Caddy profile: `172.28.0.10`).

When the app cannot tell who the client is (no `TRUSTED_PROXIES`, the default for direct mode and `npm run dev`), the public limit is skipped, the same rule as for the other per-IP limits. The limit protects CPU; it is not what keeps links secret (a link holds 128 random bits). The limiter believes `X-Forwarded-For`, so the app port must not be published when public links are on (see [docs/deployment.md](docs/deployment.md)). The reverse proxy must not cache `/r/*`.

**API.** `POST /api/recipes/:id/share-link` creates or replaces the link and answers 201 `{ "share": { "enabled": true, "token": "...", "url": "..." } }`; `DELETE` removes it (204, also when there was none). Both need the owner or an admin, answer 403 for a reader and 404 for a recipe you cannot read, and are `Cache-Control: private, no-store`. `GET /api/recipes/:id` adds `share` (only for callers who can edit the recipe, otherwise `null`) and `public_links_enabled`. Details: [docs/data-model.md](docs/data-model.md) section 5.

**Not tested.** The public page and the dialog were checked with Chromium, axe and scripted keyboard tests only. Real phones, screen readers, Firefox, Safari and a real reverse proxy in front of a public link were not tested; see [docs/tasks/v0.5.0-carryover.md](docs/tasks/v0.5.0-carryover.md).

## Printing

**Print** (recipe page and public page) opens the browser's print dialog. The print stylesheet hides the header, buttons, photos, rating and notes controls, forces a light theme, and prints the grid (or list) you are looking at, at the scale and unit you have chosen. Recipe pages also offer **Include notes when printing** in the Notes header (off by default; it prints the notes you can see; the public page has no notes). The source address is printed after the source link.

- **Landscape.** The page asks for landscape with 10 mm margins. Chromium preselects it; Firefox and Safari ignore that request, which is why the button says "Landscape fits the grid on one page."
- **One page.** Both sample recipes (see [Sample data](#sample-data)) print on exactly one A4 and one Letter landscape page, from the recipe page and from the public page. That was measured only by saving a PDF in Chromium (the e2e spec `tests/e2e/print.spec.ts`).
- **Font steps.** The table font depends on the largest number of step columns in any section: 1 to 6 columns 10 pt, 7 to 10 columns 9 pt, 11 or more columns 7 pt (the page itself is not scaled). For the two-section sample on the public page (the tallest case) 10.5 pt still fit on A4 and 11 pt needed two pages; 10 pt was chosen to leave room for longer recipes. The samples have at most 5 step columns, so the 9 pt and 7 pt steps were only checked with synthetic recipes (the stylesheet comment records no width overflow from 5 to 16 columns); no automated test covers them.
- **When it does not fit.** A grid with more rows than a landscape page holds, or several long sections, prints on as few pages as possible: rows are never split and the font never goes below 7 pt (a test prints a 60-row recipe and expects more than one page).
- **Not tested.** Real printers, Firefox, Safari and phones' print sheets. Known cosmetic issues are listed in [docs/tasks/v0.5.0-carryover.md](docs/tasks/v0.5.0-carryover.md).

## Backup and restore

**Backup** in the header opens `/backup` (new in v0.5.1). It has two parts: export and restore.

### Export

- **JSON file.** **Download backup** gives you `cellar-backup-<date>.json` with your recipes: ingredients, steps and the grid spans, tags, your notes, other people's shared notes (author name only), your ratings and which photos each recipe has. The JSON file lists the photos but does not contain them.
- **Zip with photos.** Tick **Include photos** to get `cellar-backup-<date>.zip` instead: `backup.json` first, then every photo and thumbnail as `photos/<id>.webp`. The zip is streamed, so a large library does not fill the server's memory. A photo file that is missing on disk is left out and counted in the file (`photos_missing`).
- **Your recipes only.** A member exports the recipes they own. Recipes that other people shared with you are not included.
- **Admins: all users.** An admin also sees **Include all users' recipes**. That file (`scope: "all"`) is the **whole-instance backup**: every user's recipes including private ones, every note including private notes, every rating and a list of accounts (email, name, role). That is by design, so an admin can rebuild an instance. Keep the file as safe as the database. It never contains password hashes, sessions, invites or public-link tokens.
- **Limits.** One export at a time per user, and `RATE_LIMIT_EXPORT_MAX` exports per `RATE_LIMIT_EXPORT_WINDOW_SEC` (default 10 per hour) per user. A zip over 4 GiB or 65 535 files is refused (`413`); download without photos instead.
- **Not in any backup:** public-link tokens, sessions, passwords, invites, password resets, import jobs and kept raw HTML, and (in your own export) other people's private notes and individual ratings. The full list is in [docs/data-model.md](docs/data-model.md) section 6.

### Restore

1. **Choose a file** (`.json` or `.zip`) and select **Check the file**. The file is uploaded to the server, where it is stored under `RESTORE_DIR` and checked completely; nothing is written to your recipes yet. A file that is not a Cellar backup, a damaged or hostile zip, or a backup made by a newer Cellar ("This backup was made by a newer Cellar. Upgrade this instance first.") is refused with a message and nothing is kept.
2. **Read the preview.** It shows how many recipes, sections, notes, ratings and photos the file would restore, which recipes already exist (same title, ignoring case and surrounding spaces) and, for an admin, owners who have no account here.
3. **Choose what happens to recipes that already exist:** **Skip them and keep mine** (default), or **Restore them as copies named "Title (restored)"**.
4. **Restore.** The result lists what was restored, skipped, copied and left out. **Cancel** discards the checked file. A checked file that is not used expires after one hour.

What to expect:

- **Recipes come back as new recipes**, owned by you, with fresh ids, in the same grid layout (spans included), with the same visibility. Their created and last-edited times are the time of the restore. Public links are not restored: a restored recipe is not publicly shared.
- **Notes and ratings (member).** Your own notes and your rating come back. Other people's shared notes in the file are left out and counted, because a note needs an author account on this instance.
- **Admin restore of an all-users file.** Owners, note authors and raters are matched by email to accounts that exist here. A recipe whose owner has no account here is restored as **yours**; the preview lists those emails but not which recipes, and notes and ratings by unknown people are left out. Nobody is created, and roles from the file are ignored. Check the owners list before you restore.
- **Photos** come back only from a zip. Each one is decoded and re-encoded like an upload, so a file that is not a real image is skipped and counted. A JSON file restores recipes without photos. At most 2000 photos are restored per run.
- **If something goes wrong halfway,** each recipe is restored on its own. The run stops at the first recipe that cannot be stored: the ones before it stay, the result says "Restore stopped" and at which recipe, and the ones after it are not attempted. Restore the same file again with **Skip** to finish; the recipes that are already there are skipped.
- **Size.** Uploads are limited to `RESTORE_BODY_MAX` (256 MiB by default); a JSON file is limited to 16 MiB. A reverse proxy in front of Cellar must allow at least that much on `POST /api/import/backup` ([docs/deployment.md](docs/deployment.md)). Restoring a large zip needs free disk space for the staged file plus the re-encoded photos.
- **One at a time.** Only one restore is applied at a time on the instance (a second one gets "restore in progress" and can be retried), and each user keeps at most one checked file.

**The volume copy stays the primary full backup.** The export is a portable copy of recipes, not of the instance: it does not include accounts' passwords, public links, sessions or import history, and a restore adds recipes without removing anything. To recover a whole instance, restore the `/data` volume ([Backup](#backup) under Docker). Use the JSON or zip backup to move recipes between instances, to keep a copy outside the volume, and to hand a member their own recipes.

## Search and tags

**Search.** Type in the header search box. Typing updates the address (`/recipes?q=...`) after a 250 ms pause, Enter searches at once, and Escape clears the box, so back, forward and reload keep your search. A query needs at least 2 characters before a request is made.

- **What is searched.** Title, description, ingredient names and ingredient notes (for example "melted"), and tags. The original ingredient line, section titles and step text are not searched. Recipe notes are searched since v0.4.2: shared notes on recipes you can read, and your own private notes. A recipe found only through a note is listed after recipes that match in their own text.
- **Prefix matching.** Every word matches as a prefix (`espr` finds espresso) and all words must match. Letter case and accents are ignored (`creme` finds "Crème"). There is no stemming, so `brownies` does not find "brownie". A word shorter than 2 characters is ignored; a query with no usable word returns no recipes rather than all of them.
- **Order and size.** With a query, the best matches come first (title, then tags, ingredients, description), ties newest first, at most 100 results. Without a query the list is unchanged: newest first, no cap.
- **Who you find.** Only recipes you can already see in the list: your own and recipes shared with all signed-in users. Admins get no extra reach into other users' private recipes.

**Tags.** A tag is a short lowercase label (1 to 40 characters, at most 20 per recipe). "Dessert" and "dessert" are the same tag, and capitalization is not kept. Invisible and direction-control characters are rejected. Tag chips on `/recipes` filter the list (select the active chip again to remove the filter); the counts only include recipes you can read.

**API.**

| Request                                             | Result                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/recipes`                                  | The list, as before.                                                                                                                                                                                                                                |
| `GET /api/recipes?q=espresso&tag=dessert&author=me` | Filters combine with AND. `q` is at most 100 characters; at most the first 8 words of 2 or more characters are used. `tag` is 1 to 40 characters. `author` is a user id or `me`; a well-formed id of a user who does not exist gives an empty list. |
| `GET /api/tags?q=des`                               | `{ "tags": [...] }`: tags on recipes you can read, with counts. `q` is an optional prefix of at most 40 characters.                                                                                                                                 |

Unknown or repeated query parameters are rejected with 400 `invalid_query`. `min_rating` (1 to 5, integer) keeps recipes whose average rating is at least that value; unrated recipes are excluded. Search responses carry `Cache-Control: private, no-store`.

## Units and scaling

- **Preferred unit.** Set it on your profile (`/profile`). It decides which measure is shown first on recipe pages. The other measure follows in parentheses when the recipe has it. It does not change what is stored.
- **Quick switch.** On a recipe page, **Show in US units** / **Show in metric** flips the display for that recipe only. It is not remembered: the page returns to your preference on reload.
- **Scaling.** 1/2x, 1x and 2x, or **Custom**. If the recipe states a number of servings, Custom takes a target number of servings; otherwise it takes a multiplier. Any factor must be above 0 and at most 100 times (and at least 1/100). Only ingredient quantities change: times, temperatures and step text stay as written. Scaling is not saved.
- **Rounding.** Quantities are rounded to friendly amounts: grams and millilitres to 1 below 10, to 5 up to 1000 and to 10 above; US teaspoons and tablespoons to eighths below 1 and quarters above (thirds are also offered); cups to quarters and thirds; ounces to quarters below 1 and halves above; pounds to quarters. A positive amount never rounds to zero. When rounding moves a value by more than 2 percent, or a count becomes fractional (1.5 times 3 eggs), the amount is shown with a "about" sign, which screen readers announce as "about". An unscaled stored amount is shown as stored.
- **Missing measures.** When you save or import a recipe that has only one measure for an ingredient (for example only `1 cup flour`), Cellar fills in the other measure if it can work it out: exactly within a kind (ounces to grams, tablespoons to millilitres) and, for a short list of ingredients (flour, sugar, brown sugar, powdered sugar, butter, cocoa, honey, milk, water, oil), between volume and weight using a typical density. The derived measure is stored like any other value and is not marked as derived. A measure you typed or imported is never overwritten. Recipes saved before v0.4.0 are not changed until you save them again.

Limits: density values are common kitchen figures, not measurements of your ingredients (a packed cup of flour differs from a sifted one). Ingredients not on the list get no cross conversion, and names such as "coconut milk", "peanut butter" or "flour tortillas" are deliberately not matched.

## Grid editor

**Open it.** On a recipe whose view is a grid, the owner (and an admin) sees **Edit grid layout** next to **Edit**. **Edit** still opens the recipe form (title, times, tags, visibility). A recipe stored as a list uses **Convert to grid** first; after converting, a link offers to fine-tune it in the editor.

**What you can do.**

- **Rows.** Click an ingredient to edit its text (the same free-text parser as the recipe form, with a "Parsed as" preview). Move rows up or down, add or delete them, or split one into portion rows ("half", "remaining"). Steps keep covering the same ingredients when a row moves.
- **Steps.** On a tablet or desktop, drag the green bars on the top and bottom edge of a step to change the rows it covers, or use **Adjust rows**. On a phone, tap a step to open a bottom sheet with Start row and End row steppers. Steps can also be added, deleted, moved between columns, or converted to a top or bottom banner.
- **Sections.** Add, rename and delete sections (for example Cake and Frosting). Sections cannot be reordered yet.
- **Undo and redo.** The toolbar and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. Deleting a row, step or section can be undone, and the toolbar says what Undo does.
- **Save.** Nothing is saved until you choose **Save** (Ctrl/Cmd+S). There is no autosave. If someone saved the recipe after you opened the editor, Save shows a conflict panel: keep editing, load the latest version (discards your changes), or replace their version with yours (asks to confirm).
- **Leaving.** While there are unsaved changes, reload, tab close, Cancel and browser Back (including the Android back gesture and the iOS edge swipe) ask first. Links in the page header do not ask (see [Known limitations](#known-limitations)).

**Keyboard.** The editor needs no pointer. Each table is one tab stop; inside it use the arrow keys, Home and End to move between rows and steps. A **Keyboard help** disclosure below the toolbar lists every key. The main ones, when a row or step has focus:

| Key                              | On                            | Effect                                  |
| -------------------------------- | ----------------------------- | --------------------------------------- |
| `Alt+Up` / `Alt+Down`            | ingredient row                | Move the row up or down                 |
| `F2`                             | ingredient row                | Edit the text                           |
| `Shift+F10` or the Menu key      | ingredient row                | Open Row actions (split, move, delete)  |
| `Alt+Up` / `Alt+Down`            | step                          | Move the top edge up or down one row    |
| `Shift+Down` / `Shift+Up`        | step                          | Move the bottom edge down or up one row |
| `Alt+Left` / `Alt+Right`         | step                          | Move the step one column                |
| `Delete` or `Backspace`          | row or step                   | Delete it (Undo is offered)             |
| `Ctrl/Cmd+Enter`                 | while editing a row           | Save the line and open a new row below  |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | anywhere outside a text field | Undo, redo                              |
| `Escape`                         | drag, edit, menu              | Cancel                                  |

**Phone.** At widths under 640 px there is no drag. Tap a step to open a bottom sheet with Start row and End row steppers and the names of the covered ingredients, which the grid highlights. Tap an ingredient's "..." button for Row actions.

**API.** `PUT /api/recipes/:id/grid` replaces the recipe's sections, ingredients and steps in one transaction.

- Body: `{ "base_updated_at": "<updated_at you loaded>", "sections": [...] }`. `sections` has the same shape as in the recipe body (1 to 20 sections). Any other key (`title`, `tags`, `visibility`, `view_mode`, `id`) is rejected with 422.
- `409` `{ "error": "conflict", "updated_at": "..." }` when `base_updated_at` no longer equals the stored value; nothing is written.
- `422` `{ "errors": [{ "path": "...", "code": "..." }] }` for invalid spans or structure. A row that no step covers is a warning, not an error, and saves.
- `401` signed out, `403` a recipe you can read but not write, `404` a recipe you cannot read, `415` not JSON, `413` over 1 MiB.
- Every response, including errors, carries `Cache-Control: private, no-store`.
- If you change a quantity or unit through the API, send the other measure as `null`; a non-null value is stored as sent and can go stale. The editor does this for you.
- After the save the server recomputes `view_mode` (`grid` when at least one column step exists, otherwise `list`) and issues new ids for sections, ingredients and steps. Do not keep ingredient or step ids across a save.

## Import a recipe

Open **Import** (`/import`). There are two ways in.

**From a web address.** Enter the address of a recipe page and choose **Import recipe**. Cellar fetches the page and reads the Schema.org `Recipe` data (JSON-LD) that most recipe sites publish. If the static page has no readable recipe or the site answers 403/429, Cellar can retry in a headless browser when the optional sidecar is enabled (see [Headless import](#headless-import-optional)). Without the sidecar, only pages that contain that data in their static HTML can be read.

**Paste the recipe.** Use the **Paste the recipe** tab when a site blocks the fetch or has no readable data. You can paste either:

- the page's HTML source (or just its JSON-LD block), which goes through the same reader as a fetched page, or
- plain recipe text. The first non-empty line is the title; a line reading `Ingredients` starts the ingredients (one per line), and a line reading `Instructions`, `Directions`, `Method` or `Steps` starts the steps. Without those headings the import fails with `no_recipe`.

Pasted text is limited to 500,000 characters. A paste import makes no network request.

Either way you land on a review screen. Everything is editable, tags found on the page (keywords and category) appear as editable chips and are saved with the recipe (remove the ones you do not want), and a banner appears when you already have a recipe from the same address (you can still choose **Import anyway**). Nothing is written to your recipes until you press **Save imported recipe**. A failed import never creates a recipe. If **Include the cover image** is checked, the image is downloaded when you save, re-encoded to WebP at up to 1600 px with metadata removed, and stored under the uploads directory. It is displayed as the recipe's cover since v0.4.2; the review screen does not preview it.

### Automatic grid mapping

After the recipe is read, Cellar tries to work out which ingredients each step uses, so the recipe can be saved as a grid instead of a plain list. It does this with fixed rules on your server: it matches ingredient names in the step text (singular and plural, a small synonym list, parentheticals ignored), orders the ingredient rows by first use, and gives each step the rows combined so far. Steps before the first ingredient ("Preheat the oven") become top banners, trailing steps with no new ingredient become bottom banners, section headings ("For the frosting") start new sections, and an ingredient used in two steps ("half the sugar now") is split into two rows when the amounts can be worked out. Nothing is sent to an AI service. The step wording is read in English only.

Every proposal gets a match score from 0 to 1 and a level:

| Level                         | Score              | What you see on the review screen                                                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| High, "Good match"            | 0.70 and above     | The grid is applied and the screen opens with **Grid** selected, with a grid preview above the form.                      |
| Medium, "Check the mapping"   | 0.40 to below 0.70 | The screen opens in **List** (page order, no row ranges). **Preview as grid** applies the proposal so you can look at it. |
| Low, "Could not map reliably" | below 0.40         | The screen opens in **List**. **Try the grid anyway** is available but secondary.                                         |

The badge is text plus an icon, and **Why this score** lists the reasons (for example an ingredient that no step mentions, or a name such as "sugar" that could mean two ingredients). If the mapper could not run at all (too long, too many sections, or a failed check), there is no badge and the screen behaves as in v0.3.0.

To correct a mapping, change the ingredient row numbers (first and last row) in a step below the preview; the preview updates as you type. Do not reorder the ingredient lines, change the numbers instead. **Reset to proposal** restores the suggestion and **Use list view instead** goes back to the page order. Both ask before replacing edits to ingredients and steps; title and other details are kept. The score describes the proposal, not your edits.

Saving as a grid requires every step to have a valid row range; otherwise the API refuses it and the recipe stays a list. List view is always available: choose it and save, and the recipe is stored exactly as imported. An imported recipe saved as a list can be converted later with **Convert to grid** on its page.

Limits: the mapper works on at most 200 ingredients and 100 steps (anything longer is cut, with a note), at most 6 sections, and a fixed amount of work per recipe. A proposal that is too large to keep with the draft is dropped. These limits keep untrusted text from tying up the server.

Known weaknesses: spelling variants between the ingredient list and the steps ("yoghurt" and "yogurt"), ingredient names that are also cooking verbs, recipes that run two parallel preparations, and any language other than English. Such recipes usually end at medium or low and stay in list view, but a high score is still a guess: always look at the preview.

### Headless import (optional)

Some recipe pages only exist after JavaScript runs, or refuse plain HTTP clients. The optional `browser` sidecar renders such a page in headless Chromium and returns the DOM, which goes through the same sanitize and extract pipeline as any import.

- **When it triggers.** The fallback chain is static fetch, then headless, then paste. Headless runs only when the static page has no Recipe data at all, or the static fetch is refused with 401, 403 or 429, and only if `HEADLESS_URL` is set. A page whose Recipe data exists but is empty does not trigger it. A review draft from it has `method = headless` and a note on the review screen.
- **Off by default.** With `HEADLESS_URL` unset, the app makes no sidecar request and behaves as in v0.3.1. A plain `docker compose up` does not start the sidecar.
- **Enable it.** Set `HEADLESS_URL=http://browser:3001` and `HEADLESS_TOKEN=$(openssl rand -hex 32)` in `.env` (the app refuses to start with a `HEADLESS_URL` and no valid token), then run `docker compose --profile headless up -d --build` (add your usual `-f` and `--profile` flags). The sidecar refuses to start without a token.
- **Cost.** Sidecar image about 1.2 GB on disk (the app image is about 437 MB). Memory on amd64: about 106 MiB idle, about 178 MB after one small render, 195 MB peak; the compose limit is 2 GiB. Heavy real pages and arm64 are not measured. Startup time was not measured.
- **Security.** Every request Chromium makes goes through a filtering proxy that resolves each host once and refuses private, loopback, link-local and metadata addresses. The sidecar runs as non-root with a read-only root, no volumes, no published ports and Chromium's own sandbox on. It executes untrusted JavaScript, so a Chromium zero-day is the residual risk. Details, the network layout and an optional firewall snippet: [docs/deployment.md](docs/deployment.md).
- **Unsupported hosts.** Hosts with `user.max_user_namespaces=0` (unprivileged user namespaces disabled) are unsupported. The sidecar exits with an `UNSUPPORTED HOST` message and never runs without its sandbox.
- **arm64: verified in CI on a native GitHub arm64 runner** (sidecar sandbox and syscall tests, real Chromium render tests, app image, `sharp` re-encode). It is not verified on Raspberry Pi or Home Assistant OS hardware itself; the kernel there must allow unprivileged user namespaces. QEMU emulation cannot run the sandbox and is not used for this.
- **Upgrade from v0.3.1.** Pull the new code and rebuild; migration `0004` runs automatically at app start and keeps existing data. To upgrade the sidecar image later, rebuild it: `docker compose --profile headless build --no-cache browser`.
- **Upgrade to v0.4.0.** The app applies migrations `0005` and `0006` at start (search index, tags). If you use the sidecar, rebuild it too (`docker compose --profile headless build`, then `up -d`): its address limit is now 2048 characters, the same as the app, and it answers `busy` when at capacity, which the review screen reports as "try again in a moment". An old sidecar with the new app still works; a busy answer is then reported as unavailable.

### Error codes

When an import fails, the API still answers 200 with `status: "failed"` and one of these codes, and the page offers the paste fallback.

| Code                   | Meaning                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_url`          | Not an http or https address, contains a username or password, or uses a port other than 80 or 443.                                                                                                                                                           |
| `private_address`      | The host resolves to a private, loopback, link-local or otherwise internal address, at the first request or at any redirect.                                                                                                                                  |
| `blocked`              | The site answered 403 or 429, or showed a bot wall.                                                                                                                                                                                                           |
| `timeout`              | The whole fetch, including redirects, took longer than 10 seconds.                                                                                                                                                                                            |
| `too_large`            | The response exceeded 5 MB.                                                                                                                                                                                                                                   |
| `fetch_failed`         | DNS failure, connection error, a non-HTML content type, or a server error.                                                                                                                                                                                    |
| `no_recipe`            | The page was fetched but no usable recipe (title, at least one ingredient and one step) was found.                                                                                                                                                            |
| `headless_unavailable` | The headless step was needed but `HEADLESS_URL` is unset, or the sidecar is down, busy or returned an invalid response. Use paste. When the cause was a busy sidecar the response also carries `headless: "busy"` and the page says to try again in a moment. |

Requests that are malformed are rejected with HTTP 400 (invalid JSON), 401, 403 (origin check), 415 (not JSON) or 422 (validation). Exceeding the rate limit returns 429 with a `Retry-After` header.

### Limits

| Limit                | Value                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Response size        | 5 MB, counted on streamed bytes                                                                                           |
| Total time per fetch | 10 seconds, including redirects                                                                                           |
| Ports                | 80 and 443 only                                                                                                           |
| Redirects            | 5, each one re-validated                                                                                                  |
| Pasted text          | 500,000 characters                                                                                                        |
| Rate limit           | `RATE_LIMIT_IMPORT_MAX` imports (default 20) per user per `RATE_LIMIT_IMPORT_WINDOW_SEC` (default 3600 s); failures count |

### How the fetch is restricted (SSRF guard)

Because the instance may be internet-exposed, the fetcher in `src/lib/import/safe-fetch.ts` is the only code that talks to the network for imports. It resolves the host once, rejects every resolved address in private, loopback, link-local (including cloud metadata), CGNAT, multicast and reserved ranges (IPv4 and IPv6, including mapped forms), and connects to the validated address so DNS cannot change between check and connect. Redirects are followed manually. The tests use an injected resolver and transport.

What this has not been tested against: a real network. TLS certificate and SNI handling with the pinned address is covered by the code design but unverified against live sites (see [docs/tasks/v0.3.0-carryover.md](docs/tasks/v0.3.0-carryover.md)).

### Stored data

- The imported draft is kept in the `import_job` table (`draft_json`). Failed and abandoned jobs older than `IMPORT_JOB_TTL_DAYS` (default 30, `0` disables) are pruned lazily, together with their raw HTML files. There is no background process.
- Raw HTML is **not** stored unless `KEEP_RAW_HTML=true`. When enabled, files are written to `RAW_HTML_DIR` (default `import-raw/` next to the uploads directory, which is next to the database unless you moved `UPLOADS_DIR`; this is the same place v0.3.0 and v0.3.1 used) and pruned with their job. Files left in that older location are still cleaned up if you later point `RAW_HTML_DIR` elsewhere, but they are not moved. Headless-rendered HTML can be larger.
- Covers are stored in the uploads directory (`UPLOADS_DIR`; `/data/uploads` in Docker, inside the `app-data` volume, so the [backup](#backup) covers them).
- `source_url` is stored in a normalized form (host lowercased, fragment, default port and tracking parameters removed, query parameters sorted, trailing slash removed) with the scheme you entered, so an `http`-only site keeps a working link. For the duplicate warning, `http` and `https` are treated as equal.
- The mapping proposal is part of the draft in `draft_json`; no new table or column was added in v0.3.1. Draft tags (keywords and category) are part of the draft too and become `tag` rows only when you save.

### Import fixture report

`npm run test:import` runs the import pipeline offline (a fake fetcher, no network) over the 50 hand-written fixtures in `tests/fixtures/import/` and prints a table and a success rate. The run for v0.4.0 reports 39 of 39 valid drafts (100 percent, target 85 percent; 50 fixtures in total), 7 of 7 deliberate rejections, and 4 out-of-slice pages.

What the 100 percent means: every fixture that a static JSON-LD reader should handle produces a draft that passes the recipe schema, and the pages that must be rejected are rejected. What it does not mean: that 100 percent of real recipe sites import. The fixtures are small hand-written pages written for this reader, so they cannot predict real-world markup. Since v0.4.0 the two microdata-only fixtures are valid drafts (a reader for `itemprop` markup is used when a page has no JSON-LD recipe; JSON-LD wins when both exist). The 4 out-of-slice pages (3 JavaScript-only, 1 blocked) are excluded from the rate by definition and produce `no_recipe` without the sidecar. Expect a lower rate on real sites; the report is a regression guard, not a coverage measurement.

### Mapper accuracy report

`npm run test:mapper` runs the mapper offline over the hand-written fixtures in `tests/fixtures/mapper/` (69 files) plus five references derived from the sample recipes, and prints a per-fixture table, calibration buckets and pass/fail gates. `npm run test:import` prints the same section. It exits 1 when a gate fails. The last run on this branch: references 5 of 5 exact, clean set 31 of 31 exact (124 of 124 step spans), hard set 23 of 25 exact (31 hard fixtures, 12 of them added after the code review as adversarial cases), 0 recipes wrong at a score of 0.70 or more, negatives 6 of 6 ended as list or no proposal. Any `hard` fixture that misses its stated expectation fails CI unless it carries a `known_miss` reason.

What the numbers mean: the fixtures were written by the same people who wrote the mapper, so the clean set at 100 percent is a regression guard, not an accuracy estimate. The hard set is the honest signal: it holds the ambiguous cases, and the two it gets wrong (a "yoghurt" versus "yogurt" spelling difference, and steps with no recognisable verbs) both score below 0.70, which is the behaviour we want; a third, `basil leaves` not matching "the basil", also scores 0.69 and is listed as a known miss. The 12 added fixtures were written from general cooking-writing shapes without tuning, and the first run exposed one confident-wrong case (a trailing step such as "Finish with the remaining butter" was treated as a banner), which was fixed in the mapper. The "no confident wrong answer" gate is only as strong as the fixtures. The mapper has not been measured on real recipe pages. Expect real pages to score lower and to need correction more often.

Imports do not use any AI or LLM service.

## Run locally

**Prerequisites**: Node.js 22 or newer (`.nvmrc` pins 24), npm.

```bash
npm ci
cp .env.example .env
```

Edit `.env` and set `SESSION_SECRET` to a random string of at least 32 characters:

```bash
openssl rand -base64 48
```

Start the dev server:

```bash
npm run dev
```

Open <http://localhost:3000>. You are redirected to `/login`; see [First run](#first-run) to create the admin.

The database is created at `DATABASE_PATH` (`./data/app.db` in `.env.example`) and migrations run on app start.

> **Dev database note (v0.2).** If your local dev database already applied the earlier, unreleased `0001` migration from a v0.2 work-in-progress branch, it no longer matches the released migrations and must be reset: stop the dev server and delete the file at `DATABASE_PATH` (`./data/app.db`, plus any `app.db-wal` and `app.db-shm` next to it), then start again to recreate it (and create the admin again at `/setup`). Databases created by v0.1 (including Docker volumes) need nothing: migrations `0001` and later apply automatically on start.

| Command                              | What it does                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Dev server                                                                                                                                                                                                                                                                            |
| `npm run build`                      | Production build (standalone output). To run it, see [Run the production build locally](#run-the-production-build-locally)                                                                                                                                                            |
| `npm test`                           | Unit tests (Vitest)                                                                                                                                                                                                                                                                   |
| `npm run test:e2e`                   | End-to-end tests (Playwright), including the visual and accessibility specs. Builds the app and serves it on port 3100 with a throwaway `data/e2e.db`. If browsers are missing, run `npx playwright install chromium` first. See [Visual end-to-end tests](#visual-end-to-end-tests). |
| `npm run test:import`                | Import fixture report: runs the pipeline offline over `tests/fixtures/import/` and prints the success rate (exits 1 below 85 percent). See the README in that folder.                                                                                                                 |
| `npm run test:mapper`                | Auto-mapper accuracy report over `tests/fixtures/mapper/` (exits 1 when a gate fails). See [Mapper accuracy report](#mapper-accuracy-report).                                                                                                                                         |
| `npm run seed`                       | Insert the two sample recipes. Dev and demo only; see [Sample data](#sample-data).                                                                                                                                                                                                    |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript                                                                                                                                                                                                                                                                   |

### Sample data

`npm run seed` is a demo tool: it inserts sample recipes into the real database that `DATABASE_PATH` points at (the same one the app uses), owned by an actual account. Do not run it against a database holding data you want kept clean. It inserts two self-written sample recipes for demos and development: _Mocha Skillet Cookie_ (one section) and _Vanilla Cake with Frosting_ (two sections, a split ingredient and a bottom banner). Both open in grid view.

The seed needs an existing user to own the recipes. Create the first admin at `/setup` first (see [First run](#first-run)). Without `--user` it uses the oldest active admin; with `--user` it uses that active account. If no matching user exists, it prints an error and exits with code 1. It is safe to run twice: a sample whose title the owner already has is skipped.

The script reads its settings from the environment and does not load `.env` itself, so export them first (it needs `SESSION_SECRET` and uses `DATABASE_PATH`):

```bash
set -a; . ./.env; set +a
npm run seed
npm run seed -- --user member@example.com
```

Example output:

```
created: Mocha Skillet Cookie (owner admin@example.com)
created: Vanilla Cake with Frosting (owner admin@example.com)
```

**Docker:** the image ships the seed as an esbuild bundle (`dist/seed.mjs`) and maps it like `admin:reset`, so this works against a running instance, after the first admin exists:

```bash
docker compose exec app npm run seed -- --yes
docker compose exec app npm run seed -- --user member@example.com --yes
```

**Production guard:** when `NODE_ENV=production` (always the case in the Docker image) the seed refuses to run, naming the database it would write to, unless you pass `--yes` or set `SEED_CONFIRM=1`.

It opens the same SQLite file as the app (WAL mode), so the app does not need to be stopped and no database file needs to be copied around.

### Visual end-to-end tests

`tests/e2e/recipes-visual.spec.ts` compares screenshots of both sample recipes at 375, 768 and 1280 px (plus dark theme and the phone bottom sheet) with the PNG baselines in `tests/e2e/__screenshots__/`. `tests/e2e/recipes-a11y.spec.ts` runs axe-core and keyboard checks on the grid.

```bash
npx playwright install chromium   # once
npm run test:e2e                  # everything
npx playwright test recipes-visual
```

**The baselines are Linux x86_64 Chromium only** (file names end in `-chromium-linux`). Font rendering differs on macOS, Windows and arm64, so the visual specs fail there for reasons unrelated to your change. Run them on Linux x86_64, or in CI.

To regenerate the baselines after an intentional UI change, run this on Linux x86_64:

```bash
npx playwright test recipes-visual --update-snapshots
```

Review every changed PNG by eye before you commit it.

### Run the production build locally

`output: 'standalone'` means `npm start` (`next start`) prints a warning and is not supported. Run the standalone server instead. It does not read `.env`, so export the variables first, and copy the static assets next to it (without them every `/_next/static` file returns 404):

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
set -a; . ./.env; set +a
BASE_URL=http://localhost:3000 PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production node .next/standalone/server.js
```

If you change `PORT`, set `BASE_URL` to the same port (see [Changing the port](#changing-the-port)).

## Run with Docker

**Prerequisites**: Docker with the Compose plugin.

```bash
cp .env.example .env
# set SESSION_SECRET in .env (openssl rand -base64 48)
docker compose -f docker-compose.yml -f docker-compose.direct.yml up -d --build
```

Open <http://localhost:3000>. Compose refuses to start if `SESSION_SECRET` is unset, and the app refuses to start in production if it is shorter than 32 characters or a known placeholder such as the one in `.env.example`.

#### Changing the port

> **Warning:** if you change `APP_PORT`, you must set `BASE_URL` to the same port, for example `APP_PORT=3412` and `BASE_URL=http://localhost:3412`. Otherwise the origin allowlist rejects every POST with a 403, and the first-run `/setup` form fails without a useful message. Compose defaults `BASE_URL` to `http://localhost:${APP_PORT:-3000}`, but set it explicitly in `.env` for any other host name or when using HTTPS.

`docker-compose.direct.yml` is the opt-in file that publishes the app port; it is not loaded automatically, so a plain `docker compose up` or `--profile caddy` run never exposes the app port by accident. Data lives in the `app-data` volume, mounted at `/data`.

### Caddy profile (automatic HTTPS)

Use this to put the app on a public host name with a Let's Encrypt certificate. Set in `.env`:

```bash
SITE_ADDRESS=recipes.example.com
BASE_URL=https://recipes.example.com
TRUSTED_PROXIES=172.28.0.10
```

`172.28.0.10` is the fixed address Caddy gets on the compose network. DNS must point at the host, and ports 80 and 443 must be reachable. Then start with:

```bash
docker compose --profile caddy up -d --build
```

The app port is **not** published in this mode; only Caddy listens (80, 443). Do not combine this with `docker-compose.direct.yml`: with the app port reachable, `TRUSTED_PROXIES` can be spoofed (see [Known limitations](#known-limitations)).

The app does not send `Strict-Transport-Security`. If you want HSTS, let Caddy add it, for example `header Strict-Transport-Security "max-age=15552000"` inside the site block of `Caddyfile`. Only do this once you are sure the host will stay on HTTPS.

See [docs/deployment.md](docs/deployment.md) for details.

### Multi-arch image

Build for amd64 and arm64 with buildx (cross-building needs QEMU; see [docs/deployment.md](docs/deployment.md)):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t cellar:multi .
```

Add `--push` and a registry tag to publish.

### Backup

This is the full backup. (The **Backup** page of the app exports recipes only; see [Backup and restore](#backup-and-restore).) Back up the `/data` volume. The SQLite database and, since v0.3.0, the uploads directory (`/data/uploads`, imported covers) live in it. With the app stopped (`docker compose stop app`), for example:

```bash
docker run --rm -v cellar_app-data:/data -v "$PWD":/backup alpine tar czf /backup/cellar-data.tgz -C /data .
```

The volume name is `<compose project>_app-data`; check with `docker volume ls`.

### Troubleshooting

- **Every form submit returns 403, or `/setup` does nothing:** `BASE_URL` does not match the address in your browser. Make the host and port identical (`APP_PORT=3412` needs `BASE_URL=http://localhost:3412`), then run `docker compose ... up -d` again so the container picks it up.
- **`Pool overlaps with other one on this address space` on `up`:** the compose network uses the fixed subnet `172.28.0.0/24` (Caddy is `172.28.0.10`). A second compose project, or any other Docker network, using that range conflicts. Stop the other project or change the `subnet` and `ipv4_address` in `docker-compose.yml` (and `TRUSTED_PROXIES` to match).

## Environment variables

Validated at startup in `src/lib/env.ts`. See `.env.example` for a template.

| Variable                         | Required      | Default                                       | Description                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`                  | no            | `/data/app.db`                                | Path of the SQLite file. The directory is created if missing. Compose sets it to `/data/app.db`; `.env.example` uses `./data/app.db` for local runs.                                                                                                                                                                                                                                                      |
| `SESSION_SECRET`                 | yes           | none                                          | At least 32 characters. In production, known placeholders (`changeme`, `replace-with...`, `your-...`, a single repeated character) are rejected.                                                                                                                                                                                                                                                          |
| `BASE_URL`                       | in production | `http://localhost:3000` (non-production only) | Public origin, for example `https://recipes.example.com`. **Must use the same port you open in the browser (`APP_PORT`); on a mismatch every POST gets 403.** No path, no trailing slash. Used for invite and reset links and the origin allowlist. With `https://`, the CSP also gets `upgrade-insecure-requests`.                                                                                       |
| `TRUSTED_PROXIES`                | no            | empty (trust none)                            | Comma-separated IPs or CIDRs whose `X-Forwarded-*` headers are trusted. With the Caddy profile use `172.28.0.10`.                                                                                                                                                                                                                                                                                         |
| `RATE_LIMIT_LOGIN_MAX`           | no            | `20`                                          | Failed login attempts per client IP per window (successful logins and malformed requests are not counted). Skipped when the client IP is unknown.                                                                                                                                                                                                                                                         |
| `RATE_LIMIT_LOGIN_EMAIL_MAX`     | no            | `10`                                          | Failed login attempts per account email per window (reset on a successful login). Always enforced.                                                                                                                                                                                                                                                                                                        |
| `RATE_LIMIT_LOGIN_WINDOW_SEC`    | no            | `900`                                         | Login window in seconds.                                                                                                                                                                                                                                                                                                                                                                                  |
| `RATE_LIMIT_REGISTER_MAX`        | no            | `10`                                          | Invite registration, reset and setup POSTs per client IP per window. Skipped when the client IP is unknown.                                                                                                                                                                                                                                                                                               |
| `RATE_LIMIT_REGISTER_WINDOW_SEC` | no            | `3600`                                        | Registration window in seconds.                                                                                                                                                                                                                                                                                                                                                                           |
| `RATE_LIMIT_IMPORT_MAX`          | no            | `20`                                          | URL/paste imports (`POST /api/import`) per user per window; every attempt counts, including failures.                                                                                                                                                                                                                                                                                                     |
| `RATE_LIMIT_IMPORT_WINDOW_SEC`   | no            | `3600`                                        | Import window in seconds.                                                                                                                                                                                                                                                                                                                                                                                 |
| `PUBLIC_LINKS_ENABLED`           | no            | `true`                                        | `true` or `false` (anything else fails at startup). `false` disables every public `/r/<token>` link on this instance: they answer the invalid-link page, link creation is refused with 403 `public_links_disabled`, and stored tokens are kept but inert until you set it back to `true`.                                                                                                                 |
| `RATE_LIMIT_PUBLIC_MAX`          | no            | `120`                                         | Requests to `/r/*` per client IP per window (IPv6 clients are grouped by /64); over it the answer is 429 with `Retry-After`. Skipped when the client IP is unknown (needs `TRUSTED_PROXIES`).                                                                                                                                                                                                             |
| `RATE_LIMIT_PUBLIC_WINDOW_SEC`   | no            | `60`                                          | Public link window in seconds.                                                                                                                                                                                                                                                                                                                                                                            |
| `RATE_LIMIT_EXPORT_MAX`          | no            | `10`                                          | Backup downloads (`GET /api/export`) per user per window. A failed export is not counted. One export at a time per user, whatever this is set to.                                                                                                                                                                                                                                                         |
| `RATE_LIMIT_EXPORT_WINDOW_SEC`   | no            | `3600`                                        | Export window in seconds.                                                                                                                                                                                                                                                                                                                                                                                 |
| `RATE_LIMIT_RESTORE_MAX`         | no            | `10`                                          | Restore uploads (`POST /api/import/backup`) per user per window. A request rejected before any byte is stored (wrong type, `409`, declared size over the limit) is not counted.                                                                                                                                                                                                                           |
| `RATE_LIMIT_RESTORE_WINDOW_SEC`  | no            | `3600`                                        | Restore window in seconds.                                                                                                                                                                                                                                                                                                                                                                                |
| `RESTORE_BODY_MAX`               | no            | `268435456` (256 MiB)                         | Largest backup upload, in bytes (1024 to 4294967295). Over it the upload is refused with 413 while it streams. A JSON upload is also capped at 16 MiB. Raise your reverse proxy's body limit for `POST /api/import/backup` together with this ([docs/deployment.md](docs/deployment.md)).                                                                                                                 |
| `RESTORE_DIR`                    | no            | `<dir of UPLOADS_DIR>/restore`                | Where checked backup uploads wait before they are applied (mode 0700; each file is removed after apply, discard or one hour). `/data/restore` in Docker. Needs free disk space for the largest upload.                                                                                                                                                                                                    |
| `KEEP_RAW_HTML`                  | no            | `false`                                       | When `true`, fetched or pasted HTML is kept at `<RAW_HTML_DIR>/<job id>.html` (mode 0600). Off by default (nothing is written). Kept files are deleted with their job by the lazy retention sweep (`IMPORT_JOB_TTL_DAYS`).                                                                                                                                                                                |
| `RAW_HTML_DIR`                   | no            | `<dir of UPLOADS_DIR>/import-raw`             | Where raw HTML is kept when `KEEP_RAW_HTML=true`. Defaults to the v0.3.0/v0.3.1 location. Compose sets `/data/import-raw`.                                                                                                                                                                                                                                                                                |
| `IMPORT_JOB_TTL_DAYS`            | no            | `30`                                          | Failed and abandoned import jobs (and their raw HTML) older than this are pruned lazily. `0` disables pruning. Integer, 0 to 36500.                                                                                                                                                                                                                                                                       |
| `HEADLESS_URL`                   | no            | unset (headless off)                          | Bare `http://` origin of the sidecar, for example `http://browser:3001`. No credentials, path, query or hash. Unset means no sidecar request is ever made.                                                                                                                                                                                                                                                |
| `HEADLESS_TOKEN`                 | no            | unset                                         | Shared bearer secret sent to the sidecar. 32 or more characters from `A-Za-z0-9+/_=-` (`openssl rand -hex 32`), the same rule the sidecar applies. The sidecar requires the same value and refuses to start without it, so the app rejects a `HEADLESS_URL` without a token at startup. The token travels over plain `http://`: keep `HEADLESS_URL` on the internal compose network, never a public host. |
| `HEADLESS_TIMEOUT_MS`            | no            | `35000`                                       | How long the app waits for the sidecar, 1 to 35000. The sidecar's own render limit is a fixed 30 s and cannot be raised. If the app gives up first, the sidecar cancels that render and frees its slot.                                                                                                                                                                                                   |
| `UPLOADS_DIR`                    | no            | `<dir of DATABASE_PATH>/uploads`              | Where recipe photos (uploaded and imported) are stored. `/data/uploads` in Docker.                                                                                                                                                                                                                                                                                                                        |
| `IMPORT_ALLOW_LOCAL_FETCH`       | no            | `false`                                       | Development and tests only: lets the importer fetch private addresses and non-80/443 ports (local fixture server). **Disables the SSRF guard; startup fails if set in production.**                                                                                                                                                                                                                       |

**Rate limiting and unknown clients.** Per-IP limits only work when the app can tell clients apart, which needs `TRUSTED_PROXIES` to match your reverse proxy. Without it (the default for direct mode or `npm run dev`) every visitor looks like the same "unknown" client; rather than let a few bad requests lock everybody out, the per-IP limits (login, registration and the public `/r/*` limit) are then skipped and only the per-email login limit applies. Your proxy must also send `X-Forwarded-For`. Register and reset links carry unguessable tokens, so they stay safe without a per-IP limit. Counters are in memory and reset on restart.

Sidecar-only variables (read by the `browser` container, not the app): `BIND_ADDR` (default `0.0.0.0`; must be an IP address literal, set it to the container's internal address if you can), `HEADLESS_ALLOW_NO_TOKEN` (set to `1` to start the sidecar without a token; logged, tests only, not recommended; the app needs the same variable to accept a `HEADLESS_URL` without a token), `PORT` (3001) and render limits. See [docker/browser/README.md](docker/browser/README.md).

Docker-only variables read by Compose (not by the app): `APP_PORT` (published host port, default `3000`; `BASE_URL` must use the same port) and `SITE_ADDRESS` (Caddy host name, default `localhost`).

## First run

On a fresh database, open `/setup` (for example <http://localhost:3000/setup>) and create the first admin account with an email, display name and password. After that, sign in at `/login`.

> **Warning:** until the first admin exists, `/setup` is open to anyone who can reach the app, and whoever submits it first becomes the admin. Complete setup before you expose the host to a network or the internet (for example, finish it on `localhost` or before opening ports 80/443).

## Invite users

Signed in as an admin, open **Admin > Users** (`/admin/users`) and create an invite, optionally for a specific email. The app shows an invite link once; send it to the person. The link is single use and expires after 7 days. The person opens it, sets a display name and password, and has a member account.

## Password recovery

An admin can issue a reset link for a user from `/admin/users`. If you are locked out of every admin account, run this on the host:

```bash
docker compose exec app npm run admin:reset -- user@example.com
```

When running locally, use `npm run admin:reset -- user@example.com`. The command prints a one-time reset link (`/reset/<token>`) that expires after 1 hour; opening it sets a new password and signs the user out everywhere. It applies pending migrations first, so it also works on a fresh volume.

Deactivated accounts are not reactivated: the command exits with an error for them.

## Notes

- Text strings live in `messages/` at the repository root (currently `messages/en.json`).
- `src/proxy.ts` is the Next.js 16 name for what used to be `middleware.ts`. It gates unauthenticated requests and sets the security headers (CSP with a per-request nonce, and others). It does not run for `/api/import/backup` (the restore upload, see [docs/deployment.md](docs/deployment.md)); that route checks the session itself.
- The data model is documented in [docs/data-model.md](docs/data-model.md).

## Known limitations

- **Import cover preview.** The import review screen does not preview the cover (the page's content security policy blocks remote images). The automatic grid mapping is a proposal measured only on hand-written fixtures, works for English only, and the review screen has no visual editor (correct a mapping by editing row numbers, or save it and use **Edit grid layout** on the recipe page). JavaScript-only pages need the optional headless sidecar (v0.3.2, off by default). Microdata-only pages are read by a bounded reader (only the first 40,000 `<` characters of a page are parsed); a page where the recipe lies beyond that is not read. Its accuracy on real sites is untested.
- **Headless import is optional and partly unverified.** arm64 is verified on a GitHub arm64 runner only (not on Pi hardware), hosts with `max_user_namespaces=0` are unsupported, and several checks are listed in [docs/tasks/v0.3.2-carryover.md](docs/tasks/v0.3.2-carryover.md).
- **Grid editor.** There is no autosave and concurrent edits are not merged: a conflict means choosing your version or theirs. List recipes need **Convert to grid** first. Sections cannot be reordered and ingredients cannot be reordered by dragging (use Move up and down or Alt+Up and Alt+Down). Links in the page header do not ask before discarding unsaved changes; browser Back does. Two very fast browser Backs in a row can still leave the editor open with unsaved edits (CR-m2d). The Alt+Left and Alt+Right chords that move a step one column are not verified against real browser history navigation (O4), so on some browsers they may trigger Back or Forward instead. Tested in Chromium with emulated touch only: real phones and tablets (including drag and the Back gesture), Firefox, Safari and screen readers are untested. Accessibility was checked with axe and scripted keyboard tests, not with assistive technology. Details: [docs/tasks/v0.4.1-carryover.md](docs/tasks/v0.4.1-carryover.md).
- **Search is basic by design.** No stemming (plural and singular differ), no typo tolerance, no phrase or `OR` syntax (operators typed in the box are treated as plain text), results capped at 100 with a query. Result order uses ranking statistics computed over every recipe in the database, so in principle the order of two results you can read can depend on words in recipes you cannot (the documented Low finding F3 in [docs/tasks/v0.4.0-security-checkpoint.md](docs/tasks/v0.4.0-security-checkpoint.md), open for the owner's decision).
- **Unit conversion covers a short ingredient list.** Cross conversion (cup to grams) exists only for the ingredients named under [Units and scaling](#units-and-scaling). Search and unit display are untested in Firefox, Safari and with a screen reader; see [docs/tasks/v0.4.0-carryover.md](docs/tasks/v0.4.0-carryover.md) for what is not tested.
- **Rate limiting is in memory.** Counters reset when the app restarts and are not shared between processes.
- **Single process only.** Because of the in-memory rate limiter and the single SQLite file, run exactly one app instance.
- **`TRUSTED_PROXIES` can be spoofed if the app port is reachable.** Any client that can connect directly from a trusted address can forge `X-Forwarded-For` and evade per-IP limits. Behind Caddy, do not publish the app port (do not add `docker-compose.direct.yml` as shown above). This applies to the public link limit too: with the app port reachable, a client can send a fresh `X-Forwarded-For` on every request and never be limited (security checkpoint L1 in [docs/tasks/v0.5.0-security-checkpoint.md](docs/tasks/v0.5.0-security-checkpoint.md)).
- **Backup and restore (v0.5.1).** Restore uploads have no total time limit (only a 30 s stall limit), there is no per-user limit on restore attempts and no cap on the disk the staged files use beyond one file per user, and the restore was not tried from a phone browser, through the bundled Caddy or on a second real Docker instance. See [docs/tasks/v0.5.1-carryover.md](docs/tasks/v0.5.1-carryover.md).
- **`style-src` allows `'unsafe-inline'`.** Scripts use a per-request nonce, but styles do not.

## License

See [THIRD_PARTY_NOTICE.md](THIRD_PARTY_NOTICE.md) for third-party notices.
