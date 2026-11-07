import { openDb } from '@/lib/db/connection';
import { runMigrations } from '@/lib/db/migrate';
import { user } from '@/lib/db/schema';
import {
  createRecipeFor,
  listRecipes,
  updateGridFor,
  updateRecipeFor,
} from '@/lib/recipes/service';

// C11 sanity timings, printed and never asserted (no gate): 1000 recipes x 15 ingredients x
// 3 tags in an in-memory database, then update, grid save and search on that volume.
// Usage: npx tsx scripts/perf-sanity.ts [recipeCount]. Developer-machine numbers only.
const N = Number(process.argv[2] ?? 1000);
const db = openDb(':memory:');
runMigrations(db);
const u = db
  .insert(user)
  .values({ email: 'perf@x.test', displayName: 'perf', passwordHash: 'h', role: 'member' })
  .returning()
  .get();

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
        display_primary: 'metric',
      })),
      steps: [{ kind: 'banner_top', label: 'prep', detail: `Do the thing ${i}.` }],
    },
  ],
});

const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(1);
  return `n=${s.length} median ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${s.at(-1)!.toFixed(1)} ms`;
};

const create: number[] = [];
const ids: { id: string; updated_at: string; sections: never[] }[] = [];
for (let i = 0; i < N; i++) {
  const t = process.hrtime.bigint();
  const r = createRecipeFor(db, u, body(i));
  create.push(ms(t));
  if (!r.ok) throw new Error(`create ${i} failed: ${r.status}`);
  ids.push(r.recipe as never);
}
console.log(`create (${N} recipes): ${stats(create)}`);

const probes = ids.filter((_, i) => i % Math.max(1, Math.floor(N / 50)) === 0);
const update: number[] = [];
const grid: number[] = [];
for (const r of probes) {
  let t = process.hrtime.bigint();
  const up = updateRecipeFor(db, u, r.id, { ...body(1), title: 'Renamed' });
  update.push(ms(t));
  if (!up.ok) throw new Error('update failed');
  t = process.hrtime.bigint();
  const g = updateGridFor(db, u, r.id, {
    base_updated_at: up.recipe.updated_at,
    sections: body(2).sections,
  });
  grid.push(ms(t));
  if (!g.ok) throw new Error(`grid failed: ${g.status}`);
}
console.log(`update at volume: ${stats(update)}`);
console.log(`grid save at volume: ${stats(grid)}`);

const search: number[] = [];
for (const q of ['ingredient', 'recipe 5', 'ingredient 7 of 3', 'renamed']) {
  const t = process.hrtime.bigint();
  const rows = listRecipes(db, u, { q });
  search.push(ms(t));
  console.log(`search "${q}": ${search.at(-1)!.toFixed(1)} ms, ${rows.length} rows`);
}
db.$client.close();
