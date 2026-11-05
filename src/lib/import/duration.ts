/** ISO-8601 duration ("PT1H30M", "P0DT45M", "P1DT2H", "P1W") to whole minutes; null if invalid. */
export function isoDurationToMinutes(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const m =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      input.trim(),
    );
  if (!m || input.trim().length <= 1 || /T$/i.test(input.trim())) return null;
  const [w, d, h, min, sec] = m.slice(1).map((x) => (x === undefined ? 0 : parseFloat(x)));
  const total = w! * 7 * 1440 + d! * 1440 + h! * 60 + min! + sec! / 60;
  const rounded = Math.round(total);
  return Number.isFinite(rounded) && rounded >= 0 && rounded <= 100_000 ? rounded : null;
}
