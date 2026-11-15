import { timingSafeEqual } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canEdit, canView, isImportedUnedited, type Actor, type ViewContext } from './access';

// The real comparison runs; the wrapper only records calls so the matrix can prove which inputs
// reach it (a differing-length token must never get there).
vi.mock('node:crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:crypto')>();
  return { ...mod, timingSafeEqual: vi.fn(mod.timingSafeEqual) };
});
const compare = vi.mocked(timingSafeEqual);
afterEach(() => compare.mockClear());

const owner: Actor = { id: 'o', role: 'member' };
const other: Actor = { id: 'x', role: 'member' };
const admin: Actor = { id: 'a', role: 'admin' };
const anonymous: Actor = null;
const actors = { owner, 'other member': other, admin, anonymous } as const;
type ActorName = keyof typeof actors;

const STORED = 'k'.repeat(32);
const WRONG = 'k'.repeat(31) + 'z'; // same length, one byte off
const SHORT = 'k'.repeat(31);
const visibilities = ['private', 'users'] as const;
type Vis = (typeof visibilities)[number];

/** Link column of the matrix: stored token on the row plus the context the request brings. */
const links = {
  none: { shareToken: null, ctx: { publicLinksEnabled: true } },
  'token matches': { shareToken: STORED, ctx: { token: STORED, publicLinksEnabled: true } },
  'token wrong': { shareToken: STORED, ctx: { token: WRONG, publicLinksEnabled: true } },
  'token right, links disabled': {
    shareToken: STORED,
    ctx: { token: STORED, publicLinksEnabled: false },
  },
} satisfies Record<string, { shareToken: string | null; ctx: ViewContext }>;
type LinkName = keyof typeof links;

const row = (visibility: Vis, shareToken: string | null = null) => ({
  ownerId: 'o',
  visibility,
  shareToken,
});

/** Expected `canView`: signed-in actors ignore the link; anonymous needs a live matching token. */
function expectedView(actor: ActorName, visibility: Vis, link: LinkName): boolean {
  if (actor === 'owner' || actor === 'admin') return true;
  if (actor === 'other member') return visibility === 'users';
  return link === 'token matches';
}

describe('canView matrix: actor x visibility x link', () => {
  const cases: Array<[ActorName, Vis, LinkName, boolean]> = [];
  for (const a of Object.keys(actors) as ActorName[])
    for (const v of visibilities)
      for (const l of Object.keys(links) as LinkName[])
        cases.push([a, v, l, expectedView(a, v, l)]);

  it.each(cases)('%s / %s / %s -> %s', (actorName, visibility, linkName, expected) => {
    const { shareToken, ctx } = links[linkName];
    expect(canView(actors[actorName], row(visibility, shareToken), ctx)).toBe(expected);
  });

  it('has the full 4 x 2 x 4 matrix', () => {
    expect(cases).toHaveLength(32);
  });

  it('signed-in actors get the same answer with no context at all', () => {
    for (const v of visibilities) {
      expect(canView(owner, row(v))).toBe(true);
      expect(canView(admin, row(v))).toBe(true);
      expect(canView(other, row(v))).toBe(v === 'users');
    }
  });
});

describe('canView: anonymous', () => {
  const on = { publicLinksEnabled: true };

  it('G24: anonymous with no token never views anything, including a `users` recipe', () => {
    for (const v of visibilities) {
      expect(canView(anonymous, row(v))).toBe(false);
      expect(canView(anonymous, row(v), on)).toBe(false);
      expect(canView(anonymous, row(v, STORED))).toBe(false);
      expect(canView(anonymous, row(v, STORED), on)).toBe(false);
    }
  });

  it('anonymous with the right token views a private and a users recipe (link is independent of visibility)', () => {
    expect(canView(anonymous, row('private', STORED), { ...on, token: STORED })).toBe(true);
    expect(canView(anonymous, row('users', STORED), { ...on, token: STORED })).toBe(true);
  });

  it('wrong token (same length) is false', () => {
    expect(canView(anonymous, row('users', STORED), { ...on, token: WRONG })).toBe(false);
  });

  it('wrong length is false', () => {
    expect(canView(anonymous, row('users', STORED), { ...on, token: SHORT })).toBe(false);
    expect(canView(anonymous, row('users', STORED), { ...on, token: STORED + 'k' })).toBe(false);
  });

  it('revoked link (null stored) is false even with a token that used to match', () => {
    expect(canView(anonymous, row('users', null), { ...on, token: STORED })).toBe(false);
  });

  it('empty token is false even when the stored token is set', () => {
    expect(canView(anonymous, row('users', STORED), { ...on, token: '' })).toBe(false);
  });

  it('a missing or non-string token is false and never reaches the comparison', () => {
    const r = row('users', STORED);
    for (const token of [undefined, 123 as never, null as never]) {
      expect(canView(anonymous, r, { token, publicLinksEnabled: true })).toBe(false);
    }
    expect(compare).not.toHaveBeenCalled();
  });

  it('a row without the share token column (undefined) is a plain false, not a throw', () => {
    const partial = { ownerId: 'o', visibility: 'users' as const, shareToken: undefined as never };
    expect(canView(anonymous, partial, { ...on, token: STORED })).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it('publicLinksEnabled must be the boolean true; runtime strings or numbers do not enable', () => {
    const r = row('users', STORED);
    for (const publicLinksEnabled of ['false', 'true', 1] as never[]) {
      expect(canView(anonymous, r, { token: STORED, publicLinksEnabled })).toBe(false);
    }
    expect(compare).not.toHaveBeenCalled();
  });

  it('PUBLIC_LINKS_ENABLED=false keeps a matching token inert (Q5)', () => {
    const off = { token: STORED, publicLinksEnabled: false };
    expect(canView(anonymous, row('private', STORED), off)).toBe(false);
    expect(canView(anonymous, row('users', STORED), off)).toBe(false);
  });

  it('anonymous never gets admin reach: a token is the only path, whatever the visibility', () => {
    const anyToken = { ...on, token: STORED };
    expect(canView(anonymous, row('private', WRONG), anyToken)).toBe(false);
    expect(canView(anonymous, row('users', WRONG), anyToken)).toBe(false);
  });
});

describe('canView: constant-time comparison', () => {
  const on = { publicLinksEnabled: true };

  it('a differing-length token never reaches timingSafeEqual', () => {
    expect(canView(anonymous, row('users', STORED), { ...on, token: SHORT })).toBe(false);
    expect(canView(anonymous, row('users', STORED), { ...on, token: STORED + 'kk' })).toBe(false);
    // Multi-byte input: same character count as the stored token, different byte length.
    expect(canView(anonymous, row('users', STORED), { ...on, token: 'é'.repeat(32) })).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it('an equal-length token goes through timingSafeEqual, match or not', () => {
    expect(canView(anonymous, row('users', STORED), { ...on, token: WRONG })).toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(canView(anonymous, row('users', STORED), { ...on, token: STORED })).toBe(true);
    expect(compare).toHaveBeenCalledTimes(2);
    const [a, b] = compare.mock.calls[1]!;
    expect(Buffer.isBuffer(a) && Buffer.isBuffer(b)).toBe(true);
    expect((a as Buffer).byteLength).toBe((b as Buffer).byteLength);
  });

  it('is never consulted for signed-in actors, with links off, or without a stored token', () => {
    canView(owner, row('private', STORED), { ...on, token: STORED });
    canView(other, row('private', STORED), { ...on, token: STORED });
    canView(anonymous, row('users', STORED), { token: STORED, publicLinksEnabled: false });
    canView(anonymous, row('users', null), { ...on, token: STORED });
    canView(anonymous, row('users', STORED), on);
    expect(compare).not.toHaveBeenCalled();
  });
});

describe('canEdit matrix: actor x visibility', () => {
  const expectedEdit: Record<ActorName, boolean> = {
    owner: true,
    'other member': false,
    admin: true,
    anonymous: false,
  };
  const cases: Array<[ActorName, Vis, boolean]> = [];
  for (const a of Object.keys(actors) as ActorName[])
    for (const v of visibilities) cases.push([a, v, expectedEdit[a]]);

  it.each(cases)('%s / %s -> %s', (actorName, visibility, expected) => {
    expect(canEdit(actors[actorName], row(visibility))).toBe(expected);
    // A stored share token changes nothing about who may edit.
    expect(canEdit(actors[actorName], row(visibility, STORED))).toBe(expected);
  });

  it('anonymous never edits, even on a recipe it could view through its token', () => {
    const r = row('users', STORED);
    expect(canView(anonymous, r, { token: STORED, publicLinksEnabled: true })).toBe(true);
    expect(canEdit(anonymous, r)).toBe(false);
  });
});

describe('isImportedUnedited (G8, Q3)', () => {
  const t0 = '2026-11-15T10:00:00.000Z';
  const t1 = '2026-11-15T10:00:00.001Z';

  it('true when source_url is set and updated_at equals created_at', () => {
    expect(
      isImportedUnedited({ sourceUrl: 'https://example.com/r', createdAt: t0, updatedAt: t0 }),
    ).toBe(true);
  });

  it('false once a content write moved updated_at', () => {
    expect(
      isImportedUnedited({ sourceUrl: 'https://example.com/r', createdAt: t0, updatedAt: t1 }),
    ).toBe(false);
  });

  it('false for a hand-made recipe (no source_url), whatever the stamps', () => {
    expect(isImportedUnedited({ sourceUrl: null, createdAt: t0, updatedAt: t0 })).toBe(false);
    expect(isImportedUnedited({ sourceUrl: '', createdAt: t0, updatedAt: t0 })).toBe(false);
    expect(isImportedUnedited({ sourceUrl: null, createdAt: t0, updatedAt: t1 })).toBe(false);
  });
});
