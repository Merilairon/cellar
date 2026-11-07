import { describe, expect, it } from 'vitest';
import { BODY_MARKER, sourceBody } from '../e2e/source-body';

describe('sourceBody', () => {
  it('returns the text from the marker on', () => {
    expect(sourceBody(`head\n${BODY_MARKER}\ntail`)).toBe(`${BODY_MARKER}\ntail`);
  });
  it('throws when the marker is missing instead of scanning nothing', () => {
    expect(() => sourceBody('no marker here')).toThrow(/marker/);
  });
});
