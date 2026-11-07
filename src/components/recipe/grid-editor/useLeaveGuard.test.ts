import { describe, expect, it } from 'vitest';
import { createLeaveGuard, SKIP_TIMEOUT_MS, type GuardEnv } from './useLeaveGuard';

/** A fake history: back() queues a popstate that the test delivers (or drops) by hand. */
function setup() {
  const log: string[] = [];
  let pending = 0;
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const env: GuardEnv = {
    push: () => log.push('push'),
    back: () => {
      log.push('back');
      pending += 1;
    },
    href: () => 'http://x/recipe',
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  let attempts = 0;
  const guard = createLeaveGuard(env, () => (attempts += 1));
  return {
    guard,
    log,
    attempts: () => attempts,
    /** Deliver one queued popstate from a back() we issued. */
    deliver() {
      if (pending > 0) {
        pending -= 1;
        guard.pop();
      }
    },
    drop() {
      pending = 0;
    },
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
  };
}

describe('leave guard controller', () => {
  it('Back while dirty re-arms and asks; two quick Backs ask twice and keep one entry', () => {
    const s = setup();
    s.guard.attach();
    s.guard.setDirty(true);
    expect(s.log).toEqual(['push']);
    s.guard.pop(); // user Back
    s.guard.pop(); // second Back
    expect(s.attempts()).toBe(2);
    expect(s.log).toEqual(['push', 'push', 'push']);
  });

  it('going clean removes the entry and swallows our own popstate', () => {
    const s = setup();
    s.guard.attach();
    s.guard.setDirty(true);
    s.guard.setDirty(false);
    s.deliver();
    expect(s.attempts()).toBe(0);
    expect(s.log).toEqual(['push', 'back']);
  });

  it('m2a: cleanup + re-run (Fast Refresh, strict mode) does not raise a spurious confirm', () => {
    const s = setup();
    s.guard.attach();
    s.guard.setDirty(true);
    // Effects re-run: cleanup, then the dirty effect, then the listener effect.
    s.guard.detach();
    s.guard.setDirty(true);
    s.guard.attach();
    s.deliver(); // the popstate of the cleanup's back()
    expect(s.attempts()).toBe(0);
    // It re-armed exactly once after its own back() landed.
    expect(s.log).toEqual(['push', 'back', 'push']);
    s.guard.pop(); // a real Back now still asks
    expect(s.attempts()).toBe(1);
  });

  it('m2b: a back() without a popstate does not disable the guard for good', () => {
    const s = setup();
    s.guard.attach();
    s.guard.setDirty(true);
    s.guard.setDirty(false);
    s.drop(); // the browser never answered
    s.guard.setDirty(true); // still waiting: no push yet
    expect(s.log).toEqual(['push', 'back']);
    s.advance(SKIP_TIMEOUT_MS);
    expect(s.log).toEqual(['push', 'back', 'push']);
    s.guard.pop();
    expect(s.attempts()).toBe(1);
  });

  it('unmount: the timer never re-arms a detached guard', () => {
    const s = setup();
    s.guard.attach();
    s.guard.setDirty(true);
    s.guard.detach();
    s.drop();
    s.advance(SKIP_TIMEOUT_MS * 2);
    expect(s.log).toEqual(['push', 'back']);
  });
});
