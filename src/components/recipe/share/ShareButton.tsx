'use client';

import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Visibility } from '@/lib/recipes/schemas';
import { btn } from '../styles';
import { ShareDialog } from './ShareDialog';
import { chipKey, linkIsOn } from './share-state';
import { useShare } from './useShare';

/** Share button plus a state chip; owns the dialog and its requests (UX spec 1.1, 1.2). */
export function ShareButton({
  id,
  title,
  visibility,
  shareUrl,
  publicLinksEnabled,
  warningSource,
}: {
  id: string;
  title: string;
  visibility: Visibility;
  shareUrl: string | null;
  publicLinksEnabled: boolean;
  /** Set only for an imported, unedited recipe: shows the copyright notice. */
  warningSource?: { source: string | null } | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  // A request that finishes after the dialog closed refreshes at once; otherwise on close.
  const onSettled = useCallback(() => {
    if (!openRef.current) router.refresh();
  }, [router]);
  const share = useShare(
    id,
    { visibility, url: shareUrl, linksEnabled: publicLinksEnabled },
    onSettled,
  );
  const { state, dispatch } = share;

  const close = () => {
    if (!openRef.current) return; // the native close event follows a programmatic close
    openRef.current = false;
    setOpen(false);
    if (state.dirty) router.refresh(); // once per close, not per action
    dispatch({ type: 'close' });
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${btn} gap-2`}
        aria-haspopup="dialog"
        onClick={() => {
          // After Escape the native dialog is closed before React hears the `close` event. A click
          // in that gap finds `open` still true, so finish the pending close first, then reopen.
          if (openRef.current) flushSync(close);
          openRef.current = true;
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            d="M12 15V4m0 0L8 8m4-4l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t('share.open')}
      </button>
      <span className="text-sm text-[var(--rg-muted)]">
        {t(chipKey(state.visibility, linkIsOn(state)))}
      </span>
      <ShareDialog
        open={open}
        onClose={close}
        title={title}
        state={state}
        dispatch={dispatch}
        warningSource={warningSource}
        onVisibility={share.setVisibility}
        onMakeLink={share.makeLink}
        onRevoke={share.revoke}
        onCopy={share.copy}
      />
    </>
  );
}
