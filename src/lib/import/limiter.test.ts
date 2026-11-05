import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter } from './limiter';

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
});
