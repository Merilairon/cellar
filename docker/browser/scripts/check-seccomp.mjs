#!/usr/bin/env node
// Reproducible proof that seccomp.json = Docker default profile + exactly clone, clone3,
// unshare, setns (threat model section 5, condition 1).
//   node scripts/check-seccomp.mjs            verify against the committed seccomp.base.json
//   node scripts/check-seccomp.mjs --fetch    re-download the pinned base first (needs network)
//   node scripts/check-seccomp.mjs file.json  verify against another copy of the base
// The base is moby/profiles seccomp/v0.3.0, file seccomp/default.json (the profile Docker 29.x
// embeds), pinned by sha256 below.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASE_URL =
  'https://raw.githubusercontent.com/moby/profiles/seccomp/v0.3.0/seccomp/default.json';
export const BASE_SHA256 = '6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6';
export const ADDED = ['clone', 'clone3', 'setns', 'unshare'];

const canon = (v) => JSON.stringify(v);

/** Returns a list of problems; empty means the profile is base + the four syscalls only. */
export function compare(base, ours) {
  const problems = [];
  const { syscalls: bs, ...bRest } = base;
  const { syscalls: os, ...oRest } = ours;
  if (canon(bRest) !== canon(oRest)) problems.push('top-level fields differ from base');
  if (os.length !== bs.length + 1)
    problems.push(`expected ${bs.length + 1} rules, got ${os.length}`);
  else {
    // Insertion position is irrelevant to seccomp semantics for pure ALLOW rules, so find it.
    const extra = os.filter((r) => !bs.some((b) => canon(b) === canon(r)));
    const missing = bs.filter((b) => !os.some((r) => canon(b) === canon(r)));
    if (missing.length) problems.push('base rules missing from profile');
    if (extra.length !== 1) problems.push('profile has other than exactly one added rule');
    else {
      const e = extra[0];
      const names = [...(e.names ?? [])].sort();
      if (
        e.action !== 'SCMP_ACT_ALLOW' ||
        canon(names) !== canon(ADDED) ||
        Object.keys(e).sort().join() !== 'action,names'
      ) {
        problems.push(`added rule is not an unconditional allow of ${ADDED.join(', ')}`);
      }
    }
  }
  return problems;
}

async function main() {
  const profile = JSON.parse(readFileSync(new URL('../seccomp.json', import.meta.url), 'utf8'));
  let raw;
  const arg = process.argv[2];
  if (arg && arg !== '--fetch') raw = readFileSync(arg);
  else if (!arg) raw = readFileSync(new URL('../seccomp.base.json', import.meta.url));
  else {
    const r = await fetch(BASE_URL);
    if (!r.ok) throw new Error(`fetch ${BASE_URL}: ${r.status}`);
    raw = Buffer.from(await r.arrayBuffer());
  }
  const sum = createHash('sha256').update(raw).digest('hex');
  if (sum !== BASE_SHA256) throw new Error(`base sha256 mismatch: ${sum}`);
  const problems = compare(JSON.parse(raw.toString('utf8')), profile);
  if (problems.length) {
    console.error('FAIL:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log(
    `ok: seccomp.json = Docker default (moby/profiles seccomp/v0.3.0, sha256 ${sum.slice(0, 12)}...) + ${ADDED.join(', ')}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
