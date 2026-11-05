export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getDb } = await import('@/lib/db');
  const { runMigrations, assertFts5Available } = await import('@/lib/db/migrate');
  const db = getDb();
  runMigrations(db);
  assertFts5Available(db);
}
