import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { apiFromInput } from './fixtures';
import { RecipeGrid, type RecipeGridProps } from './RecipeGrid';
import { RecipeList } from './RecipeList';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

const grid = (r: typeof SAMPLE_SKILLET_COOKIES, extra: Partial<RecipeGridProps> = {}) => {
  const api = apiFromInput(r);
  return wrap(<RecipeGrid sections={api.sections} recipeTitle={api.title} {...extra} />);
};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('RecipeGrid: single-section sample (reference structure)', () => {
  const html = grid(SAMPLE_SKILLET_COOKIES);

  it('is one real table with two banner rows and 9 ingredient rows', () => {
    expect(count(html, /<table/g)).toBe(1);
    expect(count(html, /<td colSpan="6" class="rg-banner"/gi)).toBe(2);
    expect(count(html, /<th scope="row"/g)).toBe(9);
  });
  it('places one spanning cell per column step: rowspans 1/4/5/9/9', () => {
    const spans = [...html.matchAll(/rowSpan="(\d+)"/gi)].map((m) => Number(m[1]));
    expect(spans).toEqual([1, 4, 5, 9, 9]);
  });
  it('has column headers per step and a caption', () => {
    expect(count(html, /<th scope="col"/g)).toBe(6); // ingredient + 5 steps
    expect(html).toContain('<caption');
    expect(html).toContain('Step 5: bake');
  });
  it('shows the reference params string on the last step', () => {
    expect(html).toContain('350°F (170°C)');
    expect(html).toContain('30 to 40 min');
  });
  it('makes every step cell keyboard reachable: one button per step', () => {
    expect(count(html, /<button type="button" class="rg-stepbtn"/g)).toBe(5);
    expect(html).toMatch(/role="region"[^>]*tabindex="0"|tabindex="0"[^>]*role="region"/i);
  });
  it('shows dual units with the other system in parentheses', () => {
    expect(html).toContain('4 oz (115 g)');
  });
  it('keeps empty cells where no step reaches: 8 + 5 + 4 + 0 + 0', () => {
    expect(count(html, /class="rg-empty"/g)).toBe(17);
  });
  it('toggles detail with aria-expanded and renders the panel inline', () => {
    const open = grid(SAMPLE_SKILLET_COOKIES, { expandedStepId: 's0t6' });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('Bake until the edges are set');
    expect(html).not.toContain('Bake until the edges are set');
    expect(count(html, /aria-expanded="false"/g)).toBe(5);
  });
  it('announces a dialog popup instead in sheet mode', () => {
    const sheet = grid(SAMPLE_SKILLET_COOKIES, { detailMode: 'sheet', expandedStepId: 's0t6' });
    expect(sheet).toContain('aria-haspopup="dialog"');
    expect(sheet).not.toContain('aria-expanded');
    expect(sheet).not.toContain('Bake until the edges are set');
  });
});

describe('RecipeGrid: two-section sample', () => {
  const html = grid(SAMPLE_VANILLA_CAKE);
  it('renders one table per section with section headings', () => {
    expect(count(html, /<table/g)).toBe(2);
    expect(html).toContain('>Cake<');
    expect(html).toContain('>Frosting<');
  });
  it('shows the split ingredient as two labelled rows', () => {
    expect(html).toContain('(half)');
    expect(html).toContain('(remaining)');
  });
  it('puts the bottom banner after the last ingredient row of its table', () => {
    const second = html.split('<table')[2];
    const lastRow = second.lastIndexOf('<th scope="row"');
    const banner = second.indexOf('rg-banner', lastRow);
    expect(banner).toBeGreaterThan(lastRow);
    expect(second).toContain('Chill 15 minutes');
  });
});

describe('RecipeList', () => {
  it('lists every ingredient and a numbered list of step details', () => {
    const api = apiFromInput(SAMPLE_SKILLET_COOKIES);
    const html = wrap(<RecipeList sections={api.sections} />);
    expect(count(html, /<li class="my-1">/g)).toBe(9 + 7);
    expect(html).toContain('<ol');
    expect(html).toContain('Melt the butter');
  });
  it('works for list recipes (no spans), falling back to the label without a detail', () => {
    const r = structuredClone(SAMPLE_SKILLET_COOKIES);
    for (const st of r.sections[0].steps) {
      st.row_start = null;
      st.row_end = null;
    }
    r.sections[0].steps[2].detail = '';
    const api = apiFromInput({ ...r, view_mode: 'list' });
    const html = wrap(<RecipeList sections={api.sections} />);
    expect(html).toContain('>melt<');
  });
  it('renders two sections with headings', () => {
    const api = apiFromInput(SAMPLE_VANILLA_CAKE);
    const html = wrap(<RecipeList sections={api.sections} />);
    expect(html).toContain('>Cake<');
    expect(html).toContain('>Frosting<');
    expect(count(html, /<ol/g)).toBe(2);
  });
});
