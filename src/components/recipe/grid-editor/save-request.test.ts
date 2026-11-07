import { describe, expect, it } from 'vitest';
import { doc, fromApiRecipe, reduce } from '@/lib/grid/editor';
import { SAMPLE_VANILLA_CAKE } from '@/lib/recipes/samples';
import { runGridSave, type Request } from './save-request';

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const start = () => fromApiRecipe(SAMPLE_VANILLA_CAKE);
const recipeBody = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', view_mode: 'grid' };

describe('runGridSave', () => {
  it('M1: a 422 is mapped against the SENT document and carries it', async () => {
    const sent = start();
    const row3 = doc(sent).sections[0].ingredients[3].key;
    // The user deletes row 0 while the request is in flight; the 422 still indexes into `sent`.
    const later = reduce(sent, { type: 'rowDelete', section: 0, row: 0 });
    expect(doc(later)).not.toBe(doc(sent));
    const request: Request = async () =>
      json(422, { errors: [{ path: 'sections.0.ingredients.3.name', code: 'name_empty' }] });
    const out = await runGridSave('r1', sent, 'b', request);
    expect(out.kind).toBe('rejected');
    if (out.kind !== 'rejected') return;
    expect(out.doc).toBe(doc(sent));
    expect(out.doc).not.toBe(doc(later));
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].target).toMatchObject({ rowKey: row3 });
  });

  it('saved: returns the recipe from the body', async () => {
    const out = await runGridSave('r1', start(), 'b', async () => json(200, recipeBody));
    expect(out).toMatchObject({ kind: 'saved', recipe: { updated_at: recipeBody.updated_at } });
  });

  it('m12: a 200 with an unreadable body refetches the stamp instead of failing', async () => {
    const calls: string[] = [];
    const request: Request = async (url, method) => {
      calls.push(`${method} ${url}`);
      return method === 'PUT' ? json(200, 'not json') : json(200, recipeBody);
    };
    const out = await runGridSave('r1', start(), 'b', request);
    expect(out.kind).toBe('saved');
    expect(calls).toEqual(['PUT /api/recipes/r1/grid', 'GET /api/recipes/r1']);
  });

  it('m12: a 200 whose body and refetch are both unreadable is savedUnreadable, not failed', async () => {
    const request: Request = async (_u, method) => (method === 'PUT' ? json(200, '{}') : null);
    expect((await runGridSave('r1', start(), 'b', request)).kind).toBe('savedUnreadable');
  });

  it('409 yields the server stamp; other statuses and network errors are failed', async () => {
    const stamp = '2026-02-02T00:00:00.000Z';
    expect(
      await runGridSave('r1', start(), 'b', async () => json(409, { updated_at: stamp })),
    ).toEqual({
      kind: 'conflict',
      stamp,
    });
    expect((await runGridSave('r1', start(), 'b', async () => json(500, {}))).kind).toBe('failed');
    expect((await runGridSave('r1', start(), 'b', async () => null)).kind).toBe('failed');
  });
});
