// DOCKER / REAL-CHROMIUM TESTS (T3, T4; the T9 cases that need a browser).
// Skipped unless BROWSER_DOCKER_TESTS=1, because they need Chromium with its sandbox working,
// i.e. the sidecar image run with the hardened flags (docker/browser/run.sh). Run them with:
// (the harness shares the container's memory, so give it more than the production limit:
// 1 GB makes the 6 MB DOM case flaky)
//   docker/browser/run.sh --memory 2g --memory-swap 2g -v "$PWD/docker/browser/test:/srv/test:ro" -e BROWSER_DOCKER_TESTS=1 \
//     -e HEADLESS_ALLOW_NO_TOKEN=1 --entrypoint node cellar-browser:t3 --test test/render.docker.test.ts
// Targets are local fixtures only. The "public" alias is 127.0.0.2, allowed by the test-only
// override object injected below; the production entrypoint never builds that object.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Supervisor } from '../src/supervisor.ts';
import { loadConfig } from '../src/config.ts';
import { RenderError } from '../src/server.ts';
import type { Addr } from '../src/proxy.ts';

const ON = process.env.BROWSER_DOCKER_TESTS === '1';
const opts = {
  skip: ON ? false : 'needs real Chromium (set BROWSER_DOCKER_TESTS=1, run in the image)',
};

let protectedConn = 0; // connections to the protected loopback listener
let protectedServer: net.Server;
let pub: http.Server;
let pubPort = 0;
let protPort = 0;
let sup: Supervisor;
const resolverCalls = new Map<string, number>();
let chainMax = 0;
let okHits = 0;

const NAMES: Record<string, string> = { 'public.test': '127.0.0.2' };
const resolve = async (host: string): Promise<Addr[]> => {
  resolverCalls.set(host, (resolverCalls.get(host) ?? 0) + 1);
  if (host === 'rebind.test') {
    return [{ address: resolverCalls.get(host) === 1 ? '127.0.0.2' : '127.0.0.1', family: 4 }];
  }
  if (host === 'mixed.test') {
    return [
      { address: '127.0.0.2', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ];
  }
  if (host === 'toprivate.test') return [{ address: '127.0.0.1', family: 4 }];
  const a = NAMES[host];
  if (!a) throw new Error('NXDOMAIN');
  return [{ address: a, family: 4 }];
};

const html = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? '/', 'http://x');
  const send = (body: string, type = 'text/html', extra: Record<string, string> = {}) => {
    res.writeHead(200, { 'content-type': type, ...extra });
    res.end(body);
  };
  switch (u.pathname) {
    case '/ok':
      okHits++;
      return send(
        html(
          '<div id=a></div><script>document.getElementById("a").textContent="rendered-by-js"</script>',
        ),
      );
    case '/redir':
      res.writeHead(302, { location: u.searchParams.get('to') ?? '/' });
      return res.end();
    case '/sub': {
      const t = (u.searchParams.get('t') ?? '').split(',');
      const tags = t
        .map(
          (x) =>
            `<img src="${x}/i"><script src="${x}/s"></script><link rel=stylesheet href="${x}/c"><iframe src="${x}/f"></iframe><link rel=preconnect href="${x}"><video src="${x}/v"></video>`,
        )
        .join('');
      const js = t
        .map(
          (x) =>
            `fetch("${x}/x").catch(()=>{});var r=new XMLHttpRequest();r.open("GET","${x}/y");r.send();navigator.sendBeacon("${x}/b","z");try{new WebSocket("${x.replace('http', 'ws')}/w")}catch(e){};try{new EventSource("${x}/e")}catch(e){};`,
        )
        .join('');
      return send(html(`<p id=still>page still renders</p>${tags}<script>${js}</script>`));
    }
    case '/js-redirect':
      return send(
        html(`<script>location.href=${JSON.stringify(u.searchParams.get('to'))}</script>`),
      );
    case '/meta-redirect':
      return send(
        html('', `<meta http-equiv=refresh content="0;url=${u.searchParams.get('to')}">`),
      );
    case '/hang':
      return void res.writeHead(200, { 'content-type': 'text/html' }).write('<html><body>partial');
    case '/spin':
      return send(html('<script>while(true){}</script>'));
    case '/chain':
      chainMax = Math.max(chainMax, Number(u.searchParams.get('n') ?? 0));
      res.writeHead(302, { location: `/chain?n=${Number(u.searchParams.get('n') ?? 0) + 1}` });
      return res.end();
    case '/many': {
      const js = 'for(var i=0;i<1000;i++){fetch("/p?i="+i).catch(function(){})}';
      return send(html(`<script>${js}</script>`));
    }
    case '/p':
      return send('x', 'text/plain');
    case '/attach':
      return send(html('<p>no</p>'), 'text/html', {
        'content-disposition': 'attachment; filename=a.html',
      });
    case '/zip':
      return send('PK\u0003\u0004', 'application/zip');
    case '/dl-click':
      return send(
        html(
          '<a id=l href="/zip" download="x.zip">d</a><script>document.getElementById("l").click()</script>',
        ),
      );
    case '/set-state':
      return send(
        html(
          '<script>document.cookie="s=1";localStorage.k="v";sessionStorage.k="v";indexedDB.open("db").onsuccess=function(e){};try{navigator.serviceWorker.register("/sw.js")}catch(e){}</script>',
        ),
      );
    case '/read-state':
      return send(
        html(
          '<pre id=o></pre><script>document.getElementById("o").textContent=JSON.stringify({c:document.cookie,l:localStorage.k||null,s:sessionStorage.k||null})</script>',
        ),
      );
    case '/files':
      return send(
        html(
          `<iframe src="file:///etc/passwd"></iframe><script>fetch("file:///etc/passwd").catch(function(){});window.open("file:///etc/passwd")</script>`,
        ),
      );
    case '/popup-dialog':
      return send(
        html(
          '<script>window.open("/ok");alert("a");confirm("c");prompt("p");window.onbeforeunload=function(){return "x"}</script><p id=alive>alive</p>',
        ),
      );
    case '/big':
      return send(html('x'.repeat(6 * 1024 * 1024)));
    case '/loop':
      return send(
        html(
          `<script>fetch("http://127.0.0.1:${u.searchParams.get('p')}/render",{method:"POST"}).catch(function(){});fetch("http://localhost:${u.searchParams.get('p')}/").catch(function(){});fetch("http://[::1]:${u.searchParams.get('p')}/").catch(function(){})</script>`,
        ),
      );
    default:
      res.writeHead(404);
      res.end();
  }
}

const url = (p: string) => `http://public.test:${pubPort}${p}`;
const prot = () => `http://127.0.0.1:${protPort}`;
const tmpFiles = () => readdirSync('/tmp').sort().join(',');

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof RenderError ? e.code : `other:${String(e)}`;
  }
}

before(async () => {
  if (!ON) return;
  protectedServer = net.createServer((s) => {
    protectedConn++;
    s.on('error', () => {});
    s.end('HTTP/1.1 200 OK\r\nContent-Length: 6\r\nContent-Type: text/html\r\n\r\nSECRET');
  });
  await new Promise<void>((r) => protectedServer.listen(0, '127.0.0.1', r));
  protPort = (protectedServer.address() as AddressInfo).port;
  pub = http.createServer(handler);
  await new Promise<void>((r) => pub.listen(0, '127.0.0.2', r));
  pubPort = (pub.address() as AddressInfo).port;
  sup = new Supervisor(loadConfig({ HEADLESS_ALLOW_NO_TOKEN: '1', RENDER_TIMEOUT_MS: '5000' }), {
    resolve,
    testOverrides: {
      allowAddress: (ip) => ip === '127.0.0.2',
      allowPorts: [pubPort, protPort],
    },
  });
});
after(async () => {
  if (!ON) return;
  await sup.shutdown();
  pub.closeAllConnections();
  pub.close();
  protectedServer.close();
});

test('baseline: JS-rendered DOM is returned', opts, async () => {
  const r = await sup.render({ url: url('/ok') });
  assert.match(r.html, /rendered-by-js/);
  assert.equal(r.status, 200);
  assert.equal(sup.openContexts(), 0);
});

test(
  'C1: redirects to loopback, metadata, decimal/hex/short forms never connect',
  opts,
  async () => {
    for (const to of [
      prot() + '/secret',
      `http://localhost:${protPort}/`,
      `http://[::1]:${protPort}/`,
      'http://0.0.0.0/',
      `http://2130706433:${protPort}/`,
      `http://0x7f.1:${protPort}/`,
      `http://127.1:${protPort}/`,
      'http://169.254.169.254/latest/meta-data/',
      `http://toprivate.test:${protPort}/`,
    ]) {
      assert.equal(
        await code(sup.render({ url: url('/redir?to=' + encodeURIComponent(to)) })),
        'private_address',
        to,
      );
    }
    assert.equal(protectedConn, 0);
  },
);

test('C2: JS redirect and meta refresh to a private IP are refused', opts, async () => {
  for (const p of ['/js-redirect', '/meta-redirect']) {
    assert.equal(
      await code(sup.render({ url: url(p + '?to=' + encodeURIComponent(prot() + '/s')) })),
      'private_address',
      p,
    );
  }
  assert.equal(protectedConn, 0);
});

test(
  'C3/C14: sub-resources of every kind to private targets are blocked, page still renders',
  opts,
  async () => {
    const targets = [
      prot(),
      'http://10.1.2.3',
      'http://192.168.1.1',
      'http://172.16.0.1',
      'http://169.254.169.254',
    ];
    const r = await sup.render({ url: url('/sub?t=' + encodeURIComponent(targets.join(','))) });
    assert.match(r.html, /page still renders/);
    assert.ok((r.warnings ?? 0) > 0, 'blocks are counted');
    assert.equal(protectedConn, 0);
    assert.deepEqual(Object.keys(r).sort(), ['finalUrl', 'html', 'status', 'warnings']);
  },
);

test(
  'C12: loopback names via the proxy bypass list, including the sidecar own /render',
  opts,
  async () => {
    const r = await sup.render({ url: url('/loop?p=' + protPort) });
    assert.equal(r.status, 200);
    assert.equal(protectedConn, 0);
  },
);

test(
  'C4/C15: rebinding between hops: first answer public, later private, zero private connects',
  opts,
  async () => {
    resolverCalls.clear();
    const r = await sup.render({
      url: `http://rebind.test:${pubPort}/sub?t=${encodeURIComponent(`http://rebind.test:${pubPort}`)}`,
    });
    assert.match(r.html, /page still renders/);
    assert.equal(resolverCalls.get('rebind.test'), 1, 'one lookup per host per job');
    assert.equal(
      await code(sup.render({ url: `http://mixed.test:${pubPort}/ok` })),
      'private_address',
    );
    assert.equal(protectedConn, 0);
  },
);

test('T4 redirect cap: the 6th redirect aborts', opts, async () => {
  assert.notEqual(await code(sup.render({ url: url('/chain?n=0') })), 'ok');
  assert.ok(chainMax <= 6, `followed ${chainMax} hops, cap is 5 redirects`);
});

test(
  'R2/C20: with the proxy unreachable Chromium fails closed and never connects directly',
  opts,
  async () => {
    const { launchBrowser } = await import('../src/browser.ts');
    const b = await launchBrowser();
    try {
      const before = okHits;
      const ctx = await b.newContext({ proxy: { server: 'http://127.0.0.1:1' } });
      const page = await ctx.newPage();
      await assert.rejects(page.goto(`http://127.0.0.2:${pubPort}/ok`, { timeout: 8000 }));
      await ctx.close();
      assert.equal(okHits, before, 'no direct connection reached the target');
    } finally {
      await b.close();
    }
  },
);

test(
  'C5: hung page, spinning script end at the kill; healthz-equivalent next job works',
  opts,
  async () => {
    for (const p of ['/hang', '/spin']) {
      const t0 = Date.now();
      assert.equal(await code(sup.render({ url: url(p) })), 'timeout', p);
      const dt = Date.now() - t0;
      assert.ok(dt >= 4500 && dt <= 7000, `${p} took ${dt} ms (limit 5000 +/- 2000)`);
      const ok = await sup.render({ url: url('/ok') });
      assert.match(ok.html, /rendered-by-js/);
    }
  },
);

test('C5: 1000 sub-requests hit the request cap', opts, async () => {
  assert.equal(await code(sup.render({ url: url('/many') })), 'failed');
  assert.match((await sup.render({ url: url('/ok') })).html, /rendered/);
});

test('C6: downloads produce no file and fail', opts, async () => {
  const before = tmpFiles();
  for (const p of ['/attach', '/zip', '/dl-click']) {
    assert.equal(await code(sup.render({ url: url(p) })), 'failed', p);
  }
  assert.equal(tmpFiles(), before, '/tmp unchanged');
});

test(
  'C7: file:// as entry, redirect, iframe, fetch and window.open yields nothing',
  opts,
  async () => {
    assert.equal(await code(sup.render({ url: 'file:///etc/passwd' })), 'failed');
    assert.notEqual(
      await code(sup.render({ url: url('/redir?to=' + encodeURIComponent('file:///etc/passwd')) })),
      'ok',
    );
    const r = await sup.render({ url: url('/files') });
    assert.doesNotMatch(r.html, /root:/);
    for (const u of [
      'view-source:http://example.com/',
      'chrome://version',
      'about:blank',
      'ftp://example.com/',
      'javascript:alert(1)',
    ]) {
      assert.equal(await code(sup.render({ url: u })), 'failed', u);
    }
  },
);

test('C8: nothing survives between jobs', opts, async () => {
  await sup.render({ url: url('/set-state') });
  const r = await sup.render({ url: url('/read-state') });
  assert.match(r.html, /"c":"","l":null,"s":null/);
  assert.equal(sup.openContexts(), 0);
});

test('T4: popups, dialogs and beforeunload cannot hang a job', opts, async () => {
  const r = await sup.render({ url: url('/popup-dialog') });
  assert.match(r.html, /alive/);
  assert.equal(sup.openContexts(), 0);
});

test('T4: DOM over 5 MB is refused without killing the browser', opts, async () => {
  assert.equal(await code(sup.render({ url: url('/big') })), 'too_large');
  assert.match((await sup.render({ url: url('/ok') })).html, /rendered/);
});

test('T4: 20 sequential jobs leave no contexts and bounded memory', opts, async () => {
  const rss0 = process.memoryUsage().rss;
  for (let i = 0; i < 20; i++) await sup.render({ url: url('/ok') });
  assert.equal(sup.openContexts(), 0);
  assert.ok(process.memoryUsage().rss - rss0 < 200 * 1024 * 1024, 'node RSS did not balloon');
});
