import { describe, expect, it } from 'vitest';
import { backupV1Schema, checkCaps, PHOTO_PATH_RE } from './schema';
import { validAllDoc, validDoc } from './schema-fixtures';

type Doc = ReturnType<typeof validDoc>;
const ULID = '01HZX3Q9V5K8N2M4P6R7S8T9WB';

// Each case mutates a fresh valid document; `bad` names the path (joined) of the first issue.
const rejects: Array<[string, (d: Doc) => void, string]> = [
  ['unknown top-level key', (d) => Object.assign(d, { id: 'x' }), ''],
  ['unknown recipe key (an id)', (d) => Object.assign(d.recipes[0], { id: 'x' }), 'recipes.0'],
  [
    'share_token smuggled in',
    (d) => Object.assign(d.recipes[0], { share_token: 'abc' }),
    'recipes.0',
  ],
  [
    'unknown section key',
    (d) => Object.assign(d.recipes[0].sections[0], { id: 'x' }),
    'recipes.0.sections.0',
  ],
  [
    'unknown ingredient key',
    (d) => Object.assign(d.recipes[0].sections[0].ingredients[0], { split_group_id: 'U' }),
    'recipes.0.sections.0.ingredients.0',
  ],
  [
    'unknown step key',
    (d) => Object.assign(d.recipes[0].sections[0].steps[0], { section_id: 'x' }),
    'recipes.0.sections.0.steps.0',
  ],
  [
    'unknown photo key',
    (d) => Object.assign(d.recipes[0].photos[0], { id: 'x' }),
    'recipes.0.photos.0',
  ],
  [
    'unknown note key',
    (d) => Object.assign(d.recipes[0].notes[0], { user_id: 'x' }),
    'recipes.0.notes.0',
  ],
  [
    'unknown rating key',
    (d) => Object.assign(d.recipes[0].ratings[0], { user_id: 'x' }),
    'recipes.0.ratings.0',
  ],
  ['scope invalid', (d) => ((d as { scope: string }).scope = 'some'), 'scope'],
  ['recipes not an array', (d) => ((d as { recipes: unknown }).recipes = {}), 'recipes'],
  ['recipes over 5000', (d) => (d.recipes = new Array(5001).fill(d.recipes[0])), 'recipes'],
  ['empty title', (d) => (d.recipes[0].title = ''), 'recipes.0.title'],
  ['title over 200', (d) => (d.recipes[0].title = 't'.repeat(201)), 'recipes.0.title'],
  [
    'description over 5000',
    (d) => (d.recipes[0].description = 'd'.repeat(5001)),
    'recipes.0.description',
  ],
  ['servings zero', (d) => (d.recipes[0].servings = 0), 'recipes.0.servings'],
  [
    'servings NaN-ish string',
    (d) => ((d.recipes[0] as { servings: unknown }).servings = '2'),
    'recipes.0.servings',
  ],
  ['negative prep', (d) => (d.recipes[0].prep_minutes = -1), 'recipes.0.prep_minutes'],
  ['fractional cook', (d) => (d.recipes[0].cook_minutes = 1.5), 'recipes.0.cook_minutes'],
  [
    'source_url javascript:',
    (d) => (d.recipes[0].source_url = 'javascript:alert(1)'),
    'recipes.0.source_url',
  ],
  ['source_url not a url', (d) => (d.recipes[0].source_url = 'nope'), 'recipes.0.source_url'],
  [
    'visibility public',
    (d) => ((d.recipes[0] as { visibility: string }).visibility = 'public'),
    'recipes.0.visibility',
  ],
  [
    'view_mode other',
    (d) => ((d.recipes[0] as { view_mode: string }).view_mode = 'cards'),
    'recipes.0.view_mode',
  ],
  ['bad timestamp', (d) => (d.recipes[0].created_at = 'yesterday'), 'recipes.0.created_at'],
  [
    'too many tags',
    (d) => (d.recipes[0].tags = Array.from({ length: 21 }, (_, i) => `t${i}`)),
    'recipes.0.tags',
  ],
  ['tag over 40', (d) => (d.recipes[0].tags = ['x'.repeat(41)]), 'recipes.0.tags.0'],
  ['no sections', (d) => (d.recipes[0].sections = []), 'recipes.0.sections'],
  [
    '201 sections',
    (d) => (d.recipes[0].sections = new Array(201).fill(d.recipes[0].sections[0])),
    'recipes.0.sections',
  ],
  [
    'section position gap',
    (d) => (d.recipes[0].sections[0].position = 1),
    'recipes.0.sections.0.position',
  ],
  [
    '401 ingredients',
    (d) =>
      (d.recipes[0].sections[0].ingredients = new Array(401).fill(
        d.recipes[0].sections[0].ingredients[0],
      )),
    'recipes.0.sections.0.ingredients',
  ],
  [
    '401 steps',
    (d) =>
      (d.recipes[0].sections[0].steps = new Array(401).fill(d.recipes[0].sections[0].steps[0])),
    'recipes.0.sections.0.steps',
  ],
  [
    'ingredient position gap',
    (d) => (d.recipes[0].sections[0].ingredients[0].position = 3),
    'recipes.0.sections.0.ingredients.0.position',
  ],
  [
    'ingredient name empty',
    (d) => (d.recipes[0].sections[0].ingredients[0].name = ''),
    'recipes.0.sections.0.ingredients.0.name',
  ],
  [
    'ingredient raw_text over 500',
    (d) => (d.recipes[0].sections[0].ingredients[0].raw_text = 'r'.repeat(501)),
    'recipes.0.sections.0.ingredients.0.raw_text',
  ],
  [
    'qty_max below qty',
    (d) => (d.recipes[0].sections[0].ingredients[0].metric_qty_max = 1),
    'recipes.0.sections.0.ingredients.0.metric_qty_max',
  ],
  [
    'qty_max without qty',
    (d) => {
      const i = d.recipes[0].sections[0].ingredients[0];
      i.us_qty = null;
      i.us_qty_max = 3;
    },
    'recipes.0.sections.0.ingredients.0.us_qty_max',
  ],
  [
    'negative qty',
    (d) => (d.recipes[0].sections[0].ingredients[0].metric_qty = -1),
    'recipes.0.sections.0.ingredients.0.metric_qty',
  ],
  [
    'Infinity qty',
    (d) => (d.recipes[0].sections[0].ingredients[0].us_qty = Infinity),
    'recipes.0.sections.0.ingredients.0.us_qty',
  ],
  [
    'display_primary other',
    (d) =>
      ((d.recipes[0].sections[0].ingredients[0] as { display_primary: string }).display_primary =
        'imperial'),
    'recipes.0.sections.0.ingredients.0.display_primary',
  ],
  [
    'split key over 64',
    (d) => (d.recipes[0].sections[0].ingredients[0].split_group_key = 'k'.repeat(65)),
    'recipes.0.sections.0.ingredients.0.split_group_key',
  ],
  [
    'step kind other',
    (d) => ((d.recipes[0].sections[0].steps[0] as { kind: string }).kind = 'row'),
    'recipes.0.sections.0.steps.0.kind',
  ],
  [
    'step label empty',
    (d) => (d.recipes[0].sections[0].steps[0].label = ''),
    'recipes.0.sections.0.steps.0.label',
  ],
  [
    'step detail over 4000',
    (d) => (d.recipes[0].sections[0].steps[0].detail = 'x'.repeat(4001)),
    'recipes.0.sections.0.steps.0.detail',
  ],
  [
    'span start after end',
    (d) => {
      const s = d.recipes[0].sections[0].steps[0];
      s.row_start = 3;
      s.row_end = 1;
    },
    'recipes.0.sections.0.steps.0.row_end',
  ],
  [
    'span half set',
    (d) => (d.recipes[0].sections[0].steps[0].row_end = null),
    'recipes.0.sections.0.steps.0.row_end',
  ],
  [
    'grid column without span',
    (d) => {
      const s = d.recipes[0].sections[0].steps[0];
      s.row_start = null;
      s.row_end = null;
    },
    'recipes.0.sections.0.steps.0.row_start',
  ],
  [
    'banner with a span',
    (d) => {
      const s = d.recipes[0].sections[0].steps[0];
      s.kind = 'banner_top';
    },
    'recipes.0.sections.0.steps.0.row_start',
  ],
  [
    'minutes_min above max',
    (d) => {
      const s = d.recipes[0].sections[0].steps[0];
      s.minutes_min = 9;
      s.minutes_max = 3;
    },
    'recipes.0.sections.0.steps.0.minutes_max',
  ],
  [
    'temp_c over 1000',
    (d) => (d.recipes[0].sections[0].steps[0].temp_c = 1001),
    'recipes.0.sections.0.steps.0.temp_c',
  ],
  [
    '11 photos',
    (d) =>
      (d.recipes[0].photos = Array.from({ length: 11 }, (_, i) => ({
        ...d.recipes[0].photos[0],
        position: i,
        file: `photos/01HZX3Q9V5K8N2M4P6R7S8T9${String(i).padStart(2, '0')}.webp`,
        thumb: null,
      }))),
    'recipes.0.photos',
  ],
  [
    'photo path with ..',
    (d) => (d.recipes[0].photos[0].file = 'photos/../etc/passwd'),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path absolute',
    (d) => (d.recipes[0].photos[0].file = `/photos/${ULID}.webp`),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path other dir',
    (d) => (d.recipes[0].photos[0].file = `uploads/${ULID}.webp`),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path lowercase ulid',
    (d) => (d.recipes[0].photos[0].file = `photos/${ULID.toLowerCase()}.webp`),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path ULID with I/L/O/U',
    (d) => (d.recipes[0].photos[0].file = 'photos/01HZX3Q9V5K8N2M4P6R7S8T9IL.webp'),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path wrong extension',
    (d) => (d.recipes[0].photos[0].file = `photos/${ULID}.png`),
    'recipes.0.photos.0.file',
  ],
  [
    'photo path trailing newline',
    (d) => (d.recipes[0].photos[0].file = `photos/${ULID}.webp\n`),
    'recipes.0.photos.0.file',
  ],
  [
    'photo thumb bad path',
    (d) => (d.recipes[0].photos[0].thumb = 'photos/x.webp'),
    'recipes.0.photos.0.thumb',
  ],
  ['photo width zero', (d) => (d.recipes[0].photos[0].width = 0), 'recipes.0.photos.0.width'],
  [
    'two covers',
    (d) =>
      d.recipes[0].photos.push({
        position: 1,
        is_cover: true,
        width: 1,
        height: 1,
        file: `photos/${ULID}.webp`,
        thumb: null,
      }),
    'recipes.0.photos',
  ],
  [
    'duplicate photo file',
    (d) =>
      d.recipes[0].photos.push({
        position: 1,
        is_cover: false,
        width: 1,
        height: 1,
        file: d.recipes[0].photos[0].file,
        thumb: null,
      }),
    'recipes.0.photos.1',
  ],
  [
    '201 notes',
    (d) => (d.recipes[0].notes = new Array(201).fill(d.recipes[0].notes[0])),
    'recipes.0.notes',
  ],
  ['note body empty', (d) => (d.recipes[0].notes[0].body = ''), 'recipes.0.notes.0.body'],
  [
    'note body over 4000',
    (d) => (d.recipes[0].notes[0].body = 'n'.repeat(4001)),
    'recipes.0.notes.0.body',
  ],
  [
    'note shared not boolean',
    (d) => ((d.recipes[0].notes[0] as { shared: unknown }).shared = 1),
    'recipes.0.notes.0.shared',
  ],
  ['own note without mine', (d) => delete d.recipes[0].notes[0].mine, 'recipes.0.notes.0.mine'],
  [
    'own note with author_email',
    (d) => (d.recipes[0].notes[0].author_email = 'a@x.test'),
    'recipes.0.notes.0.author_email',
  ],
  ['stars 0', (d) => (d.recipes[0].ratings[0].stars = 0), 'recipes.0.ratings.0.stars'],
  ['stars 6', (d) => (d.recipes[0].ratings[0].stars = 6), 'recipes.0.ratings.0.stars'],
  ['stars 4.5', (d) => (d.recipes[0].ratings[0].stars = 4.5), 'recipes.0.ratings.0.stars'],
  [
    'own rating with user_email',
    (d) => (d.recipes[0].ratings[0].user_email = 'a@x.test'),
    'recipes.0.ratings.0.user_email',
  ],
  [
    'own scope with owner_email',
    (d) => (d.recipes[0].owner_email = 'a@x.test'),
    'recipes.0.owner_email',
  ],
  ['own scope with users', (d) => (d.users = []), 'users'],
  [
    'uppercase email in all scope is covered below; stamp without Z',
    (d) => (d.recipes[0].created_at = '2026-01-01T00:00:00'),
    'recipes.0.created_at',
  ],
  [
    'stamp that Date.parse accepts but is not ISO',
    (d) => (d.recipes[0].updated_at = '2020'),
    'recipes.0.updated_at',
  ],
  ['version 2', (d) => ((d as { version: number }).version = 2), 'version'],
  ['app_version over 64', (d) => (d.app_version = 'v'.repeat(65)), 'app_version'],
];

describe('backupV1Schema: accepts', () => {
  it('a valid own document', () => {
    expect(backupV1Schema.safeParse(validDoc()).success).toBe(true);
  });
  it('a valid all document', () => {
    expect(backupV1Schema.safeParse(validAllDoc()).success).toBe(true);
  });
  it('a document with no recipes', () => {
    expect(backupV1Schema.safeParse({ ...validDoc(), recipes: [] }).success).toBe(true);
  });
  it('a list-mode recipe with column steps without spans', () => {
    const d = validDoc();
    d.recipes[0].view_mode = 'list';
    d.recipes[0].sections[0].steps[0].row_start = null;
    d.recipes[0].sections[0].steps[0].row_end = null;
    expect(backupV1Schema.safeParse(d).success).toBe(true);
  });
  it('a null source_url, a legacy photo (thumb null) and no photos', () => {
    const d = validDoc();
    d.recipes[0].source_url = null;
    expect(backupV1Schema.safeParse(d).success).toBe(true);
    d.recipes[0].photos = [];
    expect(backupV1Schema.safeParse(d).success).toBe(true);
  });
});

describe('backupV1Schema: rejects (table-driven)', () => {
  it.each(rejects)('%s', (_name, mutate, path) => {
    const d = validDoc();
    mutate(d);
    const r = backupV1Schema.safeParse(d);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain(path);
    }
  });
  it('has at least 30 cases', () => {
    expect(rejects.length).toBeGreaterThanOrEqual(30);
  });
});

describe('backupV1Schema: all scope', () => {
  const rejectsAll: Array<[string, (d: Doc) => void]> = [
    ['users missing', (d) => delete d.users],
    ['owner_email missing', (d) => delete d.recipes[0].owner_email],
    ['owner_email not in users', (d) => (d.recipes[0].owner_email = 'ghost@x.test')],
    ['note author_email missing', (d) => delete d.recipes[0].notes[0].author_email],
    ['note with mine', (d) => (d.recipes[0].notes[0].mine = true)],
    ['rating user_email missing', (d) => delete d.recipes[0].ratings[0].user_email],
    ['rating user not in users', (d) => (d.recipes[0].ratings[0].user_email = 'ghost@x.test')],
    ['two ratings by one user', (d) => d.recipes[0].ratings.push({ ...d.recipes[0].ratings[0] })],
    ['duplicate user emails', (d) => d.users!.push({ ...d.users![0] })],
    ['uppercase owner_email', (d) => (d.recipes[0].owner_email = 'A@x.test')],
    ['uppercase user email', (d) => (d.users![0].email = 'A@x.test')],
    ['email with whitespace', (d) => (d.users![0].email = 'a b@x.test')],
    ['user role other', (d) => ((d.users![0] as { role: string }).role = 'root')],
    ['user with password_hash', (d) => Object.assign(d.users![0], { password_hash: 'x' })],
  ];
  it.each(rejectsAll)('%s', (_n, mutate) => {
    const d = validAllDoc();
    mutate(d);
    expect(backupV1Schema.safeParse(d).success).toBe(false);
  });
});

describe('PHOTO_PATH_RE', () => {
  it('matches only photos/<ulid>.webp', () => {
    expect(PHOTO_PATH_RE.test(`photos/${ULID}.webp`)).toBe(true);
    expect(PHOTO_PATH_RE.test(`photos/${ULID}.webp/`)).toBe(false);
    expect(PHOTO_PATH_RE.test(`xphotos/${ULID}.webp`)).toBe(false);
    expect(PHOTO_PATH_RE.test(`photos\\${ULID}.webp`)).toBe(false);
  });
});

describe('app limits and tag rules apply to a backup (review m5)', () => {
  const sections = (d: Doc, n: number) => {
    const base = d.recipes[0].sections[0];
    d.recipes[0].sections = Array.from({ length: n }, (_, i) => ({ ...base, position: i }));
  };
  const ingredients = (d: Doc, n: number) => {
    const base = d.recipes[0].sections[0].ingredients[0];
    d.recipes[0].sections[0].ingredients = Array.from({ length: n }, (_, i) => ({
      ...base,
      position: i,
    }));
  };
  const steps = (d: Doc, n: number) => {
    const base = d.recipes[0].sections[0].steps[0];
    d.recipes[0].view_mode = 'list';
    d.recipes[0].sections[0].steps = Array.from({ length: n }, (_, i) => ({
      ...base,
      position: i,
    }));
  };

  it.each<[string, (d: Doc) => void, string]>([
    ['tag with a zero-width space', (d) => (d.recipes[0].tags = ['a\u200Bb']), 'recipes.0.tags.0'],
    [
      'tag with a control character',
      (d) => (d.recipes[0].tags = ['ok', 'a\u0007']),
      'recipes.0.tags.1',
    ],
    ['tag with a bidi override', (d) => (d.recipes[0].tags = ['\u202Eevil']), 'recipes.0.tags.0'],
    ['tag that is only spaces', (d) => (d.recipes[0].tags = ['   ']), 'recipes.0.tags.0'],
    ['empty tag', (d) => (d.recipes[0].tags = ['']), 'recipes.0.tags.0'],
    ['tag over 40 characters', (d) => (d.recipes[0].tags = ['t'.repeat(41)]), 'recipes.0.tags.0'],
    ['a non-string tag', (d) => (d.recipes[0].tags = [5 as unknown as string]), 'recipes.0.tags.0'],
    [
      '21 tags',
      (d) => (d.recipes[0].tags = Array.from({ length: 21 }, (_, i) => `t${i}`)),
      'recipes.0.tags',
    ],
    ['21 sections', (d) => sections(d, 21), 'recipes.0.sections'],
    [
      '201 ingredients in a section',
      (d) => ingredients(d, 201),
      'recipes.0.sections.0.ingredients',
    ],
    ['101 steps in a section', (d) => steps(d, 101), 'recipes.0.sections.0.steps'],
  ])('rejects %s with the path of the offender', (_n, mutate, path) => {
    const d = validDoc();
    mutate(d);
    const r = backupV1Schema.safeParse(d);
    expect(r.success).toBe(false);
    if (!r.success) {
      const hit = r.error.issues.find((i) => i.path.join('.') === path);
      expect(hit, JSON.stringify(r.error.issues)).toBeDefined();
    }
  });

  it('the cheap pre-zod cap check reports the same limits with a path', () => {
    const d = validDoc();
    sections(d, 21);
    expect(checkCaps(d)).toContainEqual({ path: 'recipes.0.sections', code: 'too_many_sections' });
    const e = validDoc();
    ingredients(e, 201);
    expect(checkCaps(e)).toContainEqual({
      path: 'recipes.0.sections.0.ingredients',
      code: 'too_many_ingredients',
    });
    const f = validDoc();
    steps(f, 101);
    expect(checkCaps(f)).toContainEqual({
      path: 'recipes.0.sections.0.steps',
      code: 'too_many_steps',
    });
  });

  it('accepts exactly the app limits and tags the app would normalize', () => {
    const d = validDoc();
    sections(d, 20);
    d.recipes[0].tags = Array.from({ length: 19 }, (_, i) => `t${i}`).concat(['  Dessert ']);
    expect(backupV1Schema.safeParse(d).success).toBe(true);
    const e = validDoc();
    ingredients(e, 200);
    expect(backupV1Schema.safeParse(e).success).toBe(true);
    const f = validDoc();
    steps(f, 100);
    expect(backupV1Schema.safeParse(f).success).toBe(true);
    const g = validDoc();
    g.recipes[0].tags = ['\u{1F370}'.repeat(40)]; // 40 code points, 80 UTF-16 units
    expect(backupV1Schema.safeParse(g).success).toBe(true);
  });
});
