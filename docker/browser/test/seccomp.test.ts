import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// @ts-expect-error plain .mjs script without types
import { compare, BASE_SHA256 } from '../scripts/check-seccomp.mjs';

const rd = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const base = JSON.parse(rd('seccomp.base.json'));
const ours = JSON.parse(rd('seccomp.json'));

test('committed base is the pinned Docker default profile', () => {
  assert.equal(createHash('sha256').update(rd('seccomp.base.json')).digest('hex'), BASE_SHA256);
});

test('seccomp.json is base plus exactly clone, clone3, unshare, setns', () => {
  assert.deepEqual(compare(base, ours), []);
});

test('compare rejects an extra syscall, a conditional rule and a missing rule', () => {
  const extra = structuredClone(ours);
  extra.syscalls[extra.syscalls.length - 1].names.push('mount');
  assert.notDeepEqual(compare(base, extra), []);
  const cond = structuredClone(ours);
  cond.syscalls.push({ action: 'SCMP_ACT_ALLOW', names: ['ptrace'] });
  assert.notDeepEqual(compare(base, cond), []);
  const missing = structuredClone(ours);
  missing.syscalls.shift();
  assert.notDeepEqual(compare(base, missing), []);
});

test('denied syscalls stay denied unconditionally (condition 2)', () => {
  const unconditional = new Set<string>();
  for (const r of ours.syscalls)
    if (r.action === 'SCMP_ACT_ALLOW' && !r.includes && !r.excludes && !r.args)
      for (const n of r.names) unconditional.add(n);
  for (const n of [
    'mount',
    'bpf',
    'keyctl',
    'ptrace',
    'open_by_handle_at',
    'umount2',
    'pivot_root',
  ])
    assert.equal(unconditional.has(n), false, `${n} must not be unconditionally allowed`);
});
