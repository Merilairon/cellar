// Pure helpers for the search/tag query string and the debounce used by the header search box.

export const MIN_SEARCH_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 250;

export type ListFilters = { q?: string; tag?: string; author?: string };

/** `/recipes` plus only the non-empty filters, in a stable order. */
export function listHref(filters: ListFilters): string {
  const p = new URLSearchParams();
  for (const key of ['q', 'tag', 'author'] as const) {
    const v = filters[key]?.trim();
    if (v) p.set(key, v);
  }
  const qs = p.toString();
  return qs ? `/recipes?${qs}` : '/recipes';
}

/** Link target for a tag chip: clicking the active tag removes it. */
export function toggleTagHref(filters: ListFilters, tag: string): string {
  return listHref({ ...filters, tag: filters.tag === tag ? undefined : tag });
}

/** What typing `raw` should do to `?q=`: undefined = nothing yet, '' = clear, string = set. */
export function queryToApply(raw: string): string | undefined {
  const v = raw.trim();
  if (v === '') return '';
  return [...v].length >= MIN_SEARCH_CHARS ? v : undefined;
}

export function createDebouncer(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    call() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      cancel();
      fn();
    },
    cancel,
  };
}

/** First value of a Next `searchParams` entry (arrays collapse to the first). */
export function firstParam(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s.trim() === '' ? undefined : s.trim();
}
