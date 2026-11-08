import { describe, expect, it } from 'vitest';
import { createAnnouncer } from './announcer';

function fake() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id: unknown) => void timers.delete(id as number),
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

describe('announcer', () => {
  it('publishes nothing until the delay passes, then once', () => {
    const f = fake();
    const out: string[] = [];
    const a = createAnnouncer((m) => out.push(m), 400, f);
    a.announce('one');
    f.advance(399);
    expect(out).toEqual([]);
    f.advance(1);
    expect(out).toEqual(['one']);
  });

  it('a newer message within 400 ms replaces the pending one', () => {
    const f = fake();
    const out: string[] = [];
    const a = createAnnouncer((m) => out.push(m), 400, f);
    for (const m of ['a', 'b', 'c', 'd', 'e']) {
      a.announce(m);
      f.advance(100);
    }
    f.advance(400);
    expect(out).toEqual(['e']);
  });

  it('re-announces an identical message by changing the text', () => {
    const f = fake();
    const out: string[] = [];
    const a = createAnnouncer((m) => out.push(m), 400, f);
    a.announce('Saved.');
    f.advance(400);
    a.announce('Saved.');
    f.advance(400);
    expect(out[0]).toBe('Saved.');
    expect(out[1]).not.toBe(out[0]);
    expect(out[1].trim()).toBe('Saved.');
  });

  it('dispose drops a pending message', () => {
    const f = fake();
    const out: string[] = [];
    const a = createAnnouncer((m) => out.push(m), 400, f);
    a.announce('x');
    a.dispose();
    f.advance(1000);
    expect(out).toEqual([]);
  });
});
