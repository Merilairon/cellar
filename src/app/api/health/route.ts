import { getDb } from '@/lib/db';
import { dbHealthy } from '@/lib/db/health';

export const dynamic = 'force-dynamic';

// Public (allow-listed in the proxy gate). Reveals no version, config or secrets.
export function GET() {
  let ok = false;
  try {
    ok = dbHealthy(getDb());
  } catch {
    ok = false;
  }
  return Response.json({ status: ok ? 'ok' : 'error' }, { status: ok ? 200 : 503 });
}
