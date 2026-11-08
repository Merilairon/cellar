'use client';

import { useEffect, useRef, useState } from 'react';

/** Plate-and-fork line icon, decorative. */
export function PlateIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="size-12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="24" cy="24" r="9" />
      <circle cx="24" cy="24" r="14" />
      <path d="M5 8v10a3 3 0 0 0 3 3v19M9 8v13M13 8v10a3 3 0 0 1-3 3" />
      <path d="M43 8c-3 2-4 6-4 11 0 2 1 3 3 3v18" />
    </svg>
  );
}

/**
 * A fixed-ratio media box with the authenticated photo inside. Plain `<img>`: `next/image`
 * would fetch the URL without the user's cookie (G13). No photo or a load error shows the
 * placeholder, never a broken-image icon. `box` carries the aspect ratio and sizing.
 */
export function CoverImage({
  photoId,
  thumb = false,
  alt,
  width,
  height,
  box,
  eager = false,
  priority = false,
  unavailableText,
}: {
  photoId: string | null;
  thumb?: boolean;
  alt: string;
  width: number;
  height: number;
  box: string;
  eager?: boolean;
  priority?: boolean;
  /** Visible text when a photo that should exist fails to load (recipe page hero). */
  unavailableText?: string;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const failed = photoId !== null && failedId === photoId;
  // A load error that fired before hydration never reached React's onError.
  useEffect(() => {
    const el = img.current;
    if (photoId && el && el.complete && el.naturalWidth === 0) setFailedId(photoId);
  }, [photoId]);

  const base = `relative overflow-hidden bg-[var(--rg-empty)] text-[var(--rg-muted)] ${box}`;
  if (photoId === null || failed) {
    return (
      <div className={`${base} flex flex-col items-center justify-center gap-1`}>
        <PlateIcon />
        {failed && unavailableText && <span className="text-sm">{unavailableText}</span>}
      </div>
    );
  }
  return (
    <div className={base}>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated source, see above */}
      <img
        ref={img}
        key={photoId}
        src={`/api/photos/${photoId}${thumb ? '?size=thumb' : ''}`}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : undefined}
        onError={() => setFailedId(photoId)}
        className="size-full object-cover"
      />
    </div>
  );
}
