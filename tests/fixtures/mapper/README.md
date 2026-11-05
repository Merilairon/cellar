# Mapper fixtures

One hand-written JSON file per case for the auto-mapper (`src/lib/import/map-grid.ts`). All
text is self-authored: no site names, no copied recipes (same provenance rules as
`tests/fixtures/import/README.md`). The directory is asserted to stay under 300 KB.

Run the accuracy report with `npm run test:mapper` (also printed by `npm run test:import`).
`tests/unit/mapper-corpus.test.ts` fails CI on the hard gates.

## Format

```
{
  "class": "reference" | "clean" | "hard" | "negative",
  "note": "what this case exercises",
  "ingredients": ["4 oz butter", "For the frosting:", "1 cup powdered sugar"],
  "steps": ["plain string", { "text": "...", "section": "Cake" }],
  "expected": {
    "view": "grid" | "list" | "none",
    "sections": [ { "title": null, "rows": ["butter", "egg"],
                    "split": [ { "name": "sugar", "portions": ["half", "remaining"] } ],
                    "steps": [ { "kind": "banner_top" },
                               { "kind": "column", "row_start": 0, "row_end": 1 } ] } ],
    "warnings_include": ["ingredient_unmentioned:salt"]
  },
  "confidence": { "min": 0.7 },
  "known_miss": "reason, hard fixtures only"
}
```

- `rows` are normalized names: modifiers dropped, singular (`rowKey` in
  `src/lib/import/ingredient-match.ts`), so write `egg` for "2 large eggs".
- Expected spans are written by hand from what a person would draw, not copied from the
  mapper output. A fixture that exposes a mapper weakness stays in the corpus and is
  reported; it is not rewritten to match.
- `expected.view`: `grid` means a proposal at confidence >= 0.70, `list` a proposal below it,
  `none` no proposal. `sections` is optional: omit it when the case only checks the view.
- Only structure is compared: section titles, row order, split groups and portion labels,
  and per step `kind`, `row_start`, `row_end`. Step `label` text is not compared. A column
  step may also state `temp_f`, `temp_c`, `minutes_min`, `minutes_max`.

## Classes

- **reference**: the data-model section 2 brownie shape (`reference-brownie.json`). The
  sample A and sample B references are derived from `src/lib/recipes/samples.ts` by
  `scripts/mapper-corpus.ts` (shuffled and ordered input), not stored here.
- **clean**: ordinary recipes; the gate is at least 90 percent exact and 95 percent of steps
  with the right kind and span.
- **hard**: ambiguity, group references, unresolved splits, verb homonyms and other
  plausible-recipe shapes. Every hard fixture must meet the expectations it states (view,
  structure, confidence bounds, warnings) or carry `"known_miss": "<reason>"`. A miss
  without the marker fails CI, a marked fixture that now passes fails CI too (stale marker),
  and no fixture may be wrong at confidence >= 0.70 whether marked or not. `known_miss` is
  valid on hard fixtures only.
- **negative**: degenerate inputs that must end as `list` or `none`.

## What the numbers mean

The corpus is a **regression net on self-authored English text, not an accuracy estimate**.
The mapper's authors wrote the fixtures, so the clean set at 100 percent proves the code
matches their mental model. It says nothing about real sites, and the calibration table
(how often each confidence bucket is exact) is too small to validate the 0.70 threshold.

The 12 fixtures added after the v0.3.1 code review (`hard-verb-is-ingredient-*`,
`hard-parallel-components-meanwhile`, `hard-oil-flour-butter-as-verbs`,
`hard-beef-brown-sauce-head-noun`, `hard-split-butter-half-remaining-late`,
`hard-gerund-first-person-steps`, `hard-step-prefixes`, `hard-pronouns-and-drain`,
`hard-no-quantities-sear-roast`, `hard-zest-and-juice-verbs`, and
`clean-two-sections-uniform-spans`) were written from the reviewer's failure shapes and
general cooking prose, with expectations drawn by hand before running the mapper, and were not
tuned to pass. Their first run found one confident-wrong class (a trailing step that reuses an
ingredient was dropped into a bottom banner), which was fixed in the mapper; one miss stays as a
marked `known_miss` below 0.70. When adding a fixture, write the expectation first.

