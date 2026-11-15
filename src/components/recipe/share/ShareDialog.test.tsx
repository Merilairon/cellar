import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { SAMPLE_SKILLET_COOKIES } from '@/lib/recipes/samples';
import { isImportedUnedited } from '@/lib/recipes/access';
import { apiFromInput } from '../fixtures';
import { RecipeActionSlot } from '../RecipeActions';
import { ShareDialog } from './ShareDialog';
import { initialShareState, warningSource, type ShareState } from './share-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../photos/PhotosProvider', () => ({ PhotosToggle: () => null }));

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
    .replace(/\s+/g, ' ')
    .trim();

const noop = () => {};
function dialog(state: Partial<ShareState>, warn: { source: string | null } | null = null) {
  return wrap(
    <ShareDialog
      open
      onClose={noop}
      title="Mocha Skillet Cookie"
      state={{
        ...initialShareState({ visibility: 'private', url: null, linksEnabled: true }),
        ...state,
      }}
      dispatch={noop}
      warningSource={warn}
      onVisibility={noop}
      onMakeLink={noop}
      onRevoke={noop}
      onCopy={noop}
    />,
  );
}

const imported = {
  ...apiFromInput({
    ...SAMPLE_SKILLET_COOKIES,
    source_url: 'https://www.bbcgoodfood.com/recipes/cookie',
    source_name: 'BBC Good Food',
  }),
};
const importedWarn = isImportedUnedited({
  sourceUrl: imported.source_url,
  createdAt: imported.created_at,
  updatedAt: imported.updated_at,
})
  ? { source: warningSource(imported.source_url, imported.source_name) }
  : null;
const handmade = apiFromInput({ ...SAMPLE_SKILLET_COOKIES, source_url: null, source_name: null });

describe('ShareDialog states', () => {
  it('private, link off: radios, switch off, no field', () => {
    const html = dialog({});
    const text = visible(html);
    expect(text).toContain('Share recipe');
    expect(text).toContain('Only you can see this recipe.');
    expect(html).toContain('role="status"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(text).toContain('Off');
    expect(html).not.toContain('Copy link');
    expect(html).toMatch(/type="radio"[^>]*checked=""/);
  });

  it('link on: read-only field with the URL, Copy link, New link, summary mentions the link', () => {
    const html = dialog({
      visibility: 'users',
      url: 'https://cellar.example/r/4fQpZ0Jm3kL9a2bWc8dXeY',
    });
    expect(html).toContain('value="https://cellar.example/r/4fQpZ0Jm3kL9a2bWc8dXeY"');
    expect(html).toContain('readOnly=""');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    const text = visible(html);
    expect(text).toContain('Copy link');
    expect(text).toContain('New link');
    expect(text).toContain('All users of this Cellar and anyone with the public link');
  });

  it('copied and manual statuses replace the summary sentence', () => {
    const url = 'https://cellar.example/r/x';
    expect(visible(dialog({ url, status: 'copied' }))).toContain('Link copied.');
    expect(visible(dialog({ url, status: 'copied' }))).toContain('Copied');
    expect(visible(dialog({ url, status: 'copyManual' }))).toContain(
      'Select the link and copy it with Ctrl+C.',
    );
  });

  it('turning on: busy and disabled switch with "Turning on…"', () => {
    const html = dialog({ busy: 'on' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(visible(html)).toContain('Turning on…');
  });

  it('off confirm: both buttons, switch stays checked and disabled', () => {
    const html = dialog({ url: 'https://c/r/x', confirm: 'off' });
    const text = visible(html);
    expect(text).toContain('Turn off the public link? Anyone who has it');
    expect(text).toContain('Turn off');
    expect(text).toContain('Keep');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });

  it('rotate confirm and errors', () => {
    expect(visible(dialog({ url: 'u', confirm: 'rotate' }))).toContain(
      'Make a new link? The old one stops working immediately.',
    );
    expect(visible(dialog({ url: 'u', linkError: 'rotate' }))).toContain(
      'Could not make a new link. The old link still works.',
    );
    expect(visible(dialog({ linkError: 'turnOn' }))).toContain(
      'Could not turn on the public link. Try again.',
    );
    expect(visible(dialog({ url: 'u', linkError: 'turnOff' }))).toContain(
      'Could not turn off the link. It still works. Try again.',
    );
    const v = dialog({ visError: 'save' });
    expect(v).toContain('role="alert"');
    expect(visible(v)).toContain('Could not save. Try again.');
    expect(visible(dialog({ visError: 'forbidden' }))).toContain(
      'You can no longer change sharing for this recipe.',
    );
  });

  it('public links disabled: one line, no switch, no field', () => {
    const html = dialog({ linksEnabled: false });
    expect(visible(html)).toContain('Public links are turned off on this Cellar by its admin.');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('Copy link');
    expect(html).toContain('type="radio"');
  });
});

describe('copyright notice', () => {
  it('is present for the imported, unedited fixture and names the source', () => {
    expect(importedWarn).toEqual({ source: 'BBC Good Food' });
    const html = dialog({}, importedWarn);
    expect(html).toContain('role="note"');
    const text = visible(html);
    expect(text).toContain('This recipe was imported and not edited');
    expect(text).toContain('It came from BBC Good Food.');
    expect(text).toContain('Rewriting the recipe in your own words removes this warning.');
    // referenced by both controls, never blocking (no extra checkbox or button)
    const id = /id="([^"]+-notice)"/.exec(html)![1];
    expect(html.match(new RegExp(`aria-describedby="[^"]*${id}`, 'g'))).toHaveLength(2);
    expect(html).not.toContain('type="checkbox"');
  });
  it('uses the no-source body and is absent for a hand-made recipe', () => {
    expect(visible(dialog({}, { source: null }))).toContain(
      'It was imported from another website.',
    );
    const html = dialog({}, null);
    expect(html).not.toContain('role="note"');
    expect(visible(html)).not.toContain('imported and not edited');
    expect(isImportedUnedited({ sourceUrl: null, createdAt: 'a', updatedAt: 'a' })).toBe(false);
  });
  it('an edited imported recipe has no warning', () => {
    expect(isImportedUnedited({ sourceUrl: 'https://a.b', createdAt: 'a', updatedAt: 'b' })).toBe(
      false,
    );
  });
  it('is shown inside the dialog when link is on too, and while disabled radios remain', () => {
    expect(dialog({ url: 'https://c/r/x' }, importedWarn)).toContain('role="note"');
  });
});

describe('RecipeActionSlot', () => {
  const slot = (can_edit: boolean, isOwner: boolean) =>
    wrap(
      <RecipeActionSlot
        recipe={{
          id: 'r1',
          title: 'T',
          can_edit,
          visibility: 'users',
          share: can_edit ? { url: null } : null,
          public_links_enabled: true,
          source_url: null,
          source_name: null,
        }}
        isOwner={isOwner}
        importedUnedited={false}
      />,
    );
  it('editors get Share and the state chip, not Save a copy', () => {
    const text = visible(slot(true, true));
    expect(text).toContain('Share');
    expect(text).toContain('All users');
    expect(text).not.toContain('Save a copy');
    expect(slot(true, true)).toContain('aria-haspopup="dialog"');
  });
  it('readers never see Share, only Save a copy', () => {
    const html = slot(false, false);
    expect(html).not.toContain('aria-haspopup');
    expect(visible(html)).not.toContain('Share');
    expect(visible(html)).toContain('Save a copy');
    expect(handmade.can_edit).toBe(true); // fixture sanity
  });
});
