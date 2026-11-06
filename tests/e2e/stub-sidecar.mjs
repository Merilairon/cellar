// Stub of the headless sidecar (docker/browser) for the e2e "headless on" scenarios. It speaks the
// same wire contract as the real one (POST /render {url} -> 200 {html, finalUrl, status} or an
// error {error}) but never opens a browser; the real browser is covered by docker/browser tests
// and the CI `headless` job. The spec drives it through a control surface:
//   PUT    /__rules   {"<url>": {html?, status?, error?, delayMs?}}   canned response per entered URL
//   GET    /__calls   -> string[] of URLs rendered since the last reset
//   DELETE /__rules   clears rules and calls
// Unknown URLs get {error:'failed'} (the app maps that to headless_unavailable).
import { createServer } from 'node:http';

const port = Number(process.env.STUB_SIDECAR_PORT ?? 3199);
let rules = {};
let calls = [];

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  });

createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/healthz') return json(res, 200, { ok: true });
  if (path === '/__calls' && req.method === 'GET') return json(res, 200, calls);
  if (path === '/__rules' && req.method === 'DELETE') {
    rules = {};
    calls = [];
    return json(res, 200, {});
  }
  if (path === '/__rules' && req.method === 'PUT') {
    rules = JSON.parse(await readBody(req));
    return json(res, 200, {});
  }
  if (path === '/render' && req.method === 'POST') {
    const { url } = JSON.parse(await readBody(req));
    calls.push(url);
    const rule = rules[url];
    if (!rule) return json(res, 500, { error: 'failed' });
    if (rule.delayMs) await new Promise((ok) => setTimeout(ok, rule.delayMs));
    if (rule.error) return json(res, rule.error === 'timeout' ? 504 : 502, { error: rule.error });
    return json(res, 200, { html: rule.html, finalUrl: url, status: rule.status ?? 200 });
  }
  json(res, 404, { error: 'failed' });
}).listen(port, '127.0.0.1');
