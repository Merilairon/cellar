import { chromium } from 'playwright-core';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
const sandbox = process.env.NO_SANDBOX === '1' ? false : true;
// JS-only fixture server
const page = `<!doctype html><title>x</title><div id=r></div><script>
document.getElementById('r').innerHTML='<script type="application/ld+json">{"@type":"Recipe","name":"JS only"}<\\/script><p>rendered</p>';
// bypass probes: ws, webrtc, prefetch, preconnect
try{new WebSocket('ws://canary.invalid:9999')}catch(e){}
try{new RTCPeerConnection({iceServers:[{urls:'stun:stun.canary.invalid:3478'}]}).createDataChannel('x')}catch(e){}
fetch('http://127.0.0.2:9/x').catch(()=>{});
</script><link rel=preconnect href="http://127.0.0.3:9"><link rel=dns-prefetch href="//dnspf.invalid"><link rel=prefetch href="http://127.0.0.4:9/p">`;
const srv = http
  .createServer((q, s) => {
    s.setHeader('content-type', 'text/html');
    s.end(page);
  })
  .listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const port = srv.address().port;
// logging "proxy": records every CONNECT/HTTP attempt, forwards only to fixture
const seen = [];
const proxy = http.createServer((q, s) => {
  seen.push('HTTP ' + q.url);
  if (q.url.includes(`127.0.0.1:${port}`)) {
    http.get(`http://127.0.0.1:${port}/`, (r) => {
      s.writeHead(r.statusCode, r.headers);
      r.pipe(s);
    });
  } else {
    s.writeHead(403);
    s.end();
  }
});
proxy.on('connect', (q, sock) => {
  seen.push('CONNECT ' + q.url);
  sock.end('HTTP/1.1 403 no\r\n\r\n');
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const pport = proxy.address().port;
const allRss = () => {
  let t = 0;
  for (const d of fs.readdirSync('/proc'))
    if (/^\d+$/.test(d)) {
      try {
        t += +fs.readFileSync('/proc/' + d + '/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1];
      } catch {}
    }
  return (t / 1024) | 0;
};
const rss = () => {
  try {
    return (fs.readFileSync('/proc/self/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024) | 0;
  } catch {
    return -1;
  }
};
const direct = [];
for (const ip of ['127.0.0.2', '127.0.0.3', '127.0.0.4'])
  net
    .createServer((c) => {
      direct.push('TCP ' + ip);
      c.destroy();
    })
    .listen(9, ip);
import('node:dgram').then((d) => {
  const u = d.createSocket('udp4');
  u.on('message', (_, r) => direct.push('UDP ' + r.address));
  u.bind(3478, '127.0.0.1');
});
const t0 = Date.now();
const args = [
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-extensions',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-features=WebRtcHideLocalIpsWithMdns,NetworkPrediction,PrefetchProxy',
  '--no-first-run',
  `--proxy-server=http://127.0.0.1:${pport}`,
  '--proxy-bypass-list=<-loopback>',
];
const browser = await chromium.launch({ headless: true, chromiumSandbox: sandbox, args });
console.log('idle RSS MB (all procs, after launch):', allRss());
const ctx = await browser.newContext({
  serviceWorkers: 'block',
  acceptDownloads: false,
  permissions: [],
});
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle', timeout: 15000 });
const html = await p.content();
console.log('peak-ish RSS MB (all procs, after render):', allRss());
console.log(
  JSON.stringify({
    arch: process.arch,
    uid: process.getuid(),
    chromiumSandbox: sandbox,
    version: browser.version(),
    domLen: html.length,
    jsRendered: html.includes('"Recipe"'),
    renderMs: Date.now() - t0,
  }),
);
console.log('proxy saw:', JSON.stringify(seen));
// sandbox status from chrome://sandbox equivalent
const p2 = await ctx.newPage();
await p2.goto('chrome://sandbox').catch(() => {});
console.log(
  'sandbox page:',
  (await p2.innerText('body').catch(() => 'n/a'))
    .split('\n')
    .filter((l) => /sandbox|namespace|seccomp/i.test(l))
    .slice(0, 8)
    .join(' | '),
);
await new Promise((r) => setTimeout(r, 2500));
console.log('DIRECT connection attempts to canaries (must be empty):', JSON.stringify(direct));
await ctx.close();
await browser.close();
srv.close();
proxy.close();
process.exit(0);
