import { describe, expect, it } from 'vitest';
import {
  chipKey,
  copyPlan,
  initialShareState,
  linkIsOn,
  shareReducer,
  statusDuration,
  summaryKey,
  warningSource,
  type ShareState,
} from './share-state';

const base = (over: Partial<ShareState> = {}): ShareState => ({
  ...initialShareState({ visibility: 'private', url: null, linksEnabled: true }),
  ...over,
});

describe('warningSource (copyright notice source)', () => {
  it('prefers the trimmed name, then the host, then null', () => {
    expect(warningSource('https://www.bbcgoodfood.com/r', ' BBC Good Food ')).toBe('BBC Good Food');
    expect(warningSource('https://www.bbcgoodfood.com/r', '  ')).toBe('www.bbcgoodfood.com');
    expect(warningSource('javascript:alert(1)', null)).toBeNull();
    expect(warningSource(null, null)).toBeNull();
  });
});

describe('summary and chip', () => {
  it('maps visibility x link to the spec sentences', () => {
    expect(summaryKey('private', false)).toBe('share.summary.private');
    expect(summaryKey('users', false)).toBe('share.summary.users');
    expect(summaryKey('private', true)).toBe('share.summary.link');
    expect(summaryKey('users', true)).toBe('share.summary.usersAndLink');
    expect(chipKey('private', false)).toBe('share.chip.private');
    expect(chipKey('users', true)).toBe('share.chip.usersAndLink');
  });
  it('never counts the link as on while links are disabled', () => {
    const s = initialShareState({
      visibility: 'private',
      url: 'https://x/r/t',
      linksEnabled: false,
    });
    expect(s.url).toBeNull();
    expect(linkIsOn(s)).toBe(false);
  });
});

describe('optimistic visibility', () => {
  it('moves at once and rolls back on failure with the right message', () => {
    const s1 = shareReducer(base(), { type: 'visibilityStart', next: 'users' });
    expect(s1.visibility).toBe('users');
    const s2 = shareReducer(s1, { type: 'visibilityFail', prev: 'private', httpStatus: 500 });
    expect(s2).toMatchObject({ visibility: 'private', visError: 'save' });
    const s3 = shareReducer(s1, { type: 'visibilityFail', prev: 'private', httpStatus: 403 });
    expect(s3.visError).toBe('forbidden');
    expect(shareReducer(s2, { type: 'visibilityStart', next: 'users' }).visError).toBeNull();
  });
  it('marks the dialog dirty on success only', () => {
    const s1 = shareReducer(base(), { type: 'visibilityStart', next: 'users' });
    expect(s1.dirty).toBe(false);
    expect(shareReducer(s1, { type: 'visibilityOk' }).dirty).toBe(true);
  });
});

describe('link transitions', () => {
  it('turn on: busy, then url and focus on Copy', () => {
    const s1 = shareReducer(base(), { type: 'linkStart', which: 'on' });
    expect(s1.busy).toBe('on');
    const s2 = shareReducer(s1, { type: 'linkUrl', url: 'https://x/r/abc', rotated: false });
    expect(s2).toMatchObject({ busy: null, url: 'https://x/r/abc', status: 'summary' });
    expect(s2.focus?.to).toBe('copy');
  });
  it('rotate announces the new link', () => {
    const s = shareReducer(base({ url: 'https://x/r/a' }), {
      type: 'linkUrl',
      url: 'https://x/r/b',
      rotated: true,
    });
    expect(s).toMatchObject({ url: 'https://x/r/b', status: 'rotated' });
  });
  it('turn off: confirm focuses Keep, Keep returns focus, revoke clears the url', () => {
    const on = base({ url: 'https://x/r/a' });
    const c = shareReducer(on, { type: 'confirm', which: 'off' });
    expect(c).toMatchObject({ confirm: 'off', focus: { to: 'keep' } });
    const kept = shareReducer(c, { type: 'dismissConfirm' });
    expect(kept).toMatchObject({ confirm: null, focus: { to: 'switch' }, url: 'https://x/r/a' });
    const off = shareReducer(c, { type: 'linkRevoked' });
    expect(off).toMatchObject({ url: null, confirm: null, focus: { to: 'switch' } });
  });
  it('only one confirm is open and Keep from rotate goes back to New link', () => {
    const a = shareReducer(base({ url: 'u' }), { type: 'confirm', which: 'rotate' });
    expect(shareReducer(a, { type: 'confirm', which: 'off' }).confirm).toBe('off');
    expect(shareReducer(a, { type: 'dismissConfirm' }).focus?.to).toBe('rotate');
  });
  it('failures keep the old state and pick the right message', () => {
    const on = base({ url: 'u', confirm: 'off', busy: 'off' });
    expect(shareReducer(on, { type: 'linkFail', which: 'off', httpStatus: 500 })).toMatchObject({
      url: 'u',
      confirm: null,
      linkError: 'turnOff',
    });
    expect(
      shareReducer(base({ busy: 'on' }), { type: 'linkFail', which: 'on', httpStatus: 500 })
        .linkError,
    ).toBe('turnOn');
    expect(
      shareReducer(base({ url: 'u' }), { type: 'linkFail', which: 'rotate', httpStatus: null })
        .linkError,
    ).toBe('rotate');
    expect(shareReducer(base(), { type: 'linkFail', which: 'on', httpStatus: 404 }).linkError).toBe(
      'forbidden',
    );
  });
  it('403 public_links_disabled replaces the switch', () => {
    const s = shareReducer(base({ busy: 'on' }), {
      type: 'linkFail',
      which: 'on',
      httpStatus: 403,
      code: 'public_links_disabled',
    });
    expect(s).toMatchObject({ linksEnabled: false, linkError: null, url: null });
  });
  it('close drops confirm, errors and status and resets dirty', () => {
    const s = shareReducer(
      base({
        confirm: 'rotate',
        linkError: 'rotate',
        visError: 'save',
        status: 'copied',
        dirty: true,
      }),
      { type: 'close' },
    );
    expect(s).toMatchObject({
      confirm: null,
      linkError: null,
      visError: null,
      status: 'summary',
      dirty: false,
    });
  });
});

describe('copy fallback decision', () => {
  it('uses the clipboard when present, else selects the field', () => {
    expect(copyPlan(true, false)).toBe('clipboard');
    expect(copyPlan(true, true)).toBe('clipboard');
    expect(copyPlan(false, false)).toBe('manual');
    expect(copyPlan(false, true)).toBe('manualTouch');
  });
  it('transient statuses time out, the summary does not', () => {
    expect(statusDuration('summary')).toBeNull();
    expect(statusDuration('copied')).toBe(2000);
    expect(statusDuration('rotated')).toBe(3000);
  });
});
