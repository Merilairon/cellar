import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { RatingFilter } from '../search/RatingFilter';
import { Notes, type Note } from './notes/Notes';
import { PhotosPanel } from './photos/PhotosPanel';
import { PhotosProvider, PhotosToggle } from './photos/PhotosProvider';
import { RatingSummary, CardRating } from './rating/RatingSummary';
import { StarRating } from './rating/StarRating';
import { RecipeCard } from './RecipeCard';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

const card = {
  id: 'R1',
  title: 'Cake',
  owner_display_name: 'Marie',
  is_owner: true,
  visibility: 'private' as const,
  updated_at: '2026-11-01T10:00:00.000Z',
  tags: [],
};

describe('RecipeCard media and rating', () => {
  it('shows the thumb with empty alt, fixed size and lazy loading', () => {
    const html = wrap(<RecipeCard recipe={{ ...card, cover_photo_id: 'P1' }} />);
    expect(html).toContain('src="/api/photos/P1?size=thumb"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="400"');
    expect(html).toContain('loading="lazy"');
  });
  it('shows the placeholder box (no img) without a cover', () => {
    const html = wrap(<RecipeCard recipe={card} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('aspect-[4/3]');
  });
  it('shows the average, or "Not rated yet"', () => {
    expect(wrap(<CardRating avg={4.25} count={5} />)).toContain(
      'Average rating 4.3 of 5 from 5 ratings',
    );
    expect(wrap(<CardRating avg={null} count={0} />)).toContain('Not rated yet');
  });
});

describe('rating UI', () => {
  it('summary reads as one string, plural aware', () => {
    expect(wrap(<RatingSummary avg={4.3} count={5} />)).toContain('4.3 from 5 ratings');
    expect(wrap(<RatingSummary avg={4} count={1} />)).toContain('4.0 from 1 rating<');
    expect(wrap(<RatingSummary avg={null} count={0} />)).toContain('No ratings yet');
  });
  it('star control is a radio group of five with names and text', () => {
    const html = wrap(<StarRating mine={3} onSelect={() => {}} onClear={() => {}} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain('aria-label="3 of 5 stars"');
    expect(html).toContain('Your rating: 3 of 5');
    expect(html).toContain('Clear my rating');
  });
  it('unrated: text says so and there is no clear button', () => {
    const html = wrap(<StarRating mine={null} onSelect={() => {}} onClear={() => {}} />);
    expect(html).toContain('Not rated yet');
    expect(html).not.toContain('Clear my rating');
  });
  it('filter chips link to a shareable URL and mark the active one', () => {
    const html = wrap(<RatingFilter filters={{ q: 'cake', minRating: '4' }} />);
    expect(html).toContain('href="/recipes?q=cake&amp;min_rating=3"');
    expect(html).toMatch(
      /aria-current="true"[^>]*aria-label="4 stars or more"|aria-label="4 stars or more"[^>]*aria-current="true"|href="\/recipes\?q=cake&amp;min_rating=4"[^>]*aria-current/,
    );
    expect(html).toContain('href="/recipes?q=cake"'); // Any / remove
    expect(html).toContain('Recipes nobody has rated are hidden.');
  });
  it('min_rating=1 from a pasted URL presses no chip but shows the removable chip', () => {
    const html = wrap(<RatingFilter filters={{ minRating: '1' }} />);
    expect(html).not.toContain('aria-current');
    expect(html).toContain('1+ stars');
    expect(html).toContain('Remove minimum rating filter');
  });
  it('no filter: Any is current and there is no helper', () => {
    const html = wrap(<RatingFilter filters={{}} />);
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain('hidden.');
  });
});

describe('photos UI', () => {
  const photos = [
    { id: 'A', width: 1600, height: 1200, is_cover: false },
    { id: 'B', width: 1600, height: 1200, is_cover: true },
  ];
  const render = (canEdit: boolean, list = photos) =>
    wrap(
      <PhotosProvider recipeId="R1" title="Cake" canEdit={canEdit} initialPhotos={list}>
        <PhotosToggle />
        <PhotosPanel />
      </PhotosProvider>,
    );
  it('hero is the cover with the fixed alt, gallery thumbs use "Photo n of total"', () => {
    const html = render(false);
    expect(html).toContain('src="/api/photos/B"');
    expect(html).toContain('alt="Photo of Cake"');
    expect(html).toContain('alt="Photo 1 of 2"');
    expect(html).toContain('alt="Photo 2 of 2"');
    expect(html).toContain('fetchPriority="high"');
  });
  it('a reader gets no controls', () => {
    const html = render(false);
    expect(html).not.toContain('Edit photos');
  });
  it('an owner gets the toggle, collapsed', () => {
    const html = render(true);
    expect(html).toContain('Edit photos');
    expect(html).toContain('aria-expanded="false"');
  });
  it('no photos: reader sees nothing, owner sees the prompt', () => {
    expect(render(false, [])).toBe('');
    const html = render(true, []);
    expect(html).toContain('No photo yet');
    expect(html).toContain('Add a photo');
  });
  it('a single photo has no gallery strip', () => {
    expect(render(false, [photos[1]!])).not.toContain('<ul');
  });
});

describe('Notes', () => {
  const notes: Note[] = [
    {
      id: 'N1',
      body: 'Less <b>sugar</b>\nnext time',
      shared: true,
      author: 'Marie',
      mine: false,
      created_at: '2026-11-03T10:00:00.000Z',
      updated_at: '2026-11-03T10:00:00.000Z',
    },
    {
      id: 'N2',
      body: 'Small tin',
      shared: false,
      author: 'Jan',
      mine: true,
      created_at: '2026-11-05T10:00:00.000Z',
      updated_at: '2026-11-05T10:00:00.000Z',
    },
  ];
  const html = (canManage: boolean) =>
    wrap(<Notes recipeId="R1" canManage={canManage} initialNotes={notes} />);
  it('lists notes with count, markers as text, author names and escaped bodies', () => {
    const out = html(false);
    expect(out).toContain('Notes (2)');
    expect(out).toContain('Marie');
    expect(out).toContain('Shared');
    expect(out).toContain('Only you');
    expect(out).toContain('You');
    expect(out).toContain('Less &lt;b&gt;sugar&lt;/b&gt;');
    expect(out).not.toContain('<b>');
  });
  it('edit only on own notes; delete on own, and on shared notes only for the owner/admin', () => {
    const reader = html(false);
    expect(reader.match(/data-act="edit"/g)).toHaveLength(1);
    expect(reader.match(/data-act="delete"/g)).toHaveLength(1);
    const owner = html(true);
    expect(owner.match(/data-act="edit"/g)).toHaveLength(1);
    expect(owner.match(/data-act="delete"/g)).toHaveLength(2);
  });
  it('defaults the new note to private and shows the counter and empty state', () => {
    const out = wrap(<Notes recipeId="R1" canManage={false} initialNotes={[]} />);
    expect(out).toContain('No notes yet.');
    expect(out).toContain('0 / 4000');
    expect(out).toMatch(/<input[^>]*checked=""[^>]*\/>\s*Only me/);
  });
});
