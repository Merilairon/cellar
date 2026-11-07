import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import type { RecipeInput } from '@/lib/recipes/schemas';
import { hydrated } from './helpers';

// Shared by the T10 specs (mouse, keyboard, phone, misc). No test lives here.

const cookieSection = SAMPLE_SKILLET_COOKIES.sections[0];

/**
 * Start state of the "from scratch" recreation (UX spec F1, tasklist Q5): a grid recipe needs at
 * least one column step, so it opens with the first `rows` ingredient rows of the Mocha Skillet
 * Cookie and exactly ONE column step ("Step 1") spanning row 1. Everything else of the sample
 * (the other spans, labels, details, temperatures, both top banners, and with `rows = 8` the
 * ninth row) has to be created in the editor.
 */
export function cookieStart(rows: 8 | 9, title: string): RecipeInput {
  return {
    ...SAMPLE_SKILLET_COOKIES,
    title,
    sections: [
      {
        title: null,
        ingredients: cookieSection.ingredients.slice(0, rows),
        steps: [
          {
            kind: 'column',
            label: 'Step 1',
            detail: 'Placeholder text.',
            row_start: 0,
            row_end: 0,
          },
        ],
      },
    ],
  };
}

/** The column steps of the sample, in column order, as the editor has to produce them. */
export const COOKIE_COLUMNS = cookieSection.steps.filter((s) => s.kind === 'column');
export const COOKIE_BANNERS_TOP = cookieSection.steps.filter((s) => s.kind === 'banner_top');
export const NINTH_ROW_TEXT = '1 cup (170 g) dark chocolate chunks';

type Stored = {
  sections: {
    title: string | null;
    ingredients: Record<string, unknown>[];
    steps: Record<string, unknown>[];
  }[];
};

/** Structure that must survive a save: ids and positions removed, split groups by first use. */
export function project(r: {
  sections: {
    title?: string | null;
    ingredients: Record<string, unknown>[];
    steps: Record<string, unknown>[];
  }[];
}) {
  return r.sections.map((s) => {
    const groups: string[] = [];
    return {
      title: s.title ?? null,
      ingredients: s.ingredients.map((i) => {
        const g = (i.split_group_id as string | null | undefined) ?? null;
        if (g && !groups.includes(g)) groups.push(g);
        return {
          name: i.name,
          note: i.note ?? null,
          raw_text: i.raw_text ?? null,
          group: g ? groups.indexOf(g) : null,
          portion_label: i.portion_label ?? null,
        };
      }),
      steps: s.steps.map((st: Record<string, unknown>) => ({
        kind: st.kind,
        label: st.label,
        detail: st.detail,
        row_start: st.row_start ?? null,
        row_end: st.row_end ?? null,
        temp_c: st.temp_c ?? null,
        temp_f: st.temp_f ?? null,
        minutes_min: st.minutes_min ?? null,
        minutes_max: st.minutes_max ?? null,
      })),
    };
  });
}

export async function fetchRecipe(ctx: BrowserContext, id: string) {
  const res = await ctx.request.get(`/api/recipes/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Stored & { updated_at: string; view_mode: string };
}

/** A fresh context signed in as the owner, opened on the recipe page. */
export async function openRecipe(
  browser: Browser,
  owner: BrowserContext,
  id: string,
  opts: { width: number; height: number; touch?: boolean },
) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    hasTouch: opts.touch,
    reducedMotion: 'reduce',
    storageState: await owner.storageState(),
  });
  const page = await ctx.newPage();
  await page.goto(`/recipes/${id}`);
  await hydrated(page.getByRole('button', { name: 'Edit grid' }));
  return { page, ctx };
}

export const rowTargets = (page: Page) => page.locator('[data-ge-target^="row:"]');
export const saveButton = (page: Page) =>
  page.getByRole('button', { name: /^Save changes|^Saving/ });
export const panel = (page: Page) => page.locator('[data-ge-panel]');
