// Static gate on the browser service in docker-compose.yml (threat model section 5 condition 3
// and control matrix 1, 11, 12, 14). Line based on purpose: no YAML dependency. The real
// capability set is checked inside the container by syscalls.docker.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');
const lines = file.split('\n');
const start = lines.findIndex((l) => /^ {2}browser:\s*$/.test(l));
assert.ok(start >= 0, 'browser service not found');
let end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
if (end < 0) end = lines.length;
const block = lines
  .slice(start, end)
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

test('browser service: exactly SYS_CHROOT added, ALL dropped', () => {
  assert.match(block, /cap_drop: \[ALL\]/);
  assert.match(block, /cap_add: \[SYS_CHROOT\]/);
  for (const bad of ['SYS_ADMIN', 'NET_ADMIN', 'NET_RAW', 'SYS_PTRACE', 'privileged'])
    assert.equal(block.includes(bad), false, `${bad} must not appear`);
});

test('browser service: hardening flags present', () => {
  assert.match(block, /no-new-privileges:true/);
  assert.match(block, /seccomp=\.\/docker\/browser\/seccomp\.json/);
  assert.match(block, /read_only: true/);
  assert.match(block, /init: true/);
  assert.match(block, /user: '10001:10001'/);
  assert.match(block, /^\s*mem_limit: 2g$/m);
  assert.match(block, /^\s*memswap_limit: 2g$/m);
  assert.match(block, /pids_limit: /);
  assert.equal(/unconfined/.test(block), false);
});

test('browser service: no volumes, no published ports, no host namespaces, no default network', () => {
  for (const key of ['volumes:', 'ports:', 'pid:', 'ipc:', 'network_mode:', 'devices:'])
    assert.equal(block.includes(key), false, `${key} must not appear`);
  assert.equal(block.includes('/var/run/docker.sock'), false);
  assert.match(block, /- headless-link/);
  assert.match(block, /- headless-egress/);
  assert.equal(/-\s*default\b/.test(block), false);
});

test('headless-link is internal and only the app is attached besides the browser', () => {
  assert.match(file, /headless-link:\n\s+internal: true/);
  const appStart = lines.findIndex((l) => /^ {2}app:\s*$/.test(l));
  const appEnd = lines.findIndex((l, i) => i > appStart && /^ {2}\S/.test(l));
  const app = lines.slice(appStart, appEnd).join('\n');
  assert.equal(app.includes('headless-egress'), false);
});
