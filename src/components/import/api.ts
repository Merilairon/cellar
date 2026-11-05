import { classifyResponse, type Outcome } from './import-state';

/** POST /api/import. Resolves to null when the request was aborted. */
export async function requestImport(
  payload: { url: string } | { text: string },
  signal: AbortSignal,
): Promise<Outcome | null> {
  try {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const body: unknown = await res.json().catch(() => null);
    return classifyResponse(res.status, body, res.headers.get('Retry-After'));
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    return { ok: false, failure: { kind: 'network' } };
  }
}
