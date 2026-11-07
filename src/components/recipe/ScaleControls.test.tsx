import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import { apiFromInput } from './fixtures';
import { IngredientCell, type QuantityDisplay } from './IngredientCell';
import { RecipeGrid } from './RecipeGrid';
import { RecipeList } from './RecipeList';
import { parseCustomAmount, ScaleControls, type ScaleState } from './ScaleControls';
import { customFactorFor, enterCustom, summaryKind, typeCustom } from './scale-input';
import { MAX_FACTOR, MIN_FACTOR } from '@/lib/units/scale';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const text = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const butter = {
  id: 'i1',
  position: 0,
  name: 'unsalted butter',
  note: null,
  portion_label: null,
  group_label: null,
  metric_qty: 115,
  metric_qty_max: null,
  metric_unit: 'g',
  us_qty: 4,
  us_qty_max: null,
  us_unit: 'oz',
  display_primary: 'us' as const,
};
const cell = (display?: QuantityDisplay) =>
  text(wrap(<IngredientCell ingredient={butter as never} display={display} />));

describe('IngredientCell', () => {
  it('4 oz butter shows 115 g (4 oz) on a metric preference', () => {
    expect(cell({ pref: 'metric', scale: 1, toggle: null })).toBe('115 g (4 oz) unsalted butter');
  });
  it('x2 shows 8 oz (230 g) on a US preference and 230 g (8 oz) on metric', () => {
    expect(cell({ pref: 'us', scale: 2, toggle: null })).toBe('8 oz (230 g) unsalted butter');
    expect(cell({ pref: 'metric', scale: 2, toggle: null })).toBe('230 g (8 oz) unsalted butter');
  });
  it('the per-recipe toggle wins over the preference', () => {
    expect(cell({ pref: 'metric', scale: 1, toggle: 'us' })).toBe('4 oz (115 g) unsalted butter');
  });
  it('without display it shows the recipe as written', () => {
    expect(cell()).toBe('4 oz (115 g) unsalted butter');
  });
  it('marks a fractional count with a visible and a spoken approx marker', () => {
    const egg = {
      ...butter,
      name: 'egg',
      metric_qty: 3,
      metric_unit: null,
      us_qty: null,
      us_unit: null,
    };
    const html = wrap(
      <IngredientCell
        ingredient={egg as never}
        display={{ pref: 'metric', scale: 1.5, toggle: null }}
      />,
    );
    expect(html).toContain('aria-hidden="true">≈ </span>');
    expect(html).toContain('<span class="sr-only">about </span>');
    expect(text(html)).toBe('≈ 4½ egg');
  });
});

describe('scaling leaves steps, times and temperatures alone', () => {
  const api = apiFromInput(SAMPLE_SKILLET_COOKIES);
  const stepsOnly = (html: string) =>
    html
      .replace(/<span class="rg-qty">.*?<\/span> /g, '')
      .replace(/<(?:th|li)[^>]*>.*?<\/(?:th|li)>/g, '');
  const at = (scale: number) => ({ pref: 'us' as const, scale, toggle: null });
  it('grid', () => {
    const a = wrap(<RecipeGrid sections={api.sections} recipeTitle="t" display={at(1)} />);
    const b = wrap(<RecipeGrid sections={api.sections} recipeTitle="t" display={at(3)} />);
    expect(a).not.toBe(b);
    expect(stepsOnly(a)).toBe(stepsOnly(b));
    expect(b).toContain('table');
  });
  it('list scales ingredients too', () => {
    const a = wrap(<RecipeList sections={api.sections} display={at(1)} />);
    const b = wrap(<RecipeList sections={api.sections} display={at(2)} />);
    expect(a).not.toBe(b);
    expect(text(b)).toContain('8 oz (230 g) unsalted butter');
  });
});

describe('parseCustomAmount', () => {
  it.each([
    ['2', 2],
    ['1,5', 1.5],
    ['1.5', 1.5],
    [' .5 ', 0.5],
    ['0', null],
    ['-1', null],
    ['', null],
    ['abc', null],
    ['1e3', null],
    ['1/2', null],
    ['1,000', null],
    ['12,345', null],
    ['1,000.5', null],
    ['1.000,5', null],
    ['1,2,3', null],
    ['0,125', 0.125],
    ['1,50', 1.5],
    ['1.000', 1],
  ])('%j -> %s', (s, n) => expect(parseCustomAmount(s)).toBe(n));
});

describe('ScaleControls markup', () => {
  const state = (o: Partial<ScaleState> = {}): ScaleState =>
    ({
      display: { pref: 'metric', scale: 1, toggle: null },
      factor: 1,
      preset: 'one',
      customText: '',
      customError: false,
      primary: 'metric',
      changed: false,
      choose: () => {},
      setCustom: () => {},
      flip: () => {},
      reset: () => {},
      ...o,
    }) as ScaleState;
  it('renders pressed presets, a polite live region and a toggle label', () => {
    const html = wrap(<ScaleControls scale={state()} servings={4} />);
    expect(html).toContain('aria-pressed="true">1x</button>');
    expect(html).toContain('aria-pressed="false">1/2x</button>');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('Show in US units');
    expect(html).toContain('Showing the original amounts.');
  });
  it('custom is a servings target when servings is set, a multiplier otherwise', () => {
    const custom = state({ preset: 'custom', customText: '6', factor: 1.5 });
    const withServings = wrap(<ScaleControls scale={custom} servings={4} />);
    expect(withServings).toContain('>Servings</label>');
    expect(withServings).toContain('serves 6');
    const without = wrap(<ScaleControls scale={custom} servings={null} />);
    expect(without).toContain('>Multiplier</label>');
    expect(without).not.toContain('serves');
  });
  it('announces an invalid custom value', () => {
    const html = wrap(
      <ScaleControls
        scale={state({ preset: 'custom', customText: '0', customError: true })}
        servings={null}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
  });
});

describe('custom scale state', () => {
  it('opening Custom keeps the factor on screen and empties the field', () => {
    expect(enterCustom(2)).toEqual({ text: '', factor: 2 });
  });
  it('a valid value is applied, an invalid one keeps the last applied factor', () => {
    let st = enterCustom(2);
    st = typeCustom(st, '3', null);
    expect(st).toEqual({ text: '3', factor: 3 });
    st = typeCustom(st, 'abc', null);
    expect(st).toEqual({ text: 'abc', factor: 3 });
    st = typeCustom(st, '1,000', null);
    expect(st.factor).toBe(3);
  });
  it('servings target divides by the recipe servings and enforces both bounds', () => {
    expect(customFactorFor('6', 4)).toBe(1.5);
    expect(customFactorFor('1000', null)).toBeNull();
    expect(customFactorFor('0.001', null)).toBeNull();
    expect(customFactorFor(String(MAX_FACTOR), null)).toBe(MAX_FACTOR);
  });
  it('the error message names the bounds it enforces', () => {
    expect(MIN_FACTOR).toBe(1 / 100);
    expect(messages.recipe.scale.invalid).toContain('1/100');
    expect(messages.recipe.scale.invalid).toContain('{max}');
  });
  it('picks the live-region sentence', () => {
    expect(summaryKind({ factor: 1, customError: false, servings: 4 })).toBe('original');
    expect(summaryKind({ factor: 2, customError: false, servings: 4 })).toBe('servings');
    expect(summaryKind({ factor: 2, customError: false, servings: null })).toBe('factor');
    expect(summaryKind({ factor: 2, customError: true, servings: 4 })).toBe('invalid');
  });
  it('announces the unit system after a flip and an invalid value in the live region', () => {
    const flipped = wrap(
      <ScaleControls
        scale={{
          display: { pref: 'metric', scale: 1, toggle: 'us' },
          factor: 1,
          preset: 'one',
          customText: '',
          customError: false,
          primary: 'us',
          changed: true,
          choose: () => {},
          setCustom: () => {},
          flip: () => {},
          reset: () => {},
        }}
        servings={4}
      />,
    );
    expect(text(flipped)).toContain('Showing the original amounts. Units: US.');
    const bad = wrap(
      <ScaleControls
        scale={{
          display: { pref: 'metric', scale: 2, toggle: null },
          factor: 2,
          preset: 'custom',
          customText: 'x',
          customError: true,
          primary: 'metric',
          changed: true,
          choose: () => {},
          setCustom: () => {},
          flip: () => {},
          reset: () => {},
        }}
        servings={null}
      />,
    );
    expect(text(bad)).toContain('Not a valid amount. Amounts stay at 2x.');
  });
});
