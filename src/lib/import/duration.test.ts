import { describe, expect, it } from 'vitest';
import { isoDurationToMinutes as d } from './duration';

describe('isoDurationToMinutes', () => {
  it.each([
    ['PT45M', 45],
    ['PT1H30M', 90],
    ['PT1H', 60],
    ['P0DT20M', 20],
    ['P0DT45M', 45],
    ['P1DT2H', 1560],
    ['P1W', 10080],
    ['PT90S', 2],
    ['PT30S', 1],
    ['PT0M', 0],
    ['pt15m', 15],
    ['PT1.5H', 90],
    [' PT10M ', 10],
  ])('%s -> %s', (s, n) => expect(d(s)).toBe(n));

  it.each([
    '',
    'P',
    'PT',
    '45',
    '45 minutes',
    'P1Y',
    'P1M',
    'PT1H30',
    'T10M',
    'PT-5M',
    'PT10M extra',
    null,
    undefined,
    45,
    {},
  ])('rejects %j', (s) => expect(d(s)).toBeNull());

  it('rejects absurdly long durations', () => {
    expect(d('P999W')).toBeNull();
  });
});
