import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { Notes, type Note } from '../notes/Notes';
import { RecipeGrid } from '../RecipeGrid';
import { PrintButton } from './PrintButton';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

const cols = (html: string) => /data-cols="(\d+)"/.exec(html)?.[1];
const gridOf = (r: Parameters<typeof apiFromInput>[0]) => {
  const api = apiFromInput(r);
  return wrap(<RecipeGrid sections={api.sections} recipeTitle={api.title} />);
};

describe('data-cols on the grid root (G11)', () => {
  it('is the largest number of column steps in any section', () => {
    expect(cols(gridOf(SAMPLE_SKILLET_COOKIES))).toBe('5');
    expect(cols(gridOf(SAMPLE_VANILLA_CAKE))).toBe('5'); // Cake 5, Frosting 2: the max, not the sum
  });

  it('counts column steps only, never banners', () => {
    const api = apiFromInput(SAMPLE_SKILLET_COOKIES);
    const bannersOnly = api.sections.map((s) => ({
      ...s,
      steps: s.steps.filter((st) => st.kind !== 'column'),
    }));
    expect(cols(wrap(<RecipeGrid sections={bannersOnly} recipeTitle="x" />))).toBe('0');
  });
});

describe('PrintButton', () => {
  const html = wrap(<PrintButton />);
  it('is a real button described by the landscape hint, hidden on paper', () => {
    expect(html).toMatch(/<button type="button"[^>]*aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Print');
    expect(html).toContain('Landscape fits the grid on one page.');
    expect(html).toContain('print:hidden');
  });
  it('shows the hint from 640px up and keeps it reachable below', () => {
    expect(html).toMatch(/class="[^"]*sr-only sm:not-sr-only/);
  });
});

describe('Notes print option (G12)', () => {
  const note = (over: Partial<Note>): Note => ({
    id: 'n1',
    body: 'More salt next time',
    shared: false,
    author: 'Ann',
    mine: true,
    created_at: '2026-01-02T10:00:00.000Z',
    updated_at: '2026-01-02T10:00:00.000Z',
    ...over,
  });
  const render = (notes: Note[]) =>
    wrap(<Notes recipeId="r1" canManage={false} initialNotes={notes} />);

  it('offers the unchecked checkbox only when the viewer has a visible note', () => {
    const some = render([note({})]);
    expect(some).toContain('Include notes when printing');
    expect(some).toMatch(/<input id="[^"]+" type="checkbox"[^>]*class="size-5"/);
    expect(some).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(render([])).not.toContain('Include notes when printing');
  });

  it('prints nothing about notes while the option is off, and hides the live section on paper', () => {
    const html = render([note({})]);
    expect(html).not.toContain('data-print-notes');
    expect(html).toMatch(/<section[^>]*class="[^"]*print:hidden/);
  });
});
