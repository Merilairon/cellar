import type { RecipeTree } from '@/lib/db/recipes';
import type { BackupRecipe, BackupV1 } from './schema';

// Backup recipe -> `insertRecipeTree` input. Pure. Used by the round-trip test and by restore
// (T11). Ids, owner and stamps are NOT carried: `insertRecipeTree` assigns fresh ids and
// `now` stamps (the file's stamps stay data in the document), and the caller supplies the
// owner. `split_group_key` becomes `splitGroupId`, which the insert remaps to fresh ULIDs.
// The document must already have passed `migrateBackup`; grid span ranges against the
// ingredient count are still `validateRecipeGrid`'s job at restore.

export function backupRecipeToTree(r: BackupRecipe): RecipeTree {
  return {
    fields: {
      title: r.title,
      description: r.description,
      servings: r.servings,
      servingsLabel: r.servings_label,
      prepMinutes: r.prep_minutes,
      cookMinutes: r.cook_minutes,
      sourceUrl: r.source_url,
      sourceName: r.source_name,
      visibility: r.visibility,
      viewMode: r.view_mode,
    },
    tags: r.tags,
    sections: r.sections.map((s) => ({
      title: s.title,
      ingredients: s.ingredients.map((i) => ({
        name: i.name,
        note: i.note,
        rawText: i.raw_text,
        metricQty: i.metric_qty,
        metricQtyMax: i.metric_qty_max,
        metricUnit: i.metric_unit,
        usQty: i.us_qty,
        usQtyMax: i.us_qty_max,
        usUnit: i.us_unit,
        displayPrimary: i.display_primary,
        splitGroupId: i.split_group_key,
        portionLabel: i.portion_label,
        groupLabel: i.group_label,
      })),
      steps: s.steps.map((st) => ({
        kind: st.kind,
        label: st.label,
        detail: st.detail,
        rowStart: st.row_start,
        rowEnd: st.row_end,
        tempC: st.temp_c,
        tempF: st.temp_f,
        minutesMin: st.minutes_min,
        minutesMax: st.minutes_max,
      })),
    })),
  };
}

export function toTrees(doc: BackupV1): RecipeTree[] {
  return doc.recipes.map(backupRecipeToTree);
}
