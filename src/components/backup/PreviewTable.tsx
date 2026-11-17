import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { PREVIEW_ROWS, splitConflicts, type Preview } from './backup-logic';

const ROW_LABELS = {
  recipes: 'backup.preview.recipes',
  sections: 'backup.preview.sections',
  notes: 'backup.preview.notes',
  ratings: 'backup.preview.ratings',
  photos: 'backup.preview.photos',
} as const;

/** Counts, conflicts and unknown owners of a staged backup. Every string is rendered as React text. */
export function PreviewTable({
  preview,
  role,
  captionRef,
}: {
  preview: Preview;
  role: 'admin' | 'member';
  captionRef?: React.Ref<HTMLElement>;
}) {
  const t = useTranslations();
  const uid = useId();
  const { head, rest } = splitConflicts(preview.conflicts.map((c) => c.title));
  const showUnknown =
    role === 'admin' && preview.scope === 'all' && preview.unknown_users.length > 0;

  return (
    <div className="space-y-4">
      <table className="w-full max-w-md border-collapse">
        <caption
          ref={captionRef as React.Ref<HTMLTableCaptionElement>}
          tabIndex={-1}
          className="mb-1 text-left text-lg font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--rg-focus)]"
        >
          {t('backup.preview.caption')}
        </caption>
        <tbody>
          {PREVIEW_ROWS.map((row) => (
            <tr key={row} className="border-b border-neutral-300 dark:border-neutral-700">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {t(ROW_LABELS[row])}
              </th>
              <td className="py-2 text-right tabular-nums">{preview[row]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        {t(preview.scope === 'all' ? 'backup.preview.scopeAll' : 'backup.preview.scopeOwn')}
      </p>

      {preview.conflicts.length > 0 && (
        <div>
          <h3 id={`${uid}-conf`} className="font-semibold">
            {t('backup.preview.conflicts', { count: preview.conflicts.length })}
          </h3>
          <ul aria-labelledby={`${uid}-conf`} className="mt-1 list-disc pl-6 break-words">
            {head.map((title, i) => (
              <li key={i}>{title}</li>
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-1">
              <summary className="min-h-11 cursor-pointer py-2">
                {t('backup.preview.showAll', { count: preview.conflicts.length })}
              </summary>
              <ul className="list-disc pl-6 break-words">
                {rest.map((title, i) => (
                  <li key={i}>{title}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {showUnknown && (
        <div>
          <h3 id={`${uid}-unk`} className="font-semibold">
            {t('backup.preview.unknownUsers', { count: preview.unknown_users.length })}
          </h3>
          <ul aria-labelledby={`${uid}-unk`} className="mt-1 list-disc pl-6 break-all">
            {preview.unknown_users.map((email, i) => (
              <li key={i}>{email}</li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {t('backup.preview.unknownUsersHelp')}
          </p>
        </div>
      )}

      {(preview.notes_skipped > 0 || preview.ratings_skipped > 0) && role === 'member' && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {preview.notes_skipped > 0 && t('backup.preview.othersNotes')}
          {preview.notes_skipped > 0 && preview.ratings_skipped > 0 && ' '}
          {preview.ratings_skipped > 0 &&
            t('backup.preview.ratingsSkipped', { count: preview.ratings_skipped })}
        </p>
      )}
    </div>
  );
}
