'use client';

import { createContext, useContext, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { btn } from '../styles';

export type Photo = { id: string; width: number; height: number; is_cover: boolean };

type Ctx = {
  recipeId: string;
  title: string;
  canEdit: boolean;
  photos: Photo[];
  setPhotos: (next: Photo[] | ((prev: Photo[]) => Photo[])) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  managerId: string;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
};

const PhotosContext = createContext<Ctx | null>(null);

export function usePhotos(): Ctx {
  const ctx = useContext(PhotosContext);
  if (!ctx) throw new Error('usePhotos outside PhotosProvider');
  return ctx;
}

/**
 * Photo state for the saved recipe's page. The server sends the photos once; uploads, cover
 * changes and deletes update this copy from the API responses. The toggle (action row) and the
 * panel (hero, gallery, manager) are separate children so each can sit where the layout wants it.
 */
export function PhotosProvider({
  recipeId,
  title,
  canEdit,
  initialPhotos,
  children,
}: {
  recipeId: string;
  title: string;
  canEdit: boolean;
  initialPhotos: Photo[];
  children: React.ReactNode;
}) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [open, setOpen] = useState(false);
  const managerId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const value = useMemo(
    () => ({ recipeId, title, canEdit, photos, setPhotos, open, setOpen, managerId, toggleRef }),
    [recipeId, title, canEdit, photos, open, managerId],
  );
  return <PhotosContext.Provider value={value}>{children}</PhotosContext.Provider>;
}

/** "Edit photos" in the action row (owner or admin only). */
export function PhotosToggle() {
  const t = useTranslations();
  const { canEdit, open, setOpen, managerId, toggleRef } = usePhotos();
  if (!canEdit) return null;
  return (
    <button
      ref={toggleRef}
      type="button"
      className={btn}
      aria-expanded={open}
      aria-controls={managerId}
      onClick={() => setOpen(!open)}
    >
      {t('photos.edit')}
    </button>
  );
}
