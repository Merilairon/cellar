import { starFill } from './rating-format';

export const STAR_PATH =
  'M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6L2.5 9.5l6.6-.8z';

/** One decorative star: outline plus a filled overlay clipped to `fill` (0..1). */
function StarGlyph({ fill }: { fill: number }) {
  const svg = (filled: boolean) => (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d={STAR_PATH} />
    </svg>
  );
  return (
    <span className="relative inline-block size-4">
      <span className="text-[var(--md-star-empty)]">{svg(false)}</span>
      <span
        className="absolute inset-0 overflow-hidden text-[var(--md-star)]"
        style={{ width: `${Math.round(fill * 100)}%` }}
      >
        {svg(true)}
      </span>
    </span>
  );
}

/** The five-star row of the summary; visual only. */
export function StarRow({ avg }: { avg: number | null }) {
  return (
    <span aria-hidden="true" className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <StarGlyph key={i} fill={starFill(avg, i)} />
      ))}
    </span>
  );
}

/** The single star on cards; decorative. */
export function OneStar() {
  return (
    <span aria-hidden="true">
      <StarGlyph fill={1} />
    </span>
  );
}
