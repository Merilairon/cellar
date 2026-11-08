'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { btn } from '../styles';
import { CoverImage } from './CoverImage';
import { PhotoManager } from './PhotoManager';
import { usePhotos } from './PhotosProvider';

/** Hero, gallery strip (two or more photos), the owner's empty prompt and the manager. */
export function PhotosPanel() {
  const t = useTranslations();
  const { title, canEdit, photos, open, setOpen, managerId, toggleRef } = usePhotos();
  // A thumbnail click picks the hero until the cover changes; then the cover wins again.
  const [chosen, setChosen] = useState<{ id: string; coverAt: string | null } | null>(null);
  const cover = photos.find((p) => p.is_cover) ?? photos[0] ?? null;
  const picked =
    chosen && chosen.coverAt === (cover?.id ?? null)
      ? photos.find((p) => p.id === chosen.id)
      : undefined;
  const hero = picked ?? cover;

  const manager = (
    // Stable key: the empty and the filled layouts both render it, and the first upload switches
    // between them; without it the manager remounts and loses its upload rows and status.
    <div key="manager" id={managerId}>
      {canEdit && open && (
        <PhotoManager
          onDone={() => {
            setOpen(false);
            requestAnimationFrame(() => toggleRef.current?.focus());
          }}
        />
      )}
    </div>
  );

  if (!hero) {
    if (!canEdit) return null; // a reader sees no empty block
    return (
      <div>
        <div className="flex aspect-[4/3] w-full max-w-sm flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-neutral-500 p-4 text-center">
          <p>{t('photos.emptyPrompt')}</p>
          <button
            type="button"
            className={btn}
            aria-expanded={open}
            aria-controls={managerId}
            onClick={() => setOpen(!open)}
          >
            {t('photos.addFirst')}
          </button>
        </div>
        {manager}
      </div>
    );
  }

  const heroIndex = photos.findIndex((p) => p.id === hero.id);
  return (
    <div>
      <CoverImage
        photoId={hero.id}
        alt={t('photos.alt.hero', { title })}
        width={hero.width}
        height={hero.height}
        box="aspect-video w-full rounded md:max-h-[360px] lg:aspect-[4/3] lg:max-h-none"
        eager
        priority
        unavailableText={t('photos.unavailable')}
      />
      {photos.length >= 2 && (
        <ul aria-label={t('photos.gallery.label')} className="mt-2 flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={i === heroIndex}
                onClick={() => setChosen({ id: p.id, coverAt: cover?.id ?? null })}
                className="flex min-h-11 items-center justify-center rounded border-2 border-transparent p-0.5 aria-pressed:border-emerald-700"
              >
                <CoverImage
                  photoId={p.id}
                  thumb
                  alt={t('photos.alt.item', { n: i + 1, total: photos.length })}
                  width={72}
                  height={54}
                  box="h-[54px] w-[72px] rounded"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {manager}
    </div>
  );
}
