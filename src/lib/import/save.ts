import type { Db } from '@/lib/db/connection';
import { getImportJobForUser, markImportJobSaved } from '@/lib/db/import-jobs';
import { insertRecipeTree } from '@/lib/db/recipes';
import { prepareRecipe, type Failure } from '@/lib/recipes/service';
import { normalizeTagList } from '@/lib/recipes/tag-name';
import type { RecipeTree } from '@/lib/db/recipes';
import { fetchAndStoreCover, type CoverDeps } from './cover';
import { sanitizeText } from './sanitize';
import { storedSourceUrl } from './source-url';
import { parseStoredDraft } from './service';
import { saveRequestSchema } from './schemas';

export type SaveResult =
  { ok: true; id: string; warnings: string[] } | Failure | { ok: false; status: 409 };

class AlreadySaved extends Error {}

const clean = (v: string | null | undefined, maxLen: number, multiline = false) =>
  v == null ? v : sanitizeText(v, { maxLen, multiline });

/** Server-side re-sanitize of every free-text field: a tampered draft is stored clean. */
function sanitizeTree(tree: RecipeTree): RecipeTree {
  return {
    tags: tree.tags, // already normalized by the schema; not free text
    fields: {
      ...tree.fields,
      title: sanitizeText(tree.fields.title, { maxLen: 200 }),
      description: clean(tree.fields.description, 5000, true),
      servingsLabel: clean(tree.fields.servingsLabel, 60),
      sourceName: clean(tree.fields.sourceName, 200),
    },
    sections: tree.sections.map((s) => ({
      title: clean(s.title, 120) ?? null,
      ingredients: s.ingredients.map((i) => ({
        ...i,
        name: sanitizeText(i.name, { maxLen: 200 }),
        note: clean(i.note, 300) ?? null,
        rawText: clean(i.rawText, 500) ?? '',
        metricUnit: clean(i.metricUnit, 20) ?? null,
        usUnit: clean(i.usUnit, 20) ?? null,
        portionLabel: clean(i.portionLabel, 60) ?? null,
        groupLabel: clean(i.groupLabel, 120) ?? null,
      })),
      steps: s.steps.map((t) => ({
        ...t,
        label: sanitizeText(t.label, { maxLen: 80 }),
        detail: sanitizeText(t.detail, { maxLen: 4000, multiline: true }),
      })),
    })),
  };
}

export type SaveDeps = CoverDeps;

/**
 * Persist the (possibly edited) draft of a job as a recipe. Recipe insert and job
 * `saved` flip share one transaction (compare-and-set): a double submit gives 409 and a
 * failing insert leaves the job `needs_review`.
 *
 * Cover ordering (deliberate): the cover is fetched AFTER the recipe is committed and is
 * best-effort. A cover failure never undoes or blocks the save; it only adds the
 * `cover_failed` warning. The cover URL comes from the stored draft, never from the request.
 */
export async function saveImport(
  db: Db,
  actor: { id: string; role: 'admin' | 'member' },
  jobId: string,
  body: unknown,
  deps: SaveDeps,
): Promise<SaveResult> {
  const job = getImportJobForUser(db, jobId, actor.id);
  if (!job) return { ok: false, status: 404 };
  if (job.status !== 'needs_review') return { ok: false, status: 409 };
  const stored = parseStoredDraft(job.draftJson);
  if (!stored) return { ok: false, status: 409 };

  const rawBody = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};
  const { import_cover: importCover, ...recipeBody } = rawBody as Record<string, unknown>;
  const opts = saveRequestSchema.safeParse({ import_cover: importCover });
  if (!opts.success) {
    return { ok: false, status: 422, errors: [{ path: 'import_cover', code: 'invalid' }] };
  }
  const prepared = prepareRecipe({
    ...recipeBody,
    // Tags: what the client sends wins (strictly validated, so tampering is a 422; `[]` means
    // none). Only when the key is absent do the stored draft's keywords/category apply; those
    // are leniently normalized because the user never typed them and cannot fix a bad one.
    tags: recipeBody.tags ?? normalizeTagList(stored.draft.tags ?? []),
    // Imported recipes open as a list unless the form explicitly chose otherwise.
    view_mode: recipeBody.view_mode ?? 'list',
  });
  if (!prepared.ok) return prepared;

  const tree = sanitizeTree(prepared.tree);
  // Stored URL is the canonical user-entered one with its scheme kept (G12, Q3); must be
  // http(s). An explicit empty or null `source_url` clears it; only a missing key falls back to
  // the draft's URL (then the job URL), so API clients that omit it keep v0.3.0 behaviour.
  const omitted = recipeBody.source_url === undefined;
  const suppliedUrl = omitted
    ? (stored.draft.source_url ?? job.url ?? null)
    : (tree.fields.sourceUrl ?? null);
  const sourceUrl = suppliedUrl ? storedSourceUrl(suppliedUrl) : null;
  if (suppliedUrl && !sourceUrl) {
    return { ok: false, status: 422, errors: [{ path: 'source_url', code: 'invalid_url' }] };
  }
  tree.fields.sourceUrl = sourceUrl;
  if (!tree.fields.sourceName && sourceUrl) {
    tree.fields.sourceName = new URL(sourceUrl).hostname.replace(/^www\./, '');
  }

  let recipeId: string;
  try {
    recipeId = db.transaction(
      (tx) => {
        const id = insertRecipeTree(tx, actor.id, tree);
        if (!markImportJobSaved(tx as unknown as Db, jobId, actor.id, id)) throw new AlreadySaved();
        return id;
      },
      { behavior: 'immediate' },
    );
  } catch (e) {
    if (e instanceof AlreadySaved) return { ok: false, status: 409 };
    throw e;
  }

  const warnings: string[] = [];
  const coverUrl = stored.draft.cover_image_url;
  if (opts.data.import_cover && coverUrl) {
    try {
      await fetchAndStoreCover(db, coverUrl, recipeId, deps);
    } catch (e) {
      console.warn('[import] cover failed:', e instanceof Error ? e.message : 'unknown');
      warnings.push('cover_failed');
    }
  }
  return { ok: true, id: recipeId, warnings };
}
