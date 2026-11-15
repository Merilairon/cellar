import type { Visibility } from '@/lib/recipes/schemas';
import { safeHttpUrl } from '../api';

/** Pure state and decisions behind the share dialog (UX spec section 1), kept out of React. */

export type LinkError = 'turnOn' | 'turnOff' | 'rotate' | 'forbidden';
export type ShareStatus = 'summary' | 'copied' | 'copyManual' | 'copyManualTouch' | 'rotated';
export type FocusTarget = 'copy' | 'switch' | 'keep' | 'rotate';

export type ShareState = {
  visibility: Visibility;
  /** The public URL when a link exists, else null. */
  url: string | null;
  linksEnabled: boolean;
  /** A link request in flight. */
  busy: 'on' | 'off' | 'rotate' | null;
  /** The one open inline confirm. */
  confirm: 'off' | 'rotate' | null;
  visError: 'save' | 'forbidden' | null;
  linkError: LinkError | null;
  status: ShareStatus;
  /** Where focus should go after the next render; `seq` makes a repeat target fire again. */
  focus: { to: FocusTarget; seq: number } | null;
  /** True once anything changed on the server while the dialog was in use. */
  dirty: boolean;
};

export function initialShareState(p: {
  visibility: Visibility;
  url: string | null;
  linksEnabled: boolean;
}): ShareState {
  return {
    visibility: p.visibility,
    // Links off: a stored token is inert and not shown (the server already hides it).
    url: p.linksEnabled ? p.url : null,
    linksEnabled: p.linksEnabled,
    busy: null,
    confirm: null,
    visError: null,
    linkError: null,
    status: 'summary',
    focus: null,
    dirty: false,
  };
}

export type ShareAction =
  | { type: 'visibilityStart'; next: Visibility }
  | { type: 'visibilityOk' }
  | { type: 'visibilityFail'; prev: Visibility; httpStatus: number | null }
  | { type: 'confirm'; which: 'off' | 'rotate' }
  | { type: 'dismissConfirm' }
  | { type: 'linkStart'; which: 'on' | 'off' | 'rotate' }
  | { type: 'linkUrl'; url: string; rotated: boolean }
  | { type: 'linkRevoked' }
  | { type: 'linkFail'; which: 'on' | 'off' | 'rotate'; httpStatus: number | null; code?: string }
  | { type: 'status'; status: ShareStatus }
  | { type: 'close' };

const gone = (s: number | null) => s === 401 || s === 403 || s === 404;
const bump = (st: ShareState, to: FocusTarget) => ({ to, seq: (st.focus?.seq ?? 0) + 1 });

export function shareReducer(st: ShareState, a: ShareAction): ShareState {
  switch (a.type) {
    case 'visibilityStart': // optimistic
      return { ...st, visibility: a.next, visError: null };
    case 'visibilityOk':
      return { ...st, dirty: true };
    case 'visibilityFail': // roll back to what was saved
      return { ...st, visibility: a.prev, visError: gone(a.httpStatus) ? 'forbidden' : 'save' };
    case 'confirm': // opening one confirm closes the other; nothing was sent
      return { ...st, confirm: a.which, linkError: null, focus: bump(st, 'keep') };
    case 'dismissConfirm':
      return {
        ...st,
        focus: bump(st, st.confirm === 'rotate' ? 'rotate' : 'switch'),
        confirm: null,
      };
    case 'linkStart':
      return { ...st, busy: a.which, linkError: null };
    case 'linkUrl':
      return {
        ...st,
        url: a.url,
        busy: null,
        confirm: null,
        dirty: true,
        status: a.rotated ? 'rotated' : 'summary',
        focus: bump(st, 'copy'),
      };
    case 'linkRevoked':
      return {
        ...st,
        url: null,
        busy: null,
        confirm: null,
        dirty: true,
        status: 'summary',
        focus: bump(st, 'switch'),
      };
    case 'linkFail': {
      if (a.code === 'public_links_disabled') {
        return {
          ...st,
          linksEnabled: false,
          url: null,
          busy: null,
          confirm: null,
          linkError: null,
        };
      }
      const linkError: LinkError = gone(a.httpStatus)
        ? 'forbidden'
        : a.which === 'on'
          ? 'turnOn'
          : a.which === 'off'
            ? 'turnOff'
            : 'rotate';
      // A closed confirm took focus with it: return it to the control that opened it.
      const to: FocusTarget | null =
        st.confirm === 'rotate' ? 'rotate' : st.confirm === 'off' ? 'switch' : null;
      return { ...st, busy: null, confirm: null, linkError, focus: to ? bump(st, to) : st.focus };
    }
    case 'status':
      return { ...st, status: a.status };
    case 'close': // an open confirm is dropped; errors clear
      return {
        ...st,
        confirm: null,
        visError: null,
        linkError: null,
        status: 'summary',
        dirty: false,
      };
  }
}

export type SummaryKey =
  | 'share.summary.private'
  | 'share.summary.users'
  | 'share.summary.link'
  | 'share.summary.usersAndLink';

/** Whether the public link counts as on (never while links are disabled). */
export const linkIsOn = (s: Pick<ShareState, 'url' | 'linksEnabled'>) =>
  s.linksEnabled && s.url !== null;

export function summaryKey(visibility: Visibility, linkOn: boolean): SummaryKey {
  if (visibility === 'users') return linkOn ? 'share.summary.usersAndLink' : 'share.summary.users';
  return linkOn ? 'share.summary.link' : 'share.summary.private';
}

export type ChipKey =
  'share.chip.private' | 'share.chip.users' | 'share.chip.link' | 'share.chip.usersAndLink';

export function chipKey(visibility: Visibility, linkOn: boolean): ChipKey {
  if (visibility === 'users') return linkOn ? 'share.chip.usersAndLink' : 'share.chip.users';
  return linkOn ? 'share.chip.link' : 'share.chip.private';
}

/** Who shows the warning's `{source}`: the source name, else the URL's host, else null. */
export function warningSource(
  sourceUrl: string | null | undefined,
  sourceName: string | null | undefined,
): string | null {
  const name = sourceName?.trim();
  if (name) return name;
  const url = safeHttpUrl(sourceUrl);
  return url ? new URL(url).hostname || null : null;
}

export type CopyPlan = 'clipboard' | 'manual' | 'manualTouch';

/** Clipboard API when it exists; else select the field and tell the user how to copy. */
export function copyPlan(hasClipboard: boolean, coarsePointer: boolean): CopyPlan {
  if (hasClipboard) return 'clipboard';
  return coarsePointer ? 'manualTouch' : 'manual';
}

/** Milliseconds a transient status stays before the summary returns; null = stays. */
export function statusDuration(s: ShareStatus): number | null {
  switch (s) {
    case 'summary':
      return null;
    case 'copied':
      return 2000;
    case 'rotated':
      return 3000;
    default:
      return 5000;
  }
}
