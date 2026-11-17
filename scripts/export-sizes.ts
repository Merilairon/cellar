import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildBackup, listBackupFiles } from '@/lib/backup/export';
import { createZipStream, type ZipEntry } from '@/lib/backup/zip';
import { addPhotos } from '@/lib/backup/test-fixtures';
import { openDb } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';
import { createRecipeFor } from '@/lib/recipes/service';

// T10 measurements, printed and never asserted. 1000 recipes: JSON bytes and build time.
// Then a 200-photo zip (full + thumb, 150 KiB each): RSS before, peak while streaming, after.
// Usage: npx tsx scripts/export-sizes.ts [recipeCount] [photoCount]. Developer-machine numbers only.
const N = Number(process.argv[2] ?? 1000);
const P = Number(process.argv[3] ?? 200);
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MiB`;

const db = openDb(':memory:');
runMigrations(db);
const u = db
  .insert(user)
  .values({ email: 'sizes@x.test', displayName: 'sizes', passwordHash: 'h', role: 'member' })
  .returning()
  .get();
const share = { baseUrl: '', publicLinksEnabled: false };
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const r = createRecipeFor(
    db,
    u,
    {
      title: `Size recipe ${i}`,
      servings: 4,
      tags: [`tag${i % 20}`, `group${i % 7}`],
      sections: [
        {
          title: null,
          ingredients: Array.from({ length: 15 }, (_, k) => ({
            name: `ingredient ${k} of ${i % 50}`,
            metric_qty: k + 1,
            metric_unit: 'g',
            display_primary: 'metric',
          })),
          steps: [{ kind: 'banner_top', label: 'prep', detail: `Do the thing ${i}.` }],
        },
      ],
    },
    share,
  );
  if (!r.ok) throw new Error('fixture failed');
  ids.push(r.recipe.id);
}

const t0 = performance.now();
const doc = buildBackup(db, { id: u.id, role: 'member' }, { all: false });
const json = JSON.stringify(doc);
const ms = performance.now() - t0;
console.log(
  `${N} recipes: JSON ${json.length} bytes (${mb(json.length)}), build+stringify ${ms.toFixed(0)} ms`,
);

async function zipRun() {
  // Photos: P/2 rows with a file and a thumb each would be P files; use P rows of file+thumb = 2P files.
  const dir = mkdtempSync(join(tmpdir(), 'export-sizes-'));
  try {
    for (let i = 0; i < P; i++) addPhotos(db, ids[i % ids.length], 1);
    const withPhotos = buildBackup(db, { id: u.id, role: 'member' }, { all: false });
    const files = listBackupFiles(withPhotos);
    const blob = randomBytes(150 * 1024);
    const entries: ZipEntry[] = [
      { name: 'backup.json', data: Buffer.from(JSON.stringify(withPhotos)) },
    ];
    for (const rel of files) {
      const abs = join(dir, rel.slice('photos/'.length));
      writeFileSync(abs, blob);
      entries.push({ name: rel, path: abs, size: blob.length });
    }
    global.gc?.();
    const before = process.memoryUsage().rss;
    let peak = before;
    let bytes = 0;
    const z0 = performance.now();
    const reader = createZipStream(entries).getReader();
    for (let n = 0; ; n++) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (n % 50 === 0) peak = Math.max(peak, process.memoryUsage().rss);
    }
    const after = process.memoryUsage().rss;
    console.log(
      `zip: ${files.length} photo files, ${bytes} bytes (${mb(bytes)}), ${(performance.now() - z0).toFixed(0)} ms`,
    );
    console.log(`RSS before ${mb(before)}, peak sampled ${mb(peak)}, after ${mb(after)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

zipRun().catch((e) => {
  console.error(e);
  process.exit(1);
});
