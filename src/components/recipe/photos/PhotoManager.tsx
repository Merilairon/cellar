'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { call } from '../api';
import { btn, btnDanger, errorText } from '../styles';
import { CoverImage } from './CoverImage';
import { uploadErrorMessage } from './photo-messages';
import {
  PHOTO_ACCEPT,
  PHOTO_MAX_COUNT,
  precheck,
  uploadPhoto,
  type UploadError,
} from './photo-upload';
import { usePhotos, type Photo } from './PhotosProvider';

type Item = {
  key: number;
  name: string;
  file: File | null;
  status: 'queued' | 'uploading' | 'done' | 'error';
  percent: number;
  batchIndex: number;
  batchSize: number;
  becameCover: boolean;
  error: UploadError | null;
  /** Text for a problem that is not an upload error (cover or delete failed). */
  message: string | null;
};

/** Inline panel under the hero: add, make cover, delete. Owner or admin only (the caller checks). */
export function PhotoManager({ onDone }: { onDone: () => void }) {
  const t = useTranslations();
  const { recipeId, photos, setPhotos } = usePhotos();
  const [items, setItems] = useState<Item[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const itemsRef = useRef<Item[]>([]);
  const running = useRef(false);
  const added = useRef(0);
  const nextKey = useRef(1);
  const root = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLElement>(null);

  const commit = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (key: number, change: Partial<Item>) =>
    commit(itemsRef.current.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const focusLater = (selector: string, fallback?: () => void) =>
    requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(selector);
      if (el) el.focus();
      else fallback?.();
    });

  const drain = async () => {
    for (;;) {
      const next = itemsRef.current.find((i) => i.status === 'queued');
      if (!next || !next.file) break;
      patch(next.key, { status: 'uploading', percent: 0 });
      const res = await uploadPhoto(recipeId, next.file, (percent) => patch(next.key, { percent }));
      if (res.ok) {
        added.current++;
        // The server decides the cover (the first photo becomes it); take its flag as is.
        setPhotos((prev) => {
          const base = res.photo.is_cover ? prev.map((p) => ({ ...p, is_cover: false })) : prev;
          return [...base, res.photo];
        });
        patch(next.key, {
          status: 'done',
          percent: 100,
          becameCover: res.photo.is_cover,
          file: null,
        });
      } else {
        patch(next.key, { status: 'error', error: { key: res.key, retry: res.retry } });
        setStatus(uploadErrorMessage(t, res.key, next.name));
      }
    }
  };

  const pump = async () => {
    if (running.current) return;
    running.current = true;
    await drain().finally(() => {
      running.current = false;
    });
    if (added.current > 0) {
      setStatus(
        added.current === 1
          ? t('photos.upload.added')
          : t('photos.upload.addedMany', { n: added.current }),
      );
      added.current = 0;
    }
  };

  const pick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = [...files];
    let room =
      PHOTO_MAX_COUNT -
      photos.length -
      itemsRef.current.filter((i) => i.status === 'queued' || i.status === 'uploading').length;
    const fresh: Item[] = picked.map((file, n) => {
      const base = {
        key: nextKey.current++,
        name: file.name,
        file,
        percent: 0,
        batchIndex: n + 1,
        batchSize: picked.length,
        becameCover: false,
        message: null,
      };
      const bad = precheck(file) ?? (room <= 0 ? ({ key: 'limit', retry: false } as const) : null);
      if (bad) return { ...base, file: null, status: 'error', error: bad };
      room--;
      return { ...base, status: 'queued', error: null };
    });
    const firstBad = fresh.find((i) => i.error);
    if (firstBad?.error) setStatus(uploadErrorMessage(t, firstBad.error.key, firstBad.name));
    commit([...itemsRef.current, ...fresh]);
    void pump();
  };

  const retry = (item: Item) => {
    // The file was dropped only on success, so an errored item still has it.
    if (!item.file) return;
    patch(item.key, { status: 'queued', error: null, percent: 0 });
    void pump();
  };
  const dismiss = (key: number) => commit(itemsRef.current.filter((i) => i.key !== key));
  const problem = (message: string) => {
    commit([
      ...itemsRef.current,
      {
        key: nextKey.current++,
        name: '',
        file: null,
        status: 'error',
        percent: 0,
        batchIndex: 1,
        batchSize: 1,
        becameCover: false,
        error: null,
        message,
      },
    ]);
    setStatus(message);
  };

  const makeCover = async (id: string, n: number) => {
    const before = photos;
    setPhotos((prev) => prev.map((p) => ({ ...p, is_cover: p.id === id })));
    const res = await call(`/api/recipes/${recipeId}/photos/${id}/cover`, 'PUT');
    if (res?.ok) {
      setPhotos(((await res.json()) as { photos: Photo[] }).photos);
      setStatus(t('photos.nowCover', { n, total: before.length }));
    } else {
      setPhotos(before);
      problem(t('photos.error.coverFailed'));
    }
  };

  const remove = async (id: string) => {
    const index = photos.findIndex((p) => p.id === id);
    const wasCover = photos[index]?.is_cover ?? false;
    const neighbour = photos[index + 1] ?? photos[index - 1] ?? null;
    const res = await call(`/api/photos/${id}`, 'DELETE');
    setConfirmId(null);
    if (res?.status !== 204 && res?.status !== 404) {
      problem(t('photos.error.deleteFailed'));
      focusLater(`[data-tile="${id}"] button`);
      return;
    }
    // The server promotes the next photo when the cover goes; ask it rather than guess.
    let next: Photo[] = photos.filter((p) => p.id !== id);
    const list = await call(`/api/recipes/${recipeId}/photos`, 'GET');
    if (list?.ok) next = ((await list.json()) as { photos: Photo[] }).photos;
    setPhotos(next);
    const newCover = next.findIndex((p) => p.is_cover);
    setStatus(
      wasCover && newCover >= 0
        ? `${t('photos.deleted')} ${t('photos.nowCover', { n: newCover + 1, total: next.length })}`
        : t('photos.deleted'),
    );
    focusLater(neighbour ? `[data-tile="${neighbour.id}"] button` : '[data-add]', () =>
      addRef.current?.focus(),
    );
  };

  const full = photos.length >= PHOTO_MAX_COUNT;
  const limitId = 'photo-limit-note';
  const rowText = (i: Item) => {
    if (i.message) return i.message;
    if (i.error) return uploadErrorMessage(t, i.error.key, i.name);
    if (i.status === 'done') {
      return `${i.name}: ${i.becameCover ? t('photos.upload.addedCover') : t('photos.upload.addedRow')}`;
    }
    return '';
  };

  return (
    <div ref={root} className="mt-4 rounded border border-neutral-500 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t('photos.heading')} ({t('photos.count', { n: photos.length, max: PHOTO_MAX_COUNT })})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {full ? (
            <>
              <button
                ref={addRef as React.RefObject<HTMLButtonElement>}
                type="button"
                data-add
                className={`${btn} aria-disabled:opacity-60`}
                aria-disabled="true"
                aria-describedby={limitId}
                onClick={() => setStatus(t('photos.upload.limitReached'))}
              >
                {t('photos.add')}
              </button>
              <span id={limitId} className="sr-only">
                {t('photos.upload.limitReached')}
              </span>
            </>
          ) : (
            <label
              ref={addRef as React.RefObject<HTMLLabelElement>}
              data-add
              className={`${btn} cursor-pointer has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--rg-focus)]`}
            >
              {t('photos.add')}
              <input
                type="file"
                accept={PHOTO_ACCEPT}
                multiple
                className="md-visually-hidden"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <button type="button" className={btn} onClick={onDone}>
            {t('photos.done')}
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">
        {status}
      </p>

      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.key} className="rounded border border-neutral-400 p-2 text-sm">
              {(i.status === 'queued' || i.status === 'uploading') && (
                <>
                  <span className="break-all">{i.name}</span>
                  <div className="flex items-center gap-2">
                    <progress className="h-3 w-40 max-w-full" max={100} value={i.percent} />
                    <span>
                      {i.status === 'queued'
                        ? t('photos.upload.pending')
                        : t('photos.upload.progress', {
                            i: i.batchIndex,
                            n: i.batchSize,
                            percent: i.percent,
                          })}
                    </span>
                  </div>
                </>
              )}
              {i.status === 'done' && <span>{rowText(i)}</span>}
              {i.status === 'error' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${errorText} mt-0`}>
                    <span aria-hidden="true">× </span>
                    {t('photos.upload.problem')}: {rowText(i)}
                  </span>
                  {i.error?.retry && i.file && (
                    <button type="button" className={btn} onClick={() => retry(i)}>
                      {t('photos.upload.retry')}
                    </button>
                  )}
                  <button type="button" className={btn} onClick={() => dismiss(i.key)}>
                    {t('photos.upload.dismiss')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {photos.length === 0 ? (
        <p className="mt-3">{t('photos.empty')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3">
          {photos.map((p, idx) => {
            const label = t('photos.alt.item', { n: idx + 1, total: photos.length });
            const confirming = confirmId === p.id;
            return (
              <li key={p.id} data-tile={p.id} className="flex flex-col gap-2">
                <div className="relative">
                  <CoverImage
                    photoId={p.id}
                    thumb
                    alt={label}
                    width={400}
                    height={300}
                    box="aspect-[4/3] w-full rounded"
                  />
                  {p.is_cover && (
                    <span className="absolute left-1 top-1 rounded border border-neutral-700 bg-white px-2 py-0.5 text-sm font-semibold text-neutral-900">
                      <span aria-hidden="true">* </span>
                      {t('photos.cover')}
                    </span>
                  )}
                </div>
                {confirming ? (
                  <div
                    role="group"
                    aria-label={t('photos.deleteConfirm')}
                    className="flex flex-col gap-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setConfirmId(null);
                        focusLater(`[data-tile="${p.id}"] [data-act="delete"]`);
                      }
                    }}
                  >
                    <p className="text-sm">{t('photos.deleteConfirm')}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnDanger} onClick={() => void remove(p.id)}>
                        {t('photos.deleteYes')}
                      </button>
                      <button
                        type="button"
                        className={btn}
                        autoFocus
                        onClick={() => {
                          setConfirmId(null);
                          focusLater(`[data-tile="${p.id}"] [data-act="delete"]`);
                        }}
                      >
                        {t('photos.deleteKeep')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {!p.is_cover && (
                      <button
                        type="button"
                        className={btn}
                        aria-label={`${t('photos.makeCover')} (${label})`}
                        onClick={() => void makeCover(p.id, idx + 1)}
                      >
                        {t('photos.makeCover')}
                      </button>
                    )}
                    <button
                      type="button"
                      data-act="delete"
                      className={btnDanger}
                      aria-label={`${t('photos.delete')} (${label})`}
                      onClick={() => setConfirmId(p.id)}
                    >
                      {t('photos.delete')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
