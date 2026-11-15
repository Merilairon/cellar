'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Visibility } from '@/lib/recipes/schemas';
import { call } from './api';
import { PhotosToggle } from './photos/PhotosProvider';
import { ShareButton } from './share/ShareButton';
import { warningSource } from './share/share-state';
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

/**
 * The recipe page's action slot (after Cook): owner tools and Share for `can_edit` actors, Save a
 * copy for any reader who is not the owner. Readers never get the Share button (UX spec 1.1).
 */
export function RecipeActionSlot({
  recipe,
  isOwner,
  importedUnedited,
}: {
  recipe: {
    id: string;
    title: string;
    can_edit: boolean;
    visibility: Visibility;
    share: { url: string | null } | null;
    public_links_enabled: boolean;
    source_url: string | null;
    source_name: string | null;
  };
  isOwner: boolean;
  importedUnedited: boolean;
}) {
  return (
    <>
      {recipe.can_edit && <OwnerActions id={recipe.id} />}
      {recipe.can_edit && <PhotosToggle />}
      {recipe.can_edit && (
        <ShareButton
          id={recipe.id}
          title={recipe.title}
          visibility={recipe.visibility}
          shareUrl={recipe.share?.url ?? null}
          publicLinksEnabled={recipe.public_links_enabled}
          warningSource={
            importedUnedited
              ? { source: warningSource(recipe.source_url, recipe.source_name) }
              : null
          }
        />
      )}
      {!isOwner && <SaveCopyButton id={recipe.id} />}
    </>
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
