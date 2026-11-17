import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyRunning,
  beginApply,
  beginUpload,
  discardStage,
  ensureRestoreDir,
  getStage,
  listStages,
  newStagePath,
  pruneStaging,
  registerStage,
  resetStagingForTests,
  STAGE_TTL_MS,
  stageOf,
} from './staging';

let root: string;
let dir: string;
beforeEach(() => {
  resetStagingForTests();
  root = mkdtempSync(join(tmpdir(), 'staging-'));
  dir = ensureRestoreDir(join(root, 'restore'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function stage(owner: string, at: number, kind: 'json' | 'zip' = 'json') {
  const { id, path } = newStagePath(dir, kind);
  writeFileSync(path, '{}');
  return registerStage({ id, ownerId: owner, kind, path, createdAt: at });
}

describe('staging registry', () => {
  it('creates the directory with mode 0700', () => {
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('serves a live stage to its owner only', () => {
    const s = stage('u1', 1000);
    expect(getStage(s.id, 'u1', 1000)).toBe(s);
    expect(getStage(s.id, 'u2', 1000)).toBeUndefined();
    expect(getStage('not-a-ulid', 'u1', 1000)).toBeUndefined();
    expect(getStage(ulid(), 'u1', 1000)).toBeUndefined();
  });

  it('expires after one hour by the injected clock, and pruning deletes the file', () => {
    const s = stage('u1', 1000);
    expect(getStage(s.id, 'u1', 1000 + STAGE_TTL_MS - 1)).toBe(s);
    expect(getStage(s.id, 'u1', 1000 + STAGE_TTL_MS)).toBeUndefined();
    expect(existsSync(s.path)).toBe(true); // lookup alone does not delete
    pruneStaging(dir, 1000 + STAGE_TTL_MS);
    expect(existsSync(s.path)).toBe(false);
    expect(listStages()).toEqual([]);
  });

  it('prune keeps a fresh stage and never drops one being applied', () => {
    const fresh = stage('u1', 5000);
    const old = stage('u2', 0);
    const lease = beginApply(old);
    expect(lease).not.toBe('busy');
    pruneStaging(dir, 5000 + STAGE_TTL_MS - 1);
    expect(existsSync(fresh.path)).toBe(true);
    expect(existsSync(old.path)).toBe(true); // being applied
    if (lease !== 'busy') lease.end();
    pruneStaging(dir, 5000 + STAGE_TTL_MS - 1);
    expect(existsSync(old.path)).toBe(false);
  });

  it('prune deletes orphan files older than the TTL and leaves young and foreign files', () => {
    const orphan = join(dir, `${ulid()}.zip`);
    const young = join(dir, `${ulid()}.json`);
    const foreign = join(dir, 'notes.txt');
    for (const f of [orphan, young, foreign]) writeFileSync(f, 'x');
    const t = Date.now() / 1000;
    utimesSync(orphan, t - 7200, t - 7200);
    utimesSync(foreign, t - 7200, t - 7200);
    pruneStaging(dir, Date.now());
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  it('prune on a missing directory is a no-op', () => {
    expect(() => pruneStaging(join(root, 'nope'))).not.toThrow();
  });

  it('one apply per process; a lease ends once and frees the slot', () => {
    const a = stage('u1', 0);
    const b = stage('u2', 0);
    const la = beginApply(a);
    expect(la).not.toBe('busy');
    expect(beginApply(b)).toBe('busy');
    expect(applyRunning()).toBe(true);
    expect(applyRunning('u1')).toBe(true);
    expect(applyRunning('u2')).toBe(false);
    if (la !== 'busy') {
      la.end();
      la.end();
    }
    expect(applyRunning()).toBe(false);
    expect(beginApply(b)).not.toBe('busy');
  });

  it('one upload per user at a time', () => {
    const r = beginUpload('u1');
    expect(r).not.toBeNull();
    expect(beginUpload('u1')).toBeNull();
    expect(beginUpload('u2')).not.toBeNull();
    r!();
    r!();
    expect(beginUpload('u1')).not.toBeNull();
  });

  it('discard removes the registry entry and the file; stageOf finds the user stage', () => {
    const s = stage('u1', 0);
    expect(stageOf('u1')).toBe(s);
    discardStage(s);
    expect(stageOf('u1')).toBeUndefined();
    expect(existsSync(s.path)).toBe(false);
  });

  it('the registry lives on globalThis so separately loaded modules share it', () => {
    stage('u1', 0);
    const g = globalThis as unknown as { __restoreStaging?: { stages: Map<string, unknown> } };
    expect(g.__restoreStaging?.stages.size).toBe(1);
  });
});
