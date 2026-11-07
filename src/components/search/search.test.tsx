import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { ResultsStatus } from './ResultsStatus';
import {
  createDebouncer,
  firstParam,
  listHref,
  queryToApply,
  SEARCH_DEBOUNCE_MS,
  syncFromUrl,
  toggleTagHref,
} from './search-url';
import { SearchBox } from './SearchBox';
import { TagFilter } from './TagFilter';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/recipes',
  useSearchParams: () => new URLSearchParams('q=espresso'),
}));

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

afterEach(() => vi.useRealTimers());

describe('search-url', () => {
  it('builds a stable href without empty filters', () => {
    expect(listHref({})).toBe('/recipes');
    expect(listHref({ tag: 'dessert', q: ' a b ', author: '' })).toBe('/recipes?q=a+b&tag=dessert');
  });
  it('toggles a tag and keeps the query', () => {
    expect(toggleTagHref({ q: 'x' }, 'pie')).toBe('/recipes?q=x&tag=pie');
    expect(toggleTagHref({ q: 'x', tag: 'pie' }, 'pie')).toBe('/recipes?q=x');
  });
  it('applies nothing below 2 characters, clears on empty', () => {
    expect(queryToApply('a')).toBeUndefined();
    expect(queryToApply(' a ')).toBeUndefined();
    expect(queryToApply('')).toBe('');
    expect(queryToApply('  ')).toBe('');
    expect(queryToApply(' es ')).toBe('es');
  });
  it('takes the first search param value', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('  ')).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe('syncFromUrl', () => {
  const st = (seenUrlQ: string, value: string, pending: string[] = []) => ({
    seenUrlQ,
    value,
    pending,
  });
  it('typed-during-navigation: ab is requested, c is typed, the ab URL lands, abc is kept', () => {
    // user typed "ab", debounce fired (pending ["ab"]), then typed "c" while the server renders
    const landed = syncFromUrl(st('', 'abc', ['ab']), 'ab');
    expect(landed.value).toBe('abc');
    expect(landed.seenUrlQ).toBe('ab');
    expect(landed.pending).toEqual([]);
  });
  it('an older echo does not clobber when a newer request is still in flight', () => {
    const a = syncFromUrl(st('', 'abcd', ['ab', 'abc']), 'ab');
    expect(a.value).toBe('abcd');
    expect(a.pending).toEqual(['abc']);
    const b = syncFromUrl(a, 'abc');
    expect(b.value).toBe('abcd');
    expect(b.pending).toEqual([]);
  });
  it('back/forward (a URL we did not request) is followed', () => {
    expect(syncFromUrl(st('ab', 'abc'), 'x')).toEqual(st('x', 'x'));
    expect(syncFromUrl(st('ab', 'ab', ['abc']), '')).toEqual(st('', ''));
  });
  it('an unchanged URL changes nothing', () => {
    const s = st('ab', 'abc', ['abc']);
    expect(syncFromUrl(s, 'ab')).toBe(s);
  });
  it('clearing (Escape) lands on the empty URL and keeps the empty input', () => {
    expect(syncFromUrl(st('ab', '', ['']), '')).toEqual(st('', '', []));
  });
});

describe('createDebouncer', () => {
  it('fires once per pause', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(fn, SEARCH_DEBOUNCE_MS);
    for (let i = 0; i < 5; i++) {
      d.call();
      vi.advanceTimersByTime(100);
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('flush runs immediately and cancels the pending call; cancel drops it', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createDebouncer(fn, SEARCH_DEBOUNCE_MS);
    d.call();
    d.flush();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('SearchBox', () => {
  it('is a labelled search landmark seeded from ?q=', () => {
    const html = wrap(<SearchBox />);
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-label="Recipe search"');
    expect(html).toContain('<label for="header-search" class="sr-only">Search recipes</label>');
    expect(html).toContain('value="espresso"');
  });
});

describe('TagFilter', () => {
  const tags = [
    { name: 'dessert', count: 2 },
    { name: '<b>x</b>', count: 1 },
  ];
  it('renders links, marks the active one and offers clear', () => {
    const html = wrap(<TagFilter tags={tags} filters={{ q: 'cake', tag: 'dessert' }} />);
    expect(html).toContain('href="/recipes?q=cake"'); // active chip toggles off
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('Clear tag filter');
    expect(html).toContain('href="/recipes?q=cake&amp;tag=%3Cb%3Ex%3C%2Fb%3E"');
    expect(html).not.toContain('<b>x</b>');
  });
  it('renders nothing without tags or filter', () => {
    expect(wrap(<TagFilter tags={[]} filters={{}} />)).toBe('');
  });
  it('keeps an active tag with no readable recipes', () => {
    expect(wrap(<TagFilter tags={[]} filters={{ tag: 'gone' }} />)).toContain('gone');
  });
});

describe('ResultsStatus', () => {
  it('announces the count via a polite live region', () => {
    const html = wrap(<ResultsStatus count={1} filters={{ q: 'espresso' }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('1 recipe found');
    expect(wrap(<ResultsStatus count={3} filters={{ q: 'e' }} />)).toContain('3 recipes found');
  });
  it('shows an escaped no-results state with a clear link', () => {
    const html = wrap(<ResultsStatus count={0} filters={{ q: '<i>pie</i>' }} />);
    expect(html).toContain('No recipes found');
    expect(html).toContain('&lt;i&gt;pie&lt;/i&gt;');
    expect(html).not.toContain('<i>pie');
    expect(html).toContain('href="/recipes"');
  });
  it('is silent and has no empty state when unfiltered', () => {
    const html = wrap(<ResultsStatus count={0} filters={{}} />);
    expect(html).not.toContain('No recipes found');
    expect(html).not.toContain('found');
  });
});
