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
  "confidence": { "min": 0.7 }
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
- **hard**: ambiguity, group references, unresolved splits and similar. Reported, not gated,
  except that none may be wrong with confidence >= 0.70.
- **negative**: degenerate inputs that must end as `list` or `none`.
