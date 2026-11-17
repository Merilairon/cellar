import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  initialRestoreState,
  type ApplyResult,
  type Preview,
  type RestoreState,
} from './backup-logic';
import { ExportPanel } from './ExportPanel';
import { RestoreView } from './RestoreView';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
const visible = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const noop = () => {};
function view(state: Partial<RestoreState>, role: 'admin' | 'member' = 'member') {
  return wrap(
    <RestoreView
      state={{ ...initialRestoreState, ...state }}
      role={role}
      dispatch={noop}
      onPick={noop}
      onCheck={noop}
      onCancelUpload={noop}
      onApply={noop}
      onDiscard={noop}
      onAgain={noop}
    />,
  );
}
const preview = (o: Partial<Preview> = {}): Preview => ({
  scope: 'own',
  recipes: 12,
  sections: 15,
  ingredients: 80,
  notes: 31,
  ratings: 9,
  photos: 20,
  conflicts: [],
  unknown_users: [],
  notes_skipped: 0,
  ratings_skipped: 0,
  ...o,
});
const stage = (o: Partial<Preview> = {}) => ({
  id: 'S1',
  kind: 'zip' as const,
  expires_at: '',
  preview: preview(o),
});
const result = (o: Partial<ApplyResult> = {}): ApplyResult => ({
  imported: 9,
  skipped: 3,
  renamed: 0,
  notes_restored: 0,
  notes_skipped: 0,
  ratings_restored: 0,
  ratings_skipped: 0,
  photos_restored: 20,
  photos_failed: 1,
  failed_at: null,
  ...o,
});

describe('ExportPanel', () => {
  it('member: one checkbox, plain download link', () => {
    const html = wrap(<ExportPanel role="member" />);
    expect(visible(html)).toContain('Include photos (zip)');
    expect(visible(html)).not.toContain("Include all users' recipes");
    expect(html).toContain('href="/api/export"');
    expect(html).toMatch(/<a [^>]*download/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
  });
  it('admin: second checkbox with the whole-instance explanation', () => {
    const html = wrap(<ExportPanel role="admin" />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(visible(html)).toContain('The whole Cellar: every user');
    expect(visible(html)).toContain('Keep this file safe.');
  });
});

describe('RestoreView', () => {
  it('idle without a file: check is aria-disabled with the reason', () => {
    const html = view({});
    expect(html).toContain('accept=".json,.zip,application/json,application/zip"');
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-describedby/);
    expect(visible(html)).toContain('Choose a file first');
    expect(html).toContain('aria-busy="false"');
  });
  it('file chosen: shows name and size, check enabled', () => {
    const html = view({ file: { name: 'cellar.zip', size: 48 * 1024 * 1024 } });
    expect(visible(html)).toContain('cellar.zip, 48 MB');
    expect(html).toContain('aria-disabled="false"');
    expect(visible(html)).not.toContain('Choose a file first');
  });
  it('uploading: determinate progress, busy, cancel', () => {
    const html = view({ phase: 'uploading', percent: 42, file: { name: 'a.zip', size: 1 } });
    expect(visible(html)).toContain('Uploading… 42 %');
    expect(html).toContain('value="42"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(visible(html)).toContain('Cancel');
  });
  it('checking: indeterminate progress', () => {
    const html = view({ phase: 'checking', file: { name: 'a.zip', size: 1 } });
    expect(visible(html)).toContain('Checking the file…');
    expect(html).toMatch(/<progress aria-label="Checking the file…" class="[^"]*"\s*>/);
  });
  it('error: alert text from the server message, version appended', () => {
    const html = view({
      error: {
        key: 'backup_version_unsupported',
        message: 'Made by a newer Cellar.',
        params: { version: '2' },
      },
    });
    expect(html).toContain('role="alert"');
    expect(visible(html)).toContain('Made by a newer Cellar. (backup version 2)');
  });
  it('error: falls back to the catalog string', () => {
    const html = view({ error: { key: 'in_progress' } });
    expect(visible(html)).toContain('Another restore is running');
  });
  it('preview: table, conflicts, strategy, count button', () => {
    const html = view({
      phase: 'preview',
      stage: stage({ conflicts: [{ title: 'Mocha Skillet Cookie', reason: 'same_title' }] }),
    });
    const text = visible(html);
    expect(html).toMatch(/<caption[^>]*tabindex="-1"/);
    expect(html.match(/<th scope="row"/g)).toHaveLength(5);
    expect(text).toContain('Backup of: your recipes');
    expect(text).toContain('Already in your recipes (1)');
    expect(text).toContain('Mocha Skillet Cookie');
    expect(html).not.toContain('<details');
    expect(text).toContain('Restore 11 recipes');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/type="radio"[^>]*checked/);
  });
  it('preview: long conflict lists go behind details', () => {
    const conflicts = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`,
      reason: 'same_title',
    }));
    const html = view({ phase: 'preview', stage: stage({ recipes: 8, conflicts }) });
    expect(html).toContain('<details');
    expect(visible(html)).toContain('Show all 8');
  });
  it('preview: titles are text, never markup', () => {
    const html = view({
      phase: 'preview',
      stage: stage({
        conflicts: [{ title: '<img src=x onerror=alert(1)>', reason: 'same_title' }],
      }),
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('preview: everything conflicts with skip disables restore with the reason', () => {
    const html = view({
      phase: 'preview',
      stage: stage({ recipes: 1, conflicts: [{ title: 'A', reason: 'same_title' }] }),
    });
    expect(visible(html)).toContain('Restore 0 recipes');
    expect(html).toMatch(/aria-disabled="true"/);
    expect(visible(html)).toContain('Every recipe in this file already exists.');
  });
  it('preview: admin all-users file lists owners not found; member file notes skipped', () => {
    const admin = view(
      { phase: 'preview', stage: stage({ scope: 'all', unknown_users: ['marie@example.com'] }) },
      'admin',
    );
    expect(visible(admin)).toContain('Owners not found here (1)');
    expect(visible(admin)).toContain('marie@example.com');
    expect(visible(admin)).toContain('Backup of: all users');
    const member = view({
      phase: 'preview',
      stage: stage({ notes_skipped: 3, ratings_skipped: 1 }),
    });
    expect(visible(member)).toContain('Shared notes written by other users are left out');
    expect(visible(member)).toContain('1 rating by another user is left out.');
    expect(visible(member)).not.toContain('Owners not found');
  });
  it('applying: buttons disabled, indeterminate status', () => {
    const html = view({ phase: 'applying', stage: stage() });
    expect(visible(html)).toContain('Restoring… this can take a while');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    // Focus-holding buttons stay focusable: aria-disabled plus a handler guard, not `disabled`.
    expect(html.match(/<button[^>]*aria-disabled="true"/g)?.length).toBe(2);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toMatch(/<progress[^>]*aria-label="Restoring/);
  });
  it('aria-busy is on the replaced region, never on the section holding the live region', () => {
    const html = view({ phase: 'uploading', percent: 5, file: { name: 'a.zip', size: 1 } });
    expect(html).toMatch(/<div class="space-y-3" aria-busy="true"/);
    expect(html).not.toMatch(/<section[^>]*aria-busy/);
    expect(html).toMatch(
      /<div role="status" aria-live="polite" class="sr-only">Uploading the file/,
    );
    expect(html).toMatch(/<progress[^>]*aria-label="Uploading the file/);
    expect(html).toMatch(/<span aria-hidden="true">Uploading… 5 %/);
  });
  it('result: heading, non-zero lines, links', () => {
    const html = view({ phase: 'result', stage: stage(), result: result() });
    const text = visible(html);
    expect(html).toMatch(/<h3[^>]*tabindex="-1"/);
    expect(html).toContain('role="status"');
    expect(text).toContain('Restore finished');
    expect(text).toContain('9 recipes restored');
    expect(text).toContain('3 recipes skipped (already in your recipes)');
    expect(text).toContain('20 photos restored');
    expect(text).toContain('1 photo could not be read');
    expect(text).not.toContain('left out (written');
    expect(html).toContain('href="/recipes"');
    expect(text).toContain('Restore another file');
  });
  it('result: partial failure', () => {
    const html = view({
      phase: 'result',
      stage: stage({ recipes: 12 }),
      result: result({
        imported: 4,
        failed_at: 4, // 0-based index in the API
        skipped: 0,
        photos_restored: 0,
        photos_failed: 0,
      }),
    });
    const text = visible(html);
    expect(text).toContain('Restore stopped');
    expect(text).toContain('4 recipes restored before the problem');
    expect(text).toContain('Stopped at recipe 5 of 12');
    expect(text).not.toContain('Restore finished');
  });
  it('result: a failure at the first recipe (failed_at 0) reads "recipe 1 of 12"', () => {
    const html = view({
      phase: 'result',
      stage: stage({ recipes: 12 }),
      result: result({ imported: 0, failed_at: 0 }),
    });
    expect(visible(html)).toContain('Stopped at recipe 1 of 12');
    expect(visible(html)).not.toContain('recipe 0 of');
  });
  it('result: left-out notes are explained by scope (member file vs all-users file)', () => {
    const own = visible(
      view({
        phase: 'result',
        stage: stage({ scope: 'own' }),
        result: result({ notes_skipped: 2 }),
      }),
    );
    expect(own).toContain('2 shared notes left out (written by other users)');
    expect(own).not.toContain('do not exist here');
    const all = visible(
      view(
        {
          phase: 'result',
          stage: stage({ scope: 'all' }),
          result: result({ notes_skipped: 1 }),
        },
        'admin',
      ),
    );
    expect(all).toContain('1 note left out (written by a user who does not exist here)');
  });
});
