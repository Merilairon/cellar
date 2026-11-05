# Import fixture corpus

Used by `npm run test:import` (report) and `tests/unit/import-corpus.test.ts` (CI guard).
Runner: `scripts/import-corpus.ts`. Each fixture is `name.html` plus `name.expected.json`.

## Provenance and rules

- Every page is **hand-written and minimized** for this repository. None is a copy of a real
  site. The JSON-LD shapes (plain object, `@graph`, array root, `HowToSection`, string
  instructions, yield and duration variants, wrappers) follow patterns commonly seen on
  recipe sites and in the schema.org Recipe documentation; no site names, brands or recipe
  prose were copied. Ingredient lists and steps are generic (pancakes, soup, cake).
- Source shape date: 2026-11 (authored for v0.3.0). Domains are `example.com` /
  `*.invalid`-style placeholders.
- No full pages: each fixture is a minimal HTML wrapper around the structured data.
  The whole corpus must stay below 1 MB (asserted by the guard test).

## Expectation file

`{ expect, kind, title?, min_ingredients?, min_steps?, forbid?, cover_image?, input?, map?, carry?, note? }`

- `expect: "draft"`: must produce a valid draft; counts in the success rate.
- `expect: "no_recipe"`: deliberately rejected (paywalled stub, non-recipe pages,
  unrecoverable JSON-LD, Recipe without steps). Must return `no_recipe`; not in the rate.
- `expect: "out_of_slice"`: needs headless rendering (JS-only, carried to 3c) or a microdata
  parser (carried to 3b). Listed separately, **not** counted for or against the 85% target
  (owner decision). Today they must still return `no_recipe`, not crash.
- `forbid`: substrings that must not appear anywhere in the draft (sanitizer checks).
- `cover_image: null`: the draft must have no cover image (unsafe URL schemes dropped).
- `input: "paste"`: the fixture is `name.txt` (plain text) and goes through the paste path
  instead of `name.html` through the URL path.
- `map`: checks on the auto-mapper proposal the pipeline attaches (`draft.mapping`):
  `section_titles`, `min_confidence`, `max_confidence`, `level` (`high|medium|low|none`),
  `warnings_include`. The `map-*` fixtures prove the normalize -> mapper wiring end to end
  (HowToSection plus ingredient group headings, string steps, pasted `For the sauce:`).

## Success rate

`valid drafts / fixtures with expect = "draft"`, target >= 85%. The report also prints every
fixture, the out-of-slice list and the corpus size. Hostile fixtures (`hostile-*`) cover
script/iframe/style tags and event handlers in JSON-LD strings and `javascript:` / `data:`
image URLs.
