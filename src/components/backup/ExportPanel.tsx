'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { btnPrimary } from '../recipe/styles';
import { exportHref } from './backup-logic';

const box = 'mt-1 size-5 shrink-0 accent-emerald-700';

/** Export section (UX spec 5.2): checkboxes shape the href of one `<a download>`. */
export function ExportPanel({ role }: { role: 'admin' | 'member' }) {
  const t = useTranslations();
  const uid = useId();
  const [photos, setPhotos] = useState(false);
  const [all, setAll] = useState(false);
  const headingId = `${uid}-h`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-xl font-semibold">
        {t('backup.export.heading')}
      </h2>
      <p className="text-neutral-700 dark:text-neutral-300">{t('backup.export.intro')}</p>
      <div className="space-y-3">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            className={box}
            checked={photos}
            onChange={(e) => setPhotos(e.target.checked)}
            aria-describedby={`${uid}-photos`}
          />
          <span>
            {t('backup.export.photos')}
            <span
              id={`${uid}-photos`}
              className="block text-sm text-neutral-700 dark:text-neutral-300"
            >
              {t('backup.export.photosHelp')}
            </span>
          </span>
        </label>
        {role === 'admin' && (
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className={box}
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
              aria-describedby={`${uid}-all`}
            />
            <span>
              {t('backup.export.all')}
              <span
                id={`${uid}-all`}
                className="block text-sm text-neutral-700 dark:text-neutral-300"
              >
                {t('backup.export.allHelp')}
              </span>
            </span>
          </label>
        )}
      </div>
      <a
        href={exportHref({ photos, all: role === 'admin' && all })}
        download
        className={btnPrimary}
      >
        {t('backup.export.download')}
      </a>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {t('backup.export.excluded')}
      </p>
    </section>
  );
}
