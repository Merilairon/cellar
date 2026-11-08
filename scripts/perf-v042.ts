import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { openDb } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';
import { insertNote } from '@/lib/db/notes';
import { upsertRating } from '@/lib/db/ratings';
import { insertPhoto } from '@/lib/db/photos';
import { createRecipeFor, listRecipes, updateGridFor } from '@/lib/recipes/service';
import { processImage } from '@/lib/images/process';

// v0.4.2 T14 measurements. Printed, never asserted. Developer-machine numbers unless run inside a
// constrained container/cgroup (see docs). Usage:
//   npx tsx scripts/perf-v042.ts db <dir> <recipeCount>
//   npx tsx scripts/perf-v042.ts grid <dir> [runs]           (maximal 20x200 grid save on an existing db; run under a memory limit for RSS)
//   npx tsx scripts/perf-v042.ts mkimg <dir>                 (writes synthetic 12MP and 48MP jpegs)
//   npx tsx scripts/perf-v042.ts img <file> [runs] [capPixels] [thumbEdge]   (one process = one RSS)
const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
const ms = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6;
const q = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const stats = (xs: number[]) =>
  `n=${xs.length} median ${q(xs, 0.5).toFixed(2)} p95 ${q(xs, 0.95).toFixed(2)} min ${Math.min(...xs).toFixed(2)} max ${Math.max(...xs).toFixed(2)} ms`;

void (async () => {
  if (cmd === 'db') runDb(a1!, Number(a2 ?? 1000));
  else if (cmd === 'grid') runGrid(a1!, Number(a2 ?? 5));
  else if (cmd === 'mkimg') await mkimg(a1!);
  else if (cmd === 'img') await runImg(a1!, Number(a2 ?? 5), Number(a3 ?? 0), Number(a4 ?? 400));
  else throw new Error('usage: db|mkimg|img');
})();

function runDb(dir: string, N: number) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, 'perf.db'));
  runMigrations(db);
  const mk = (n: string) =>
    db
      .insert(user)
      .values({ email: `${n}@x.test`, displayName: n, passwordHash: 'h', role: 'member' })
      .returning()
      .get();
  const me = mk('me');
  const other = mk('other');
  const body = (i: number) => ({
    title: `Perf recipe ${i}`,
    servings: 4,
    tags: [`tag${i % 20}`, `group${i % 7}`, 'perf'],
    sections: [
      {
        title: null,
        ingredients: Array.from({ length: 15 }, (_, k) => ({
          name: `ingredient ${k} of ${i % 50}`,
          metric_qty: k + 1,
          metric_unit: 'g',
          display_primary: 'metric' as const,
        })),
        steps: [{ kind: 'banner_top' as const, label: 'prep', detail: `Do the thing ${i}.` }],
      },
    ],
  });
  const guard = () => 'ok' as const;
  const create: number[] = [],
    noteIns: number[] = [],
    rate: number[] = [],
    photoIns: number[] = [];
  const recs: { id: string; updated_at: string }[] = [];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    let t = process.hrtime.bigint();
    const r = createRecipeFor(db, me, body(i));
    create.push(ms(t));
    if (!r.ok) throw new Error('create');
    recs.push(r.recipe as never);
    const id = r.recipe.id;
    // 3 notes per recipe: own private, own shared, other's shared. Other's private on every 10th.
    // 'ladle' appears in every note; 'zqprivx' only in other's private notes (side-channel probe).
    const body1 = `Used less salt, my own tweak ladle ${i}. Remember to double the garlic next time and rest the dough.`;
    t = process.hrtime.bigint();
    insertNote(db, id, me, { body: body1, shared: false }, guard);
    insertNote(
      db,
      id,
      me,
      { body: `Shared tip ladle ${i}: serve with rice and a squeeze of lime.`, shared: true },
      guard,
    );
    insertNote(
      db,
      id,
      other,
      { body: `Other shared ladle ${i}: kids loved it, bake 5 minutes longer.`, shared: true },
      guard,
    );
    noteIns.push(ms(t) / 3);
    if (i % 10 === 0)
      insertNote(
        db,
        id,
        other,
        { body: `zqprivx secret ladle ${i} comment`, shared: false },
        guard,
      );
    t = process.hrtime.bigint();
    upsertRating(db, id, me.id, 1 + (i % 5), guard);
    upsertRating(db, id, other.id, 1 + ((i + 2) % 5), guard);
    rate.push(ms(t) / 2);
    t = process.hrtime.bigint();
    insertPhoto(db, id, {
      filePath: `f${i}.webp`,
      thumbPath: `t${i}.webp`,
      width: 1600,
      height: 1200,
    });
    if (i % 2 === 0)
      insertPhoto(db, id, {
        filePath: `g${i}.webp`,
        thumbPath: `u${i}.webp`,
        width: 1600,
        height: 1200,
      });
    photoIns.push(ms(t));
  }
  console.log(`N=${N} seeded in ${(ms(t0) / 1000).toFixed(1)} s`);
  console.log(`create recipe: ${stats(create)}`);
  console.log(`insert note (per note, incl. note_fts trigger, guard txn): ${stats(noteIns)}`);
  console.log(`upsert rating (per rating): ${stats(rate)}`);
  console.log(`insert photo row(s) per recipe: ${stats(photoIns)}`);

  // Trigger cost in isolation: raw INSERT into note with the three note_fts triggers vs without.
  const c = db.$client;
  const raw = (label: string) => {
    const ins = c.prepare(
      `insert into note (id, recipe_id, user_id, body, shared, created_at, updated_at) values (?, ?, ?, ?, 1, 'x', 'x')`,
    );
    const ts: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = process.hrtime.bigint();
      ins.run(
        `${label}${i}`,
        recs[i % recs.length]!.id,
        me.id,
        `raw ${label} body ladle ${i} some words here`,
      );
      ts.push(ms(t));
    }
    return ts;
  };
  const withTrig = raw('wt');
  c.exec('drop trigger note_fts_note_ai');
  const noTrig = raw('nt');
  console.log(`raw note insert WITH note_fts trigger: ${stats(withTrig)}`);
  console.log(`raw note insert WITHOUT trigger:       ${stats(noTrig)}`);
  c.prepare(`delete from note where id like 'wt%' or id like 'nt%'`).run(); // ad trigger cleans note_fts
  c.exec("delete from note_fts where note_id like 'nt%'");
  c.exec(`CREATE TRIGGER note_fts_note_ai AFTER INSERT ON note BEGIN
    DELETE FROM note_fts WHERE note_id = new.id;
    INSERT INTO note_fts (note_id, recipe_id, body) VALUES (new.id, new.recipe_id, new.body); END;`);
  const cnt = (s: string) => (c.prepare(s).get() as { n: number }).n;
  console.log(
    `rows: recipe ${cnt('select count(*) n from recipe')}, note ${cnt('select count(*) n from note')}, note_fts ${cnt('select count(*) n from note_fts')}, rating ${cnt('select count(*) n from rating')}, photo ${cnt('select count(*) n from photo')}`,
  );
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.exec('vacuum');

  // Search. Warm up, then 300 reps each, interleaved A/B for the side-channel pairs.
  const run = (term: string, who = me) => {
    const t = process.hrtime.bigint();
    const rows = listRecipes(db, who, { q: term });
    return [ms(t), rows.length] as const;
  };
  const rep = N > 2000 ? 20 : N > 500 ? 100 : 300;
  const pairs = N > 2000 ? 40 : N > 500 ? 200 : 300;
  const bench = (label: string, term: string, who = me, reps = rep) => {
    for (let i = 0; i < Math.min(20, reps); i++) run(term, who);
    const ts: number[] = [];
    let n = 0;
    for (let i = 0; i < reps; i++) {
      const [t, k] = run(term, who);
      ts.push(t);
      n = k;
    }
    console.log(`search ${label} "${term}" rows=${n}: ${stats(ts)}`);
    return ts;
  };
  bench(
    'recipe-only (matches every recipe)',
    'ingredient 7 of 3',
    me,
    N > 2000 ? 3 : N > 500 ? 10 : rep,
  );
  bench('shared-note hit (all recipes)', 'ladle');
  bench('own private note hit', 'tweak');
  // C4 side channel: caller 'me' searching a token that exists only in OTHER's PRIVATE notes
  // (N/10 hits in note_fts, all filtered out) vs a token that exists nowhere.
  const A: number[] = [],
    B: number[] = [];
  for (let i = 0; i < 20; i++) {
    run('zqprivx');
    run('zqabsnt');
  }
  for (let i = 0; i < pairs * 2; i++) {
    if (i % 2) {
      A.push(run('zqprivx')[0]);
      B.push(run('zqabsnt')[0]);
    } else {
      B.push(run('zqabsnt')[0]);
      A.push(run('zqprivx')[0]);
    }
  }
  console.log(`C4 other's-private-only token (filtered to 0 rows): ${stats(A)}`);
  console.log(`C4 token that matches nothing:                       ${stats(B)}`);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const sd = (x: number[]) => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)));
  console.log(
    `C4 mean A ${mean(A).toFixed(3)} ms vs B ${mean(B).toFixed(3)} ms, delta ${(mean(A) - mean(B)).toFixed(3)} ms, sd A ${sd(A).toFixed(3)} B ${sd(B).toFixed(3)}`,
  );
  // Same-owner control: me searching own-private token (matches => rows) for comparison
  const O: number[] = [];
  for (let i = 0; i < rep; i++) O.push(run('zqprivx', other)[0]);
  console.log(`C4 control: author searching their own private token: ${stats(O)}`);
  bench('list no q', '');
  // Maximal grid save: 20 sections x 200 ingredients on a recipe that has notes/ratings/photos.
  const ing = Array.from({ length: 200 }, (_, i) => ({
    name: `ingredient number ${i}`,
    note: 'finely chopped',
    display_primary: 'metric' as const,
    metric_qty: 100,
    metric_unit: 'g',
  }));
  const gs: number[] = [];
  let base = recs[0]!.updated_at;
  for (let i = 0; i < 7; i++) {
    const t = process.hrtime.bigint();
    const g = updateGridFor(db, me, recs[0]!.id, {
      base_updated_at: base,
      sections: Array.from({ length: 20 }, (_, k) => ({
        title: `S${k}`,
        ingredients: ing,
        steps: [],
      })),
    });
    gs.push(ms(t));
    if (!g.ok) throw new Error(`grid ${g.status}`);
    base = g.recipe.updated_at;
  }
  console.log(
    `maximal grid save 20x200 (first is cold; ${JSON.stringify({ base_updated_at: base, sections: [] }).length} B+rows): ${gs.map((x) => x.toFixed(0)).join(', ')} ms; warm median ${q(gs.slice(1), 0.5).toFixed(0)}`,
  );
  const plain: number[] = [];
  for (let i = 1; i < 40; i++) {
    const t = process.hrtime.bigint();
    const g = updateGridFor(db, me, recs[i]!.id, {
      base_updated_at: recs[i]!.updated_at,
      sections: body(1).sections,
    });
    plain.push(ms(t));
    if (!g.ok) throw new Error('grid');
  }
  console.log(`typical grid save (15 ingredients): ${stats(plain)}`);
  const n = cnt('select count(*) n from note');
  console.log(
    `after grid saves: notes ${n}, photos ${cnt('select count(*) n from photo')}, ratings ${cnt('select count(*) n from rating')} (unchanged by grid save)`,
  );
  // Calibration: the same maximal save on a fresh :memory: db without notes (compares to the 657 ms of v0.4.1).
  {
    const m = openDb(':memory:');
    runMigrations(m);
    const mu = m
      .insert(user)
      .values({ email: 'm@x.test', displayName: 'm', passwordHash: 'h', role: 'member' })
      .returning()
      .get();
    const r = createRecipeFor(m, mu, body(0));
    if (!r.ok) throw new Error('cal');
    let b = r.recipe.updated_at;
    const cal: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = process.hrtime.bigint();
      const g = updateGridFor(m, mu, r.recipe.id, {
        base_updated_at: b,
        sections: Array.from({ length: 20 }, (_, k) => ({
          title: `S${k}`,
          ingredients: ing,
          steps: [],
        })),
      });
      cal.push(ms(t));
      if (!g.ok) throw new Error('cal');
      b = g.recipe.updated_at;
    }
    console.log(
      `calibration maximal grid save, :memory:, empty db: ${cal.map((x) => x.toFixed(0)).join(', ')} ms`,
    );
  }
  db.$client.close();
  console.log(`db file sizes: ${execFileSync('du', ['-sh', dir]).toString().trim()}`);
}

async function mkimg(dir: string) {
  mkdirSync(dir, { recursive: true });
  // Photo-like synthetic: smooth gradient + blurred noise "texture" + fine noise; real-ish jpeg size.
  const make = async (w: number, h: number, file: string) => {
    const small = await sharp({
      create: {
        width: Math.round(w / 8),
        height: Math.round(h / 8),
        channels: 3,
        background: 0,
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .resize(w, h, { kernel: 'cubic' })
      .blur(2)
      .png({ compressionLevel: 0 })
      .toBuffer();
    const fine = await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: 0,
        noise: { type: 'gaussian', mean: 128, sigma: 12 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const img = sharp(small)
      .composite([{ input: fine, blend: 'soft-light' }])
      .jpeg({ quality: 85 });
    writeFileSync(join(dir, file), await img.toBuffer());
  };
  await make(4000, 3000, 'jpeg-12mp.jpg');
  await make(4608, 3456, 'jpeg-16mp.jpg');
  await make(8000, 6000, 'jpeg-48mp.jpg');
  await make(8660, 5774, 'jpeg-50mp.jpg');
}

async function runImg(file: string, runs: number, cap: number, thumbEdge: number) {
  const bytes = new Uint8Array(readFileSync(file));
  const ts: number[] = [];
  let sizes = '';
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    if (cap === 0 && thumbEdge === 400) {
      const r = await processImage(bytes, { allowed: ['jpeg', 'png', 'webp'] });
      if (!r.ok) {
        console.log(`REJECTED ${r.reason} in ${ms(t).toFixed(0)} ms`);
        return;
      }
      sizes = `main ${r.main.width}x${r.main.height} ${r.main.data.length} B, thumb ${r.thumb.width}x${r.thumb.height} ${r.thumb.data.length} B`;
    } else {
      // Replica of processImage with an overridable pixel cap and thumb edge (same sharp options).
      sharp.concurrency(1);
      sharp.cache(false);
      const input = sharp(bytes, {
        limitInputPixels: cap || 16_000_000,
        failOn: 'error',
        sequentialRead: true,
      });
      const { data: raw, info } = await input
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const o = { raw: { width: info.width, height: info.height, channels: info.channels } };
      const main = await sharp(raw, o).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      const th = await sharp(raw, o)
        .resize({ width: thumbEdge, height: thumbEdge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      sizes = `main ${main.info.width}x${main.info.height} ${main.data.length} B, thumb ${th.info.width}x${th.info.height} ${th.data.length} B (replica, cap ${cap}, thumb edge ${thumbEdge})`;
    }
    ts.push(ms(t));
  }
  console.log(
    `${file}: ${stats(ts)} | ${sizes} | in ${bytes.length} B | node rss now ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`,
  );
}

function runGrid(dir: string, runs: number) {
  const db = openDb(join(dir, 'perf.db'));
  const me = db.$client.prepare("select id, role from user where display_name = 'me'").get() as {
    id: string;
    role: 'member';
  };
  const rec = db.$client
    .prepare('select id, updated_at from recipe where owner_id = ? limit 1')
    .get(me.id) as { id: string; updated_at: string };
  const ing = Array.from({ length: 200 }, (_, i) => ({
    name: `ingredient number ${i}`,
    note: 'finely chopped',
    display_primary: 'metric' as const,
    metric_qty: 100,
    metric_unit: 'g',
  }));
  let base = rec.updated_at;
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    const g = updateGridFor(db, me, rec.id, {
      base_updated_at: base,
      sections: Array.from({ length: 20 }, (_, k) => ({
        title: `S${k}`,
        ingredients: ing,
        steps: [],
      })),
    });
    ts.push(ms(t));
    if (!g.ok) throw new Error(`grid ${g.status}`);
    base = g.recipe.updated_at;
  }
  console.log(
    `maximal grid save 20x200: ${ts.map((x) => x.toFixed(0)).join(', ')} ms; rss now ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`,
  );
}
