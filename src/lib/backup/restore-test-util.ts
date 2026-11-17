// Test-only helpers for restore tests (not imported by app code).
import sharp from 'sharp';
import { migrateBackup } from './migrate';
import { parseBackupJson } from './parse';
import type { BackupV1 } from './schema';

/** A real, decodable image (the pipeline re-encodes whatever it gets). */
export function webp(width = 64, height = 48, color = '#c0392b'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .webp()
    .toBuffer();
}

/** Round a document through the same parse and migrate path as an upload. */
export function viaJson(doc: unknown): BackupV1 {
  const p = parseBackupJson(JSON.stringify(doc));
  if (!p.ok) throw new Error('parse');
  const m = migrateBackup(p.value);
  if (!m.ok) throw new Error(`migrate ${JSON.stringify(m)}`);
  return m.doc;
}

/** Everything that can differ between a source and a restored instance without being a bug. */
export function normalizeDoc(doc: BackupV1) {
  const strip = <T extends { created_at: string; updated_at: string }>(x: T) => ({
    ...x,
    created_at: '*',
    updated_at: '*',
  });
  return {
    ...doc,
    exported_at: '*',
    recipes: [...doc.recipes]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => ({
        ...strip(r),
        photos: r.photos.map((p) => ({ ...p, file: '*', thumb: p.thumb === null ? null : '*' })),
        notes: r.notes.map(strip),
        ratings: r.ratings.map(strip),
      })),
  };
}
