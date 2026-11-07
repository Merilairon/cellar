import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES, SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { GridEditor } from './GridEditor';
import { SectionHeader } from './SectionHeader';
import { UndoToast, TOAST_MS } from './UndoToast';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const cake = apiFromInput(SAMPLE_VANILLA_CAKE);
const cookie = apiFromInput(SAMPLE_SKILLET_COOKIES);
const rowCount = (r: typeof cake) => r.sections.reduce((n, s) => n + s.ingredients.length, 0);

describe('ingredient row controls', () => {
  const html = wrap(<GridEditor recipe={cake} onClose={() => {}} />);

  it('renders one Row actions menu button per row, closed, named after the row', () => {
    expect(count(html, /aria-haspopup="menu"/g)).toBe(rowCount(cake));
    expect(count(html, /aria-expanded="false"/g)).toBeGreaterThanOrEqual(rowCount(cake));
    expect(html).not.toContain('role="menu"');
    expect(html).toMatch(/aria-label="Row actions for [^"]+"/);
  });

  it('renders Move up / Move down per row, hidden under 900 px by CSS only', () => {
    const moves = html.match(/<button[^>]*data-ge-act="move(?:Up|Down)"[^>]*>/g) ?? [];
    expect(moves).toHaveLength(rowCount(cake) * 2);
    for (const m of moves) {
      expect(m).toContain('max-[899px]:hidden');
      expect(m).toMatch(/aria-label="Move [^"]+ (up|down)"/);
    }
    // The Row actions button is never hidden by width.
    const actions = html.match(/<button[^>]*aria-haspopup="menu"[^>]*>/g) ?? [];
    for (const a of actions) expect(a).not.toContain('max-[899px]');
  });

  it('disables Move up on the first row and Move down on the last, still focusable', () => {
    const up = html.match(/<button[^>]*data-ge-act="moveUp"[^>]*>/g) ?? [];
    expect(up[0]).toContain('aria-disabled="true"');
    expect(up[1]).not.toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]*data-ge-act[^>]*\sdisabled(=|\s|>)/);
  });

  it('shows no inline edit field until a row is activated', () => {
    expect(html).not.toContain('Edit ingredient');
    expect(html).not.toContain('<input');
  });
});

describe('section header', () => {
  it('lists Rename, Delete section and Add row; Add section sits below the sections', () => {
    const html = wrap(<GridEditor recipe={cake} onClose={() => {}} />);
    expect(html).toContain('>Rename<');
    expect(count(html, />Delete section</g)).toBe(2);
    expect(count(html, />Add row</g)).toBe(2);
    expect(html).toContain('>Add section<');
    expect(html).not.toContain('A recipe needs at least one section.');
  });

  it('disables deleting the only section and says why', () => {
    const html = wrap(<GridEditor recipe={cookie} onClose={() => {}} />);
    expect(html).toContain('A recipe needs at least one section.');
    expect(html).toMatch(
      /aria-disabled="true" aria-describedby="ge-sec-last-0"[^>]*>Delete section/,
    );
  });

  const base = {
    index: 0,
    sectionKey: 's',
    title: 'Cake',
    rawTitle: 'Cake',
    multiple: true,
    rowCount: 3,
    stepCount: 1,
    atRowCap: false,
    capMessage: null,
    onRename: () => {},
    onDelete: () => {},
    onAddRow: () => {},
  };

  it('keeps the heading a real h3 with the title', () => {
    const html = wrap(<SectionHeader {...base} />);
    expect(html).toMatch(/<h3[^>]*data-ge-heading="s"[^>]*>Cake<\/h3>/);
  });

  it('disables Add row at the cap with visible text', () => {
    const html = wrap(
      <SectionHeader {...base} atRowCap capMessage="A section can have at most 200 ingredients." />,
    );
    expect(html).toMatch(/aria-disabled="true" aria-describedby="ge-sec-cap-0"[^>]*data-ge-addrow/);
    expect(html).toContain('A section can have at most 200 ingredients.');
  });
});

describe('undo toast', () => {
  it('hides its text from assistive tech (the live region says it) and keeps both buttons', () => {
    const html = wrap(
      <UndoToast
        toast={{ message: 'Deleted butter.', onUndo: () => {}, doc: null }}
        onDismiss={() => {}}
      />,
    );
    expect(html).toMatch(/aria-hidden="true"[^>]*>Deleted butter\./);
    expect(html).toContain('>Undo<');
    expect(html).toContain('>Dismiss<');
    expect(TOAST_MS).toBe(10_000);
  });
});
