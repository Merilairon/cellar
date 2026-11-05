'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Visibility } from '@/lib/recipes/schemas';
import { call } from './api';
import { btn, btnDanger } from './styles';

/** Save a copy: any reader who is not the owner. Creates a private, independent recipe. */
export function SaveCopyButton({ id }: { id: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const res = await call(`/api/recipes/${id}/copy`, 'POST');
          if (res?.status === 201) {
            router.push(`/recipes/${((await res.json()) as { id: string }).id}`);
            return;
          }
          setFailed(true);
          setBusy(false);
        }}
      >
        {t('recipe.actions.saveCopy')}
      </button>
      {failed && (
        <span role="alert" className="text-red-700 dark:text-red-400">
          {t('recipe.errors.saveFailed')}
        </span>
      )}
    </>
  );
}

/** Owner/admin only: share read-only with all signed-in users, or keep private. */
export function VisibilityControl({ id, visibility }: { id: string; visibility: Visibility }) {
  const t = useTranslations();
  const router = useRouter();
  const [current, setCurrent] = useState<Visibility>(visibility);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  return (
    <div className="flex items-center gap-2">
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="size-5"
          checked={current === 'users'}
          onChange={async (e) => {
            const next: Visibility = e.target.checked ? 'users' : 'private';
            setCurrent(next); // optimistic; reverted below if the request fails
            const res = await call(`/api/recipes/${id}/visibility`, 'PUT', { visibility: next });
            if (res?.ok) {
              setStatus('saved');
              router.refresh();
            } else {
              setCurrent(next === 'users' ? 'private' : 'users');
              setStatus('failed');
            }
          }}
        />
        {t('recipe.visibility.shareLabel')}
      </label>
      <span role="status" className="text-sm text-neutral-700 dark:text-neutral-300">
        {status === 'saved' &&
          t(current === 'users' ? 'recipe.visibility.nowShared' : 'recipe.visibility.nowPrivate')}
        {status === 'failed' && t('recipe.errors.saveFailed')}
      </span>
    </div>
  );
}

/** Edit link plus a two-step delete (no browser confirm dialog). */
export function OwnerActions({ id }: { id: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Link href={`/recipes/${id}/edit`} className={btn}>
        {t('recipe.actions.edit')}
      </Link>
      {confirming ? (
        <span
          role="group"
          aria-label={t('recipe.actions.confirmDelete')}
          className="flex items-center gap-2"
        >
          <span>{t('recipe.actions.confirmDelete')}</span>
          <button
            type="button"
            className={btnDanger}
            autoFocus
            onClick={async () => {
              const res = await call(`/api/recipes/${id}`, 'DELETE');
              if (res?.status === 204) {
                router.push('/recipes');
                router.refresh();
              } else setFailed(true);
            }}
          >
            {t('recipe.actions.deleteYes')}
          </button>
          <button type="button" className={btn} onClick={() => setConfirming(false)}>
            {t('recipe.actions.cancel')}
          </button>
        </span>
      ) : (
        <button type="button" className={btnDanger} onClick={() => setConfirming(true)}>
          {t('recipe.actions.delete')}
        </button>
      )}
      {failed && (
        <span role="alert" className="text-red-700 dark:text-red-400">
          {t('recipe.errors.saveFailed')}
        </span>
      )}
    </>
  );
}
