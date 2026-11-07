'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createDebouncer, listHref, queryToApply, SEARCH_DEBOUNCE_MS } from './search-url';

/** Header search. The query lives in the URL (`?q=`); typing updates it after a pause. */
export function SearchBox() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const onList = pathname === '/recipes';

  const [value, setValue] = useState(urlQ);
  const [seenUrlQ, setSeenUrlQ] = useState(urlQ);
  if (urlQ !== seenUrlQ) {
    // Back/forward or a "clear" link changed the URL: follow it.
    setSeenUrlQ(urlQ);
    setValue(urlQ);
  }

  const latest = useRef({
    value,
    urlQ,
    onList,
    tag: params.get('tag'),
    author: params.get('author'),
  });
  useEffect(() => {
    latest.current = { value, urlQ, onList, tag: params.get('tag'), author: params.get('author') };
  });

  const debouncerRef = useRef<ReturnType<typeof createDebouncer> | null>(null);
  useEffect(() => {
    const d = createDebouncer(() => {
      const s = latest.current;
      const next = queryToApply(s.value);
      if (next === undefined || next === s.urlQ) return;
      if (next === '' && !s.onList) return;
      router.replace(
        listHref({
          q: next,
          tag: s.onList ? (s.tag ?? undefined) : undefined,
          author: s.onList ? (s.author ?? undefined) : undefined,
        }),
      );
    }, SEARCH_DEBOUNCE_MS);
    debouncerRef.current = d;
    return () => d.cancel();
  }, [router]);

  return (
    <form
      role="search"
      aria-label={t('search.landmark')}
      action="/recipes"
      method="get"
      className="order-last w-full md:order-none md:w-64"
      onSubmit={(e) => {
        e.preventDefault();
        debouncerRef.current?.cancel();
        const v = value.trim();
        const s = latest.current;
        router.push(
          listHref({
            q: v,
            tag: s.onList ? (s.tag ?? undefined) : undefined,
            author: s.onList ? (s.author ?? undefined) : undefined,
          }),
        );
      }}
    >
      <label htmlFor="header-search" className="sr-only">
        {t('search.label')}
      </label>
      <input
        id="header-search"
        name="q"
        type="search"
        autoComplete="off"
        maxLength={100}
        value={value}
        placeholder={t('search.placeholder')}
        onChange={(e) => {
          setValue(e.target.value);
          // `latest` is refreshed in an effect; make the pending call see this keystroke.
          latest.current = { ...latest.current, value: e.target.value };
          debouncerRef.current?.call();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value !== '') {
            e.preventDefault();
            setValue('');
            latest.current = { ...latest.current, value: '' };
            debouncerRef.current?.flush();
          }
        }}
        className="min-h-11 w-full rounded border border-neutral-500 bg-transparent px-3 dark:bg-neutral-900"
      />
    </form>
  );
}
