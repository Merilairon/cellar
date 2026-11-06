// Docker HEALTHCHECK: exits 0 only if /healthz answers 200. No shell tools needed.
const port = process.env.PORT || '3001';
try {
  const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
  process.exit(r.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
