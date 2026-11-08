import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import { apiFromInput } from '../fixtures';
import { bottom, col, make, top } from '@/lib/grid/editor/fixtures';
import { doc, issuesFor } from '@/lib/grid/editor';
import { GridEditor } from './GridEditor';
import { StepPanel, type StepPanelApi } from './StepPanel';
import { StepHandles } from './StepHandles';
import { StepsToolbar } from './StepsToolbar';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const noop = () => {};
const api: StepPanelApi = { edit: noop, resize: noop, move: noop, convert: noop, remove: noop };

describe('span handles in the editor', () => {
  const cookie = apiFromInput(SAMPLE_SKILLET_COOKIES);
  const html = wrap(<GridEditor recipe={cookie} onClose={noop} />);
  const steps = cookie.sections.flatMap((s) => s.steps.filter((x) => x.kind === 'column')).length;

  it('renders two sliders per column step, never as tab stops', () => {
    expect(count(html, /role="slider"/g)).toBe(steps * 2);
    expect(count(html, /role="slider"[^>]*tabindex="-1"/g)).toBe(steps * 2);
    expect(html).toMatch(/aria-orientation="vertical"/);
    expect(html).toMatch(/aria-label="[^"]+, start row"/);
    expect(html).toMatch(/aria-label="[^"]+, end row"/);
    expect(html).toMatch(/aria-valuetext="Row 1: /);
  });

  it('keeps one roving tab stop per table and offers Add step / Add banner', () => {
    expect(html).toContain('Add step');
    expect(html).toContain('Add top banner');
    expect(html).toContain('Add bottom banner');
    expect(count(html, /data-ge-target="[^"]*"[^>]*tabindex="0"/g)).toBe(count(html, /<table /g));
  });

  it('shows no step panel until a step is selected', () => {
    expect(html).not.toContain('data-ge-panel');
  });
});

describe('StepHandles', () => {
  it('labels both handles with the step label and the current row', () => {
    const h = wrap(
      <StepHandles
        label="Mix"
        stepKey="k"
        span={{ start: 1, end: 3 }}
        names={['a', 'b', 'c', 'd', 'e']}
        onBegin={noop}
        onSlide={noop}
      />,
    );
    expect(h).toContain('aria-label="Mix, start row"');
    expect(h).toContain('aria-label="Mix, end row"');
    expect(h).toContain('aria-valuenow="2"');
    expect(h).toContain('aria-valuenow="4"');
    expect(h).toContain('aria-valuemax="5"');
    expect(h).toContain('aria-valuetext="Row 4: d"');
  });
});

describe('StepPanel', () => {
  const state = make(9, [top('Prep'), col(0, 3, 'Mix'), col(2, 8, 'Bake'), bottom('Rest')]);
  const d = doc(state);
  const sec = d.sections[0];
  const issues = issuesFor(d);
  const panel = (i: number, group: number, pos: number) =>
    wrap(
      <StepPanel
        section={sec}
        step={sec.steps[i]}
        position={pos}
        groupSize={group}
        issues={[...issues.errors, ...issues.warnings]}
        doc={d}
        api={api}
      />,
    );

  it('column step: heading, Adjust rows disclosure, moves, convert, delete, fields', () => {
    const h = panel(1, 2, 0);
    expect(h).toContain('Step 1: Mix');
    expect(h).toMatch(
      /aria-expanded="false"[^>]*aria-controls|aria-controls[^>]*aria-expanded="false"/,
    );
    expect(h).toContain('Adjust rows');
    expect(h).toContain('Move left');
    expect(h).toContain('Convert to banner');
    expect(h).toContain('Delete step');
    // First column cannot move left: aria-disabled keeps focus; the last cannot move right.
    expect(h).toMatch(/aria-disabled="true"[^>]*>Move left/);
    expect(panel(2, 2, 1)).toMatch(/aria-disabled="true"[^>]*>Move right/);
    for (const f of ['Label', 'Detail', 'Temperature (°C)', 'Time, from (minutes)'])
      expect(h).toContain(f);
    expect(h).toContain('Alt+Up or Down to move the top edge');
    expect(h).toContain('Tap a step, then drag the green bars');
  });

  it('banner: its own heading, Move up / Move down, Convert to step, required label', () => {
    const h = panel(0, 1, 0);
    expect(h).toContain('Banner: Prep');
    expect(h).toContain('Move up');
    expect(h).toContain('Convert to step');
    expect(h).not.toContain('Adjust rows');
    expect(h).toMatch(/required=""/);
  });

  it('an empty banner label shows the required error beside the field', () => {
    const empty = make(3, [top('')]);
    const ed = doc(empty);
    const iss = issuesFor(ed);
    const h = wrap(
      <StepPanel
        section={ed.sections[0]}
        step={ed.sections[0].steps[0]}
        position={0}
        groupSize={1}
        issues={[...iss.errors, ...iss.warnings]}
        doc={ed}
        api={api}
      />,
    );
    expect(h).toContain('A banner needs text.');
    expect(h).toContain('aria-invalid="true"');
  });
});

describe('StepsToolbar', () => {
  const bar = (canAdd: boolean, canAddColumn: boolean) =>
    wrap(
      <StepsToolbar
        canAdd={canAdd}
        canAddColumn={canAddColumn}
        onAddStep={noop}
        onAddBanner={noop}
      />,
    );
  it('explains a disabled add instead of hiding it', () => {
    expect(bar(false, false)).toContain('A section can have at most 100 steps.');
    expect(bar(true, false)).toContain('Add an ingredient before adding a step.');
    expect(bar(true, true)).not.toContain('aria-disabled');
  });
});
