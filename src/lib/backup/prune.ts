import type { BackupV1 } from './schema';

/**
 * Drop photo references whose file is not on disk, so a zip manifest never names a missing
 * file (T10). A photo whose full-size file is missing is omitted (positions renumbered, and if
 * it was the cover the first remaining photo becomes the cover); a missing thumbnail alone
 * becomes `thumb: null`. `photos_missing` counts the distinct missing files and is set only
 * when it is above zero, so a complete export stays byte-identical to the JSON export.
 */
export function omitMissingPhotos(doc: BackupV1, present: ReadonlySet<string>): BackupV1 {
  const missing = new Set<string>();
  const recipes = doc.recipes.map((r) => {
    let changed = false;
    const kept = [];
    let lostCover = false;
    for (const p of r.photos) {
      const fileOk = present.has(p.file);
      const thumbOk = p.thumb !== null && present.has(p.thumb);
      if (!fileOk) {
        missing.add(p.file);
        changed = true;
        if (p.is_cover) lostCover = true;
      }
      if (p.thumb !== null && !thumbOk) {
        missing.add(p.thumb);
        changed = true;
      }
      if (fileOk) kept.push({ ...p, thumb: thumbOk ? p.thumb : null });
    }
    if (!changed) return r;
    const photos = kept.map((p, i) => ({
      ...p,
      position: i,
      is_cover: p.is_cover || (lostCover && i === 0),
    }));
    return { ...r, photos };
  });
  if (missing.size === 0) return doc;
  return { ...doc, recipes, photos_missing: missing.size };
}
