// Test-only: a minimal valid v1 document (scope 'own') built by hand.
import type { BackupNote, BackupRecipe, BackupV1 } from './schema';

export function validRecipe(): BackupRecipe {
  return {
    title: 'Toast',
    description: null,
    servings: 2,
    servings_label: null,
    prep_minutes: 1,
    cook_minutes: 2,
    source_url: 'https://example.test/toast',
    source_name: null,
    visibility: 'private',
    view_mode: 'grid',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    tags: ['breakfast'],
    sections: [
      {
        position: 0,
        title: null,
        ingredients: [
          {
            position: 0,
            name: 'bread',
            note: null,
            raw_text: '2 slices bread',
            metric_qty: 2,
            metric_qty_max: null,
            metric_unit: 'slice',
            us_qty: 2,
            us_qty_max: null,
            us_unit: 'slice',
            display_primary: 'metric',
            split_group_key: null,
            portion_label: null,
            group_label: null,
          },
        ],
        steps: [
          {
            position: 0,
            kind: 'column',
            label: 'toast',
            detail: 'Toast it.',
            row_start: 0,
            row_end: 0,
            temp_c: null,
            temp_f: null,
            minutes_min: null,
            minutes_max: null,
          },
        ],
      },
    ],
    photos: [
      {
        position: 0,
        is_cover: true,
        width: 800,
        height: 600,
        file: 'photos/01HZX3Q9V5K8N2M4P6R7S8T9WA.webp',
        thumb: null,
      },
    ],
    notes: [
      {
        body: 'Good.',
        shared: false,
        author_display_name: 'Me',
        mine: true,
        created_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      },
    ],
    ratings: [
      { stars: 5, created_at: '2026-01-03T00:00:00.000Z', updated_at: '2026-01-03T00:00:00.000Z' },
    ],
  };
}

export function validDoc(): BackupV1 {
  return {
    version: 1,
    exported_at: '2026-01-04T00:00:00.000Z',
    app_version: '0.5.1',
    scope: 'own',
    recipes: [validRecipe()],
  };
}

/** The same shape as scope 'all': needs users, owner/author/user emails, no `mine`. */
export function validAllDoc(): BackupV1 {
  const r = validRecipe();
  const n: Record<string, unknown> = { ...r.notes[0] };
  delete n.mine;
  return {
    ...validDoc(),
    scope: 'all',
    users: [
      { email: 'a@x.test', display_name: 'A', role: 'admin', unit_pref: 'metric', locale: 'en' },
    ],
    recipes: [
      {
        ...r,
        owner_email: 'a@x.test',
        notes: [{ ...(n as Omit<BackupNote, 'mine'>), author_email: 'a@x.test' }],
        ratings: [{ ...r.ratings[0], user_email: 'a@x.test' }],
      },
    ],
  };
}
