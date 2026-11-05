import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter, LimiterBusyError } from './limiter';

describe('createConcurrencyLimiter', () => {
  it('never runs more than max at once and still runs everything', async () => {
    const run = createConcurrencyLimiter(4);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(4);
    expect(done).toHaveLength(12);
  });

  it('frees the slot when a task throws', async () => {
    const run = createConcurrencyLimiter(1);
    await expect(run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects with LimiterBusyError when the queue is full, and recovers', async () => {
    const run = createConcurrencyLimiter(1, { maxQueue: 1, retryAfterSec: 7 });
    let release!: () => void;
    const hold = run(() => new Promise<void>((r) => (release = r)));
    const queued = run(async () => 'queued');
    const err = await run(async () => 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimiterBusyError);
    expect((err as LimiterBusyError).retryAfterSec).toBe(7);
    release();
    await hold;
    await expect(queued).resolves.toBe('queued');
    await expect(run(async () => 'again')).resolves.toBe('again');
  });

  it('a waiter gives up after waitMs without consuming a slot', async () => {
    const run = createConcurrencyLimiter(1, { waitMs: 20 });
    let release!: () => void;
    const hold = run(() => new Promise<void>((r) => (release = r)));
    await expect(run(async () => 'x')).rejects.toBeInstanceOf(LimiterBusyError);
    release();
    await hold;
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });
});
