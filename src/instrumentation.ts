const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getDb } = await import('@/lib/db');
  const { runMigrations, assertFts5Available } = await import('@/lib/db/migrate');
  const { cleanupExpiredSessions } = await import('@/lib/auth/session');
  const db = getDb();
  runMigrations(db);
  assertFts5Available(db);

  // Drop expired session rows now and hourly; unref so it never keeps the process alive.
  const sweep = () => {
    try {
      cleanupExpiredSessions(db);
    } catch (err) {
      console.error('expired-session cleanup failed', err);
    }
  };
  sweep();
  setInterval(sweep, CLEANUP_INTERVAL_MS).unref();
}
