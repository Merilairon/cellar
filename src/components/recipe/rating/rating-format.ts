// Pure rating helpers shared by the card, the summary, the star control and the tests.

export type RatingState = { avg: number | null; count: number; mine: number | null };

/** What the aggregate becomes when the viewer sets (or replaces) their own rating locally. */
export function withMyRating(s: RatingState, stars: number): RatingState {
  const sum = (s.avg ?? 0) * s.count - (s.mine ?? 0) + stars;
  const count = s.mine === null ? s.count + 1 : s.count;
  return { avg: sum / count, count, mine: stars };
}

/** What the aggregate becomes when the viewer clears their rating. */
export function withoutMyRating(s: RatingState): RatingState {
  if (s.mine === null) return s;
  const count = s.count - 1;
  if (count <= 0) return { avg: null, count: 0, mine: null };
  return { avg: ((s.avg ?? 0) * s.count - s.mine) / count, count, mine: null };
}

/** Fraction (0..1) of star `i` (1-based) filled by an average, for the decorative row. */
export function starFill(avg: number | null, i: number): number {
  if (avg === null) return 0;
  return Math.max(0, Math.min(1, avg - (i - 1)));
}

export const FILTER_OPTIONS = [2, 3, 4, 5] as const;

/** `?min_rating=` as the API accepts it (one digit 1 to 5), else undefined. */
export function parseMinRating(v: string | undefined): number | undefined {
  return v !== undefined && /^[1-5]$/.test(v) ? Number(v) : undefined;
}
