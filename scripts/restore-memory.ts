import { createWriteStream, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ulid } from 'ulid';
import { buildBackup } from '@/lib/backup/export';
import { migrateBackup } from '@/lib/backup/migrate';
import { parseBackupJson } from '@/lib/backup/parse';
import { applyRestore, previewRestore } from '@/lib/backup/restore';
import { openZip } from '@/lib/backup/unzip';
import { BACKUP_ENTRY, createZipStream, type ZipEntry } from '@/lib/backup/zip';
import { openDb } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { photo, user } from '@/lib/db/schema';
import { createRecipeFor } from '@/lib/recipes/service';

// T11 measurement, printed and never asserted: restore a ~200 MiB zip made of copies of one
// photo. The zip is written to disk first (as the stage route does), then the archive is opened
// by range reads and photos are read one entry at a time. Prints RSS before, after the zip is
// built, after staging validation, and the peak during apply.
// Usage: npx tsx scripts/restore-memory.ts [targetMiB] . Developer-machine numbers only.
const TARGET_MIB = Number(process.argv[2] ?? 200);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MiB`;
const rss = () => process.memoryUsage().rss;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'restore-memory-'));
  const uploads = join(dir, 'uploads');
  try {
    console.log(`rss at start: ${mb(rss())}`);
    const seed = await sharp({
      create: {
        width: 1400,
        height: 1000,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .webp({ quality: 80 })
      .toBuffer();
    const seedPath = join(dir, 'seed.webp');
    writeFileSync(seedPath, seed);
    const copies = Math.ceil((TARGET_MIB * 1024 * 1024) / seed.length);
    console.log(`seed photo: ${mb(seed.length)}, ${copies} copies`);

    // Source instance: one recipe per 8 photos, document built by the real exporter.
    const src = openDb(':memory:');
    runMigrations(src);
    const u = src
      .insert(user)
      .values({ email: 'm@x.test', displayName: 'm', passwordHash: 'h', role: 'member' })
      .returning()
      .get();
    const share = { baseUrl: '', publicLinksEnabled: false };
    const perRecipe = 8;
    const names: string[] = [];
    for (let r = 0; r * perRecipe < copies; r++) {
      const res = createRecipeFor(
        src,
        { id: u.id, role: 'member' },
        {
          title: `Memory ${r}`,
          sections: [{ title: null, ingredients: [{ name: 'x', raw_text: '1 x' }], steps: [] }],
        } as never,
        share,
      );
      if (!('recipe' in res)) throw new Error('fixture failed');
      const rid = (res as { recipe: { id: string } }).recipe.id;
      for (let i = 0; i < perRecipe && names.length < copies; i++) {
        const file = `${ulid()}.webp`;
        names.push(file);
        src
          .insert(photo)
          .values({
            recipeId: rid,
            filePath: file,
            thumbPath: null,
            width: 1400,
            height: 1000,
            position: i,
            isCover: i === 0,
          })
          .run();
      }
    }
    const doc = buildBackup(src, { id: u.id, role: 'member' }, { all: false });
    const entries: ZipEntry[] = [
      { name: BACKUP_ENTRY, data: Buffer.from(JSON.stringify(doc)) },
      ...names.map((n) => ({ name: `photos/${n}`, path: seedPath, size: seed.length })),
    ];
    const zipPath = join(dir, 'backup.zip');
    await pipeline(Readable.fromWeb(createZipStream(entries) as never), createWriteStream(zipPath));
    console.log(
      `zip on disk: ${mb(statSync(zipPath).size)}, ${entries.length} entries, rss ${mb(rss())}`,
    );
    src.$client.close();

    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, rss())), 25);
    const t0 = Date.now();
    const zip = await openZip(zipPath);
    const parsed = parseBackupJson((await zip.read(BACKUP_ENTRY)).toString('utf8'));
    if (!parsed.ok) throw new Error('parse');
    const migrated = migrateBackup(parsed.value);
    if (!migrated.ok) throw new Error('migrate');
    console.log(`after staging validation: rss ${mb(rss())}`);

    const dst = openDb(':memory:');
    runMigrations(dst);
    const actor = dst
      .insert(user)
      .values({ email: 'd@x.test', displayName: 'd', passwordHash: 'h', role: 'member' })
      .returning()
      .get();
    const preview = previewRestore(dst, { id: actor.id, role: 'member' }, migrated.doc, zip);
    console.log(`preview: ${preview.recipes} recipes, ${preview.photos} photos`);
    const result = await applyRestore(
      dst,
      { id: actor.id, role: 'member' },
      migrated.doc,
      zip,
      'skip',
      uploads,
    );
    await zip.close();
    clearInterval(timer);
    peak = Math.max(peak, rss());
    console.log(`apply: ${JSON.stringify(result)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    console.log(`peak rss during stage + apply: ${mb(peak)}; rss at end: ${mb(rss())}`);
    dst.$client.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
