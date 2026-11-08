import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { RecipeGrid } from '../RecipeGrid';
import { CookList } from './CookList';
import { browserHistoryEnv, createCookHistory, resetCookHistorySkips } from './cook-history';
import { cookProgress, cookTotals, ingredientKey, stepKey, toggleKey } from './cook-state';
import { createWakeLock, type WakeApi, type WakeStatus } from './wake-lock';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

/** A stub `navigator.wakeLock`: every request returns a sentinel we can release by hand. */
function stub() {
  const sentinels: { released: boolean; fire: () => void }[] = [];
  const api: WakeApi & { fail?: boolean } = {
    request: vi.fn(async () => {
      if (api.fail) throw new Error('NotAllowedError');
      const listeners: (() => void)[] = [];
      const s = {
        released: false,
        fire() {
          s.released = true;
          listeners.forEach((l) => l());
        },
        release: async () => {
          s.released = true;
        },
        addEventListener: (_t: 'release', fn: () => void) => listeners.push(fn),
      };
      sentinels.push(s);
      return s;
    }),
  };
  return { api, sentinels };
}

function lock(api: WakeApi | undefined, visible = { v: true }) {
  const statuses: WakeStatus[] = [];
  const l = createWakeLock({
    api: () => api,
    visible: () => visible.v,
    onStatus: (s) => statuses.push(s),
  });
  return { l, statuses, visible };
}

describe('wake lock controller (stubbed navigator.wakeLock)', () => {
  it('requests on enter and reports on', async () => {
    const { api, sentinels } = stub();
    const { l, statuses } = lock(api);
    await l.acquire();
    expect(api.request).toHaveBeenCalledWith('screen');
    expect(sentinels).toHaveLength(1);
    expect(statuses).toEqual(['on']);
  });
  it('does not request twice while a lock is held', async () => {
    const { api } = stub();
    const { l } = lock(api);
    await l.acquire();
    await l.onVisibilityChange();
    await l.acquire();
    expect(api.request).toHaveBeenCalledTimes(1);
  });
  it('re-requests when the page becomes visible after the browser released the lock', async () => {
    const { api, sentinels } = stub();
    const { l, visible } = lock(api);
    await l.acquire();
    visible.v = false;
    sentinels[0].fire(); // the browser drops the lock when the page is hidden
    l.onVisibilityChange(); // hidden: nothing to do
    expect(api.request).toHaveBeenCalledTimes(1);
    visible.v = true;
    l.onVisibilityChange();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  });
  it('releases on exit and a late grant is released at once', async () => {
    const { api, sentinels } = stub();
    const { l } = lock(api);
    await l.acquire();
    l.release();
    expect(sentinels[0].released).toBe(true);
    await l.acquire(); // after release nothing is requested
    expect(api.request).toHaveBeenCalledTimes(1);

    const late = stub();
    const second = lock(late.api);
    const pending = second.l.acquire();
    second.l.release(); // exit while the request is in flight
    await pending;
    expect(late.sentinels[0].released).toBe(true);
    expect(second.statuses).toEqual([]);
  });
  it('reports unsupported when the API is missing (insecure context) and never throws', async () => {
    const { l, statuses } = lock(undefined);
    await expect(l.acquire()).resolves.toBeUndefined();
    expect(statuses).toEqual(['unsupported']);
    expect(() => l.release()).not.toThrow();
  });
  it('reports failed when the request is rejected, and a throwing getter is unsupported', async () => {
    const { api } = stub();
    api.fail = true;
    const a = lock(api);
    await a.l.acquire();
    expect(a.statuses).toEqual(['failed']);
    const b: WakeStatus[] = [];
    const l = createWakeLock({
      api: () => {
        throw new Error('boom');
      },
      visible: () => true,
      onStatus: (s) => b.push(s),
    });
    await l.acquire();
    expect(b).toEqual(['unsupported']);
  });
  it('does not request while the page is hidden', async () => {
    const { api } = stub();
    const { l } = lock(api, { v: false });
    await l.acquire();
    expect(api.request).not.toHaveBeenCalled();
  });
  it('swallows a rejecting release()', async () => {
    const api: WakeApi = {
      request: async () => ({ release: () => Promise.reject(new Error('x')) }),
    };
    const { l } = lock(api);
    await l.acquire();
    expect(() => l.release()).not.toThrow();
    await Promise.resolve();
  });
});

describe('cook state keys (G6)', () => {
  const api = apiFromInput(SAMPLE_VANILLA_CAKE);
  it('keys are indexes, never ids', () => {
    for (const k of [ingredientKey(1, 2), stepKey(0, 3)]) {
      expect(k).toMatch(/^[is]:\d+:\d+$/);
    }
    const ids = api.sections.flatMap((s) => [
      ...s.ingredients.map((i) => i.id),
      ...s.steps.map((x) => x.id),
    ]);
    expect(ids.length).toBeGreaterThan(0);
  });
  it('toggles without mutating and counts progress', () => {
    const a = new Set<string>();
    const b = toggleKey(a, ingredientKey(0, 0));
    expect(a.size).toBe(0);
    const c = toggleKey(toggleKey(b, stepKey(0, 1)), ingredientKey(0, 1));
    expect(cookProgress(c)).toEqual({ ingredients: 2, steps: 1 });
    expect(toggleKey(c, stepKey(0, 1)).has(stepKey(0, 1))).toBe(false);
    const totals = cookTotals(api.sections);
    expect(totals.ingredients).toBe(api.sections.reduce((n, x) => n + x.ingredients.length, 0));
  });
});

describe('cook history (one entry, Back closes)', () => {
  beforeEach(() => resetCookHistorySkips());
  function fake() {
    let href = '/r';
    const pushed: string[] = [];
    let backs = 0;
    const env = {
      push: () => {
        href = '/r#cook';
        pushed.push(href);
      },
      back: () => {
        backs += 1;
        href = '/r';
      },
      href: () => href,
    };
    return { env, pushed, backs: () => backs };
  }
  it('Close/Escape go through back(); the popstate closes once', () => {
    const f = fake();
    const onClose = vi.fn();
    const h = createCookHistory(f.env, onClose);
    h.open();
    h.request();
    expect(f.backs()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
    h.pop();
    expect(onClose).toHaveBeenCalledTimes(1);
    h.pop(); // a stray second popstate does nothing
    expect(onClose).toHaveBeenCalledTimes(1);
    h.detach();
    expect(f.backs()).toBe(1); // the entry is already gone: no extra back()
  });
  it('browser Back closes directly', () => {
    const f = fake();
    const onClose = vi.fn();
    const h = createCookHistory(f.env, onClose);
    h.open();
    h.pop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('unmount while the entry is on top removes it and swallows its own popstate', () => {
    const f = fake();
    const onClose = vi.fn();
    const h = createCookHistory(f.env, onClose);
    h.open();
    h.detach();
    expect(f.backs()).toBe(1);
    h.pop();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('does not go back when the URL already moved on', () => {
    const f = fake();
    const h = createCookHistory(f.env, () => {});
    h.open();
    f.env.back = () => {
      throw new Error('must not be called');
    };
    f.env.href = () => '/elsewhere';
    expect(() => h.detach()).not.toThrow();
  });
  it('the browser env targets window.history without a url', () => {
    expect(typeof browserHistoryEnv.push).toBe('function');
  });
});

describe('RecipeGrid additive props (R7)', () => {
  const api = apiFromInput(SAMPLE_SKILLET_COOKIES);
  const base = wrap(<RecipeGrid sections={api.sections} recipeTitle={api.title} />);

  it('default markup has no cook hooks and equals an explicit stepTarget cell', () => {
    expect(base).not.toContain('ck-');
    expect(base).not.toContain('<label');
    expect(base).not.toContain('<input');
    expect(
      wrap(<RecipeGrid sections={api.sections} recipeTitle={api.title} stepTarget="cell" />),
    ).toBe(base);
  });
  it('stepTarget button alone does not change the markup either (handlers are not markup)', () => {
    expect(
      wrap(<RecipeGrid sections={api.sections} recipeTitle={api.title} stepTarget="button" />),
    ).toBe(base);
  });
  it('lead slots render a checkbox per ingredient row and per step and banner', () => {
    const html = wrap(
      <RecipeGrid
        sections={api.sections}
        recipeTitle={api.title}
        stepTarget="button"
        renderIngredientLead={({ sectionIndex, rowIndex }) => (
          <input type="checkbox" data-k={ingredientKey(sectionIndex, rowIndex)} />
        )}
        renderStepLead={({ sectionIndex, stepIndex }) => (
          <input type="checkbox" data-k={stepKey(sectionIndex, stepIndex)} />
        )}
      />,
    );
    const keys = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1]);
    const section = api.sections[0];
    expect(keys.filter((k) => k.startsWith('i:'))).toHaveLength(section.ingredients.length);
    // Every step (columns and banners) got a distinct, in-range index.
    const stepKeys = keys.filter((k) => k.startsWith('s:'));
    expect(new Set(stepKeys).size).toBe(section.steps.length);
    for (const k of stepKeys) expect(Number(k.split(':')[2])).toBeGreaterThanOrEqual(0);
    expect(html).toContain('class="ck-ing"');
    expect(html).toContain('class="ck-stepcell"');
    expect(html).toContain('class="ck-bannerrow"');
  });
});

describe('CookList (list-view recipes)', () => {
  const api = apiFromInput(SAMPLE_VANILLA_CAKE);
  it('renders ingredients and numbered steps with unchecked checkboxes', () => {
    const html = wrap(<CookList sections={api.sections} checked={new Set()} onToggle={() => {}} />);
    expect(html).toContain('>Ingredients<');
    expect(html).toContain('>Steps<');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(
      cookTotals(api.sections).ingredients + cookTotals(api.sections).steps,
    );
    expect(html).not.toContain('checked=""');
  });
  it('reflects checked keys', () => {
    const html = wrap(
      <CookList
        sections={api.sections}
        checked={new Set([ingredientKey(0, 0), stepKey(0, 0)])}
        onToggle={() => {}}
      />,
    );
    expect((html.match(/checked=""/g) ?? []).length).toBe(2);
    expect(html).toContain('data-checked="true"');
  });
});
