import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { bottom, col, make, top } from '@/lib/grid/editor/fixtures';
import { doc, issuesFor, reduce } from '@/lib/grid/editor';
import { RowSheet } from './RowSheet';
import { StepPanel, type StepPanelApi } from './StepPanel';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const noop = () => {};
const api: StepPanelApi = { edit: noop, resize: noop, move: noop, convert: noop, remove: noop };

describe('StepPanel sheet variant (T8)', () => {
  const state = make(9, [top('Prep'), col(1, 3, 'Mix'), bottom('Rest')]);
  const d = doc(state);
  const sec = d.sections[0];
  const issues = issuesFor(d);
  const html = wrap(
    <StepPanel
      section={sec}
      step={sec.steps[1]}
      position={0}
      groupSize={1}
      issues={[...issues.errors, ...issues.warnings]}
      doc={d}
      api={api}
      headingId="h1"
      sheet={{ onClose: noop }}
    />,
  );

  it('shows both steppers without the Adjust rows toggle, with 44 px classes and labels', () => {
    expect(html).not.toContain('aria-expanded');
    expect(html).toContain('role="group" aria-label="Start row"');
    expect(html).toContain('role="group" aria-label="End row"');
    expect(html).toContain('aria-label="Mix: start one row earlier"');
    expect(html).toContain('aria-label="Mix: end one row later"');
    expect((html.match(/ge-stepper"/g) ?? []).length).toBe(4);
    expect(html).toContain('id="h1"');
    expect(html).toContain('data-ge-sheet-close');
  });

  it('lists the covered rows (3) and keeps the text fields in a closed disclosure', () => {
    expect(html).toMatch(/<ol start="2"[^>]*>(<li>[^<]*<\/li>){3}<\/ol>/);
    expect(html).toContain('Covers 3 rows');
    expect(html).toMatch(/<details class="ge-details"><summary[^>]*>Step details/);
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it('marks stepper limits aria-disabled and reports unused rows', () => {
    // Rows 1..3 of 9 are covered: End + is free, Start + / - are free, rows 4+ are unused.
    const atStart = reduce(make(9, [col(0, 0, 'One')]), { type: 'select', stepKey: 'step-0' });
    const dd = doc(atStart);
    const h = wrap(
      <StepPanel
        section={dd.sections[0]}
        step={dd.sections[0].steps[0]}
        position={0}
        groupSize={1}
        issues={[]}
        doc={dd}
        api={api}
        sheet={{ onClose: noop }}
      />,
    );
    // Start - (row 1) and Start + (start = end) and End - (end = start) are all at a limit.
    expect((h.match(/ge-stepper"[^>]*aria-disabled="true"/g) ?? []).length).toBe(3);
    expect(h).toContain('Not used by any step');
  });
});

describe('RowSheet', () => {
  it('lists every action as a button and keeps disabled ones focusable', () => {
    const html = wrap(
      <RowSheet
        name="butter"
        onClose={noop}
        onPick={noop}
        items={[
          { id: 'edit', label: 'Edit text' },
          { id: 'moveUp', label: 'Move butter up', disabled: true },
          { id: 'delete', label: 'Delete row' },
        ]}
      />,
    );
    expect(html).toContain('Row actions for butter');
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    expect(html).toMatch(/aria-disabled="true"[^>]*>Move butter up/);
  });
});
