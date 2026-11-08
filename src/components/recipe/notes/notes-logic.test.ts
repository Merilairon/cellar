import { describe, expect, it } from 'vitest';
import { counterAnnouncement, noteErrorFor, noteReason } from './notes-logic';

describe('noteReason', () => {
  it('blocks empty and over-long text', () => {
    expect(noteReason('')).toEqual({ key: 'empty' });
    expect(noteReason('  \n ')).toEqual({ key: 'empty' });
    expect(noteReason('x'.repeat(4001))).toEqual({ key: 'tooLong', over: 1 });
    expect(noteReason('x'.repeat(4000))).toBeNull();
    expect(noteReason('hi')).toBeNull();
  });
});

describe('counterAnnouncement', () => {
  it('fires once per threshold', () => {
    expect(counterAnnouncement(3799, 3800)).toEqual({ key: 'left', n: 200 });
    expect(counterAnnouncement(3800, 3801)).toBeNull();
    expect(counterAnnouncement(3949, 3950)).toEqual({ key: 'left', n: 50 });
    expect(counterAnnouncement(3999, 4000)).toEqual({ key: 'limit' });
    expect(counterAnnouncement(4000, 4001)).toBeNull();
  });
  it('a paste across thresholds announces the highest one only', () => {
    expect(counterAnnouncement(100, 3960)).toEqual({ key: 'left', n: 50 });
    expect(counterAnnouncement(100, 5000)).toEqual({ key: 'limit' });
  });
  it('deleting text announces nothing', () => {
    expect(counterAnnouncement(4000, 3000)).toBeNull();
  });
});

describe('noteErrorFor', () => {
  it('maps statuses and codes', () => {
    expect(noteErrorFor(0, null)).toBe('network');
    expect(noteErrorFor(404, null)).toBe('forbidden');
    expect(noteErrorFor(401, null)).toBe('forbidden');
    expect(noteErrorFor(500, null)).toBe('network');
    const e = (code: string) => ({ errors: [{ path: 'body', code }] });
    expect(noteErrorFor(422, e('note_limit'))).toBe('limit');
    expect(noteErrorFor(422, e('too_small'))).toBe('empty');
    expect(noteErrorFor(422, e('too_big'))).toBe('tooLong');
    expect(noteErrorFor(422, e('nul_char'))).toBe('generic');
  });
});
