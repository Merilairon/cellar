// DOCKER / REAL-CHROMIUM TESTS, T9 part 2: UDP/QUIC/WebRTC/DNS canaries (C13), WebSocket (C14),
// resource policy (case 9), IndexedDB/service-worker isolation (case 8), memory and gzip bombs
// (case 5e, C18), and a proxy that dies mid-job (C20). Skipped unless BROWSER_DOCKER_TESTS=1.
// Run exactly like render.docker.test.ts (see the header there), with this file as the target.
// Every target is a local fixture; "public" is 127.0.0.2, allowed by the injected test override.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright-core';
import { Supervisor } from '../src/supervisor.ts';
import { loadConfig } from '../src/config.ts';
import { RenderError } from '../src/server.ts';
import { createJobProxy, type Addr } from '../src/proxy.ts';
import { launchBrowser } from '../src/browser.ts';

const ON = process.env.BROWSER_DOCKER_TESTS === '1';
const opts = {
  skip: ON ? false : 'needs real Chromium (set BROWSER_DOCKER_TESTS=1, run in the image)',
};
const KILL_MS = 5000;

const hits = new Map<string, number>();
const hit = (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1);
const count = (k: string) => hits.get(k) ?? 0;
let wsUpgrades = 0;
let protectedConn = 0;
let protectedServer: net.Server;
let pub: http.Server;
let pubPort = 0;
let protPort = 0;
let udp: dgram.Socket;
let udpPort = 0;
let udpPackets = 0;
let sup: Supervisor;
let smallSup: Supervisor;
const resolverCalls = new Map<string, number>();

const resolve = async (host: string): Promise<Addr[]> => {
  resolverCalls.set(host, (resolverCalls.get(host) ?? 0) + 1);
  if (host === 'public.test' || host === 'nodns.test') return [{ address: '127.0.0.2', family: 4 }];
  throw new Error('NXDOMAIN');
};
const html = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const url = (p: string) => `http://public.test:${pubPort}${p}`;

/** A gzip stream of `bytes` zero bytes, built once (it is ~1 MB compressed). */
let bomb: Buffer | null = null;
async function gzipBomb(bytes = 1024 ** 3): Promise<Buffer> {
  if (bomb) return bomb;
  const zero = Buffer.alloc(1 << 20);
  let left = bytes;
  const src = new Readable({
    read() {
      if (left <= 0) return void this.push(null);
      left -= zero.length;
      this.push(zero);
    },
  });
  const chunks: Buffer[] = [];
  for await (const c of src.pipe(zlib.createGzip({ level: 9 }))) chunks.push(c as Buffer);
  bomb = Buffer.concat(chunks);
  return bomb;
}

/** Text of the first <div> (the page's own result marker), not the script source. */
const marker = (h: string) => /<div id="[od]">([^<]*)<\/div>/.exec(h)?.[1] ?? '';

const oomKills = (): number | null => {
  try {
    return Number(
      /^oom_kill (\d+)$/m.exec(readFileSync('/sys/fs/cgroup/memory.events', 'utf8'))?.[1],
    );
  } catch {
    return null;
  }
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof RenderError ? e.code : `other:${String(e)}`;
  }
}

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url ?? '/', 'http://x');
  const send = (body: string | Buffer, type = 'text/html', extra: Record<string, string> = {}) => {
    res.writeHead(200, { 'content-type': type, ...extra });
    res.end(body);
  };
  hit(u.pathname);
  switch (u.pathname) {
    case '/ok':
      return send(html('<div id=a></div><script>a.textContent="rendered-by-js"</script>'));
    case '/udp':
      return send(
        html(
          `<p id=still>udp page</p><script>
          try{var pc=new RTCPeerConnection({iceServers:[{urls:["stun:127.0.0.1:${udpPort}","stun:public.test:${udpPort}","stun:127.0.0.2:${udpPort}"]}]});
          pc.createDataChannel("x");pc.createOffer().then(function(o){return pc.setLocalDescription(o)})}catch(e){}
          fetch("https://127.0.0.1:${udpPort}/").catch(function(){});
          fetch("https://127.0.0.2:${udpPort}/").catch(function(){});
          fetch("https://public.test:${udpPort}/").catch(function(){});
          </script>`,
        ),
      );
    case '/ws': {
      const t = (u.searchParams.get('t') ?? '').split(',');
      const js = t
        .map(
          (x) =>
            `try{var w=new WebSocket(${JSON.stringify(x)});w.onclose=function(){d.textContent+="closed;"};w.onopen=function(){d.textContent+="OPEN;"};w.onerror=function(){}}catch(e){d.textContent+="threw;"}`,
        )
        .join('');
      return send(
        html(`<div id=d></div><script>var d=document.getElementById("d");${js}</script>`),
      );
    }
    case '/resources':
      return send(
        html(
          `<p id=still>res</p><img src="/img.png"><video src="/vid.mp4"></video><audio src="/aud.mp3"></audio>
           <script src="/lib.js"></script><link rel=stylesheet href="/s.css"><link rel=manifest href="/m.json">
           <link rel=icon href="/fav.ico"><link rel=preload as=font href="/f.woff2" crossorigin>
           <style>@font-face{font-family:x;src:url(/font.woff2)}p{font-family:x}</style>
           <script>try{new EventSource("/events")}catch(e){}; navigator.sendBeacon("/beacon","x")</script>`,
        ),
      );
    case '/lib.js':
      return send('/* lib */', 'text/javascript');
    case '/s.css':
      return send('p{color:red}', 'text/css');
    case '/state-write':
      return send(
        html(
          `<div id=o></div><script>
          var o=document.getElementById("o");
          var r=indexedDB.open("jobdb",1);
          r.onupgradeneeded=function(){r.result.createObjectStore("s")};
          r.onsuccess=function(){var t=r.result.transaction("s","readwrite");t.objectStore("s").put("secret","k");t.oncomplete=function(){o.textContent+="idb-written;"}};
          try{navigator.serviceWorker.register("/sw.js").then(function(){o.textContent+="sw-registered;"},function(){o.textContent+="sw-refused;"})}catch(e){o.textContent+="sw-undefined;"}
          localStorage.k="v";document.cookie="c=1";
          </script>`,
        ),
      );
    case '/state-read':
      return send(
        html(
          `<div id=o></div><script>
          var o=document.getElementById("o");
          var out={ls:localStorage.k||null,ck:document.cookie};
          (indexedDB.databases?indexedDB.databases():Promise.resolve([])).then(function(d){out.idb=d.map(function(x){return x.name});
            return navigator.serviceWorker?navigator.serviceWorker.getRegistrations().then(function(r){out.sw=r.length},function(){out.sw="refused"}):0})
            .catch(function(){}).then(function(){o.textContent=JSON.stringify(out)});
          </script>`,
        ),
      );
    case '/sw.js':
      return send('self.addEventListener("fetch",function(){})', 'text/javascript');
    case '/membomb':
      return send(
        html(
          `<p id=alive>alive</p><script>
          var keep=[];try{for(;;){keep.push(new Array(5e6).fill(1.5))}}catch(e){}
          try{new Array(1e9).fill(1)}catch(e){}
          try{var s="x";for(;;){s+=s;keep.push(s)}}catch(e){}
          </script>`,
        ),
      );
    case '/gz':
      void gzipBomb().then((b) =>
        send(b, 'text/plain', { 'content-encoding': 'gzip', 'content-length': String(b.length) }),
      );
      return;
    case '/gz-fetch':
      return send(
        html(
          `<p id=alive>alive</p><script>fetch("/gz").then(function(r){return r.arrayBuffer()}).then(function(b){document.title=b.byteLength}).catch(function(){})</script>`,
        ),
      );
    case '/gz-doc':
      void gzipBomb().then((b) =>
        send(b, 'text/html', { 'content-encoding': 'gzip', 'content-length': String(b.length) }),
      );
      return;
    case '/gz-script':
      return send(html('<p id=alive>alive</p><script src="/gz"></script>'));
    case '/bytes':
      return send(html('<p id=alive>alive</p><script src="/blob.js"></script>'));
    case '/blob.js':
      return send('/*' + 'x'.repeat(400_000) + '*/', 'text/javascript');
    case '/nodns':
      return send(html('<p id=alive>nodns ok</p>'));
    default:
      res.writeHead(404);
      res.end();
  }
}

before(async () => {
  if (!ON) return;
  protectedServer = net.createServer((s) => {
    protectedConn++;
    s.on('error', () => {});
    s.end('HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nSECRET');
  });
  await new Promise<void>((r) => protectedServer.listen(0, '127.0.0.1', r));
  protPort = (protectedServer.address() as AddressInfo).port;
  udp = dgram.createSocket('udp4');
  udp.on('message', () => udpPackets++);
  await new Promise<void>((r) => udp.bind(0, '0.0.0.0', r));
  udpPort = udp.address().port;
  pub = http.createServer(handler);
  pub.on('upgrade', (_q, s) => {
    wsUpgrades++;
    s.destroy();
  });
  await new Promise<void>((r) => pub.listen(0, '127.0.0.2', r));
  pubPort = (pub.address() as AddressInfo).port;
  const testOverrides = {
    allowAddress: (ip: string) => ip === '127.0.0.2',
    allowPorts: [pubPort, protPort, udpPort],
  };
  const env = { HEADLESS_ALLOW_NO_TOKEN: '1', RENDER_TIMEOUT_MS: String(KILL_MS) };
  sup = new Supervisor(loadConfig(env), { resolve, testOverrides });
  smallSup = new Supervisor(loadConfig({ ...env, MAX_TOTAL_BYTES: '100000' }), {
    resolve,
    testOverrides,
  });
});
after(async () => {
  if (!ON) return;
  await sup.shutdown();
  await smallSup.shutdown();
  pub.closeAllConnections();
  pub.close();
  protectedServer.close();
  udp.close();
});

test(
  'C13 control: the UDP canary does receive a packet from a Chromium with default networking',
  opts,
  async () => {
    // Proves the canary can detect a leak: same page, no network flags, no proxy.
    const b = await chromium.launch({ headless: true, chromiumSandbox: true });
    try {
      const before = udpPackets;
      const page = await b.newPage();
      await page.goto('about:blank');
      await page.evaluate(
        `(function(){var pc=new RTCPeerConnection({iceServers:[{urls:"stun:127.0.0.1:${udpPort}"}]});pc.createDataChannel("x");pc.createOffer().then(function(o){return pc.setLocalDescription(o)})})()`,
      );
      for (let i = 0; i < 40 && udpPackets === before; i++)
        await new Promise((r) => setTimeout(r, 100));
      assert.ok(udpPackets > before, 'canary saw a STUN packet from an unhardened Chromium');
    } finally {
      await b.close();
    }
  },
);

test(
  'C13: RTCPeerConnection and HTTP/3-style fetches to a UDP canary send zero packets',
  opts,
  async () => {
    const before = udpPackets;
    const r = await sup.render({ url: url('/udp'), waitMs: 3000 });
    assert.match(r.html, /udp page/);
    assert.equal(udpPackets, before, 'no UDP datagram left the browser');
    assert.equal(protectedConn, 0);
  },
);

test(
  'C13: Chromium never resolves names itself, the proxy does exactly once per host',
  opts,
  async () => {
    resolverCalls.clear();
    const r = await sup.render({ url: `http://nodns.test:${pubPort}/nodns` });
    assert.match(r.html, /nodns ok/);
    assert.equal(resolverCalls.get('nodns.test'), 1);
    // A name the resolver does not know fails: there is no second, browser-side resolver to fall back on.
    assert.notEqual(await code(sup.render({ url: `http://unknown.test:${pubPort}/ok` })), 'ok');
  },
);

test(
  'C14: ws:// to protected and public targets is closed in the page, zero upgrades',
  opts,
  async () => {
    const before = wsUpgrades;
    const targets = [
      `ws://127.0.0.1:${protPort}/w`,
      `ws://localhost:${protPort}/w`,
      `ws://public.test:${pubPort}/w`,
      `wss://127.0.0.1:${protPort}/w`,
      `wss://public.test:${pubPort}/w`,
    ];
    const r = await sup.render({
      url: url('/ws?t=' + encodeURIComponent(targets.join(','))),
      waitMs: 1500,
    });
    assert.match(marker(r.html), /^(closed;){5}$/, 'every socket was closed, none opened');
    assert.equal(wsUpgrades, before, 'no Upgrade reached the public fixture');
    assert.equal(protectedConn, 0);
  },
);

test(
  'C9: media, font, image, manifest, EventSource and beacon are never fetched; scripts and CSS are',
  opts,
  async () => {
    hits.clear();
    const r = await sup.render({ url: url('/resources'), waitMs: 1500 });
    assert.match(r.html, /res/);
    for (const p of [
      '/img.png',
      '/vid.mp4',
      '/aud.mp3',
      '/m.json',
      '/fav.ico',
      '/f.woff2',
      '/font.woff2',
      '/events',
      '/beacon',
    ]) {
      assert.equal(count(p), 0, `${p} must not be requested`);
    }
    assert.ok(count('/lib.js') >= 1 && count('/s.css') >= 1, 'control: allowed types are fetched');
  },
);

test(
  'C9: the per-job byte cap is enforced (too_large) and the same page is fine under the default cap',
  opts,
  async () => {
    assert.equal(await code(smallSup.render({ url: url('/bytes') })), 'too_large');
    assert.match((await sup.render({ url: url('/bytes') })).html, /alive/);
    assert.match((await smallSup.render({ url: url('/ok') })).html, /rendered-by-js/);
  },
);

test(
  'C8: IndexedDB, localStorage, cookies and service-worker registration do not survive a job',
  opts,
  async () => {
    const w = await sup.render({ url: url('/state-write'), waitMs: 1000 });
    assert.match(marker(w.html), /idb-written/, 'control: the first job really wrote IndexedDB');
    assert.doesNotMatch(marker(w.html), /sw-registered/, 'service workers are blocked');
    const r = await sup.render({ url: url('/state-read'), waitMs: 1000 });
    const state = JSON.parse(marker(r.html).replace(/&quot;/g, '"')) as Record<string, unknown>;
    assert.equal(state.ls, null);
    assert.equal(state.ck, '');
    assert.deepEqual(state.idb, []);
    assert.ok(state.sw === undefined || state.sw === 0 || state.sw === 'refused');
    assert.equal(sup.openContexts(), 0);
  },
);

test(
  'C5e: a memory bomb ends within the kill window and the next job works on a healthy browser',
  opts,
  async () => {
    const oom0 = oomKills();
    const t0 = Date.now();
    const c = await code(sup.render({ url: url('/membomb') }));
    const dt = Date.now() - t0;
    assert.ok(['failed', 'timeout', 'too_large', 'ok'].includes(c), c);
    assert.ok(dt <= KILL_MS + 2500, `took ${dt} ms`);
    assert.match((await sup.render({ url: url('/ok') })).html, /rendered-by-js/);
    assert.equal(sup.openContexts(), 0);
    // The cgroup may kill the runaway renderer (oom_kill rises). What matters: only the job's
    // process died, this process and the sidecar are alive, and the next job above ran.
    if (oom0 !== null)
      console.log(`# memory bomb: oom_kill ${oom0} -> ${oomKills()}, outcome ${c}`);
  },
);

test(
  'C18: gzip bomb as fetch body, script and document: bounded time, no container OOM, next job works',
  opts,
  async () => {
    const oom0 = oomKills();
    for (const p of ['/gz-fetch', '/gz-script', '/gz-doc']) {
      const t0 = Date.now();
      const c = await code(sup.render({ url: url(p), waitMs: 2000 }));
      const dt = Date.now() - t0;
      assert.ok(['failed', 'timeout', 'too_large', 'ok'].includes(c), `${p}: ${c}`);
      assert.ok(dt <= KILL_MS + 2500, `${p} took ${dt} ms`);
      const next = await sup.render({ url: url('/ok') });
      assert.match(next.html, /rendered-by-js/, `${p}: next job`);
    }
    if (oom0 !== null) assert.equal(oomKills(), oom0, 'the container itself was not OOM-killed');
    assert.equal(sup.openContexts(), 0);
  },
);

test('C20: a proxy that dies mid-job fails closed with zero direct connections', opts, async () => {
  const b = await launchBrowser();
  try {
    const p = await createJobProxy({
      resolve,
      maxBytes: 1 << 20,
      maxRequests: 100,
      testOverrides: { allowAddress: (ip) => ip === '127.0.0.2', allowPorts: [pubPort] },
    });
    const ctx = await b.newContext({ proxy: { server: `http://127.0.0.1:${p.port}` } });
    const page = await ctx.newPage();
    const resp = await page.goto(`http://public.test:${pubPort}/ok`, { timeout: 8000 });
    assert.equal(resp?.status(), 200, 'control: the page loads through the live proxy');
    await p.close();
    const before = count('/ok');
    for (const target of [`http://public.test:${pubPort}/ok`, `http://127.0.0.2:${pubPort}/ok`]) {
      await assert.rejects(page.goto(target, { timeout: 8000 }), target);
    }
    const sub = await page.evaluate(
      `fetch("http://public.test:${pubPort}/ok").then(function(){return "reached"},function(){return "failed"})`,
    );
    assert.equal(sub, 'failed');
    assert.equal(count('/ok'), before, 'nothing went direct after the proxy died');
    await ctx.close();
  } finally {
    await b.close();
  }
});
