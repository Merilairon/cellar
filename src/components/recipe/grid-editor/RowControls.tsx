'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { PHONE_QUERY, useMediaQuery } from '../useViewPreference';
import { RowSheet } from './RowSheet';

export type RowActionId =
  'edit' | 'moveUp' | 'moveDown' | 'addBelow' | 'split' | 'renamePortion' | 'delete';

export type RowControlsProps = {
  name: string;
  rowKey: string;
  /** "Portion 1 of 2" source, or null. */
  portion: { n: number; total: number } | null;
  isFirst: boolean;
  isLast: boolean;
  /** Add row below and Split are refused at the 200-row cap. */
  atCap: boolean;
  onAction: (id: RowActionId, origin: 'inline' | 'menu') => void;
  menuButtonRef?: (el: HTMLButtonElement | null) => void;
};

const iconBtn =
  'inline-flex min-h-[var(--ge-target)] min-w-[var(--ge-target)] items-center justify-center rounded border border-neutral-500 px-2 hover:bg-neutral-100 aria-disabled:opacity-50 dark:hover:bg-neutral-800';

/**
 * Per-row controls (UX spec 3, 7). Move up / Move down are inline only from 900 px up (CSS
 * `display: none` under it removes them from the tab order and the accessibility tree); the
 * Row actions menu button is always there and lists every action, so under 900 px it is the
 * only per-row control. Below 640 px the row sheet (T8) replaces this menu.
 */
export function RowControls({
  name,
  rowKey,
  portion,
  isFirst,
  isLast,
  atCap,
  onAction,
  menuButtonRef,
}: RowControlsProps) {
  const t = useTranslations();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const openMenu = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus();
    const away = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node))
        setOpen(false);
    };
    const hide = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  const items: { id: RowActionId; label: string; disabled?: boolean }[] = [
    { id: 'edit', label: t('gridEditor.row.edit') },
    { id: 'moveUp', label: t('gridEditor.row.moveUp', { name }), disabled: isFirst },
    { id: 'moveDown', label: t('gridEditor.row.moveDown', { name }), disabled: isLast },
    { id: 'addBelow', label: t('gridEditor.row.addBelow'), disabled: atCap },
    ...(portion
      ? [{ id: 'renamePortion' as const, label: t('gridEditor.row.renamePortion') }]
      : [{ id: 'split' as const, label: t('gridEditor.row.split'), disabled: atCap }]),
    { id: 'delete', label: t('gridEditor.row.delete') },
  ];

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(true);
  };

  return (
    <div data-ge-rowkey={rowKey} className="ge-rowctl flex shrink-0 items-center gap-1 pe-1">
      {portion && (
        <span className="ge-chip rounded border border-current px-1.5 text-xs font-normal">
          {t('gridEditor.row.portionChip', portion)}
        </span>
      )}
      <button
        type="button"
        className={`${iconBtn} max-[899px]:hidden`}
        data-ge-act="moveUp"
        aria-disabled={isFirst}
        aria-label={t('gridEditor.row.moveUp', { name })}
        onClick={() => onAction('moveUp', 'inline')}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        className={`${iconBtn} max-[899px]:hidden`}
        data-ge-act="moveDown"
        aria-disabled={isLast}
        aria-label={t('gridEditor.row.moveDown', { name })}
        onClick={() => onAction('moveDown', 'inline')}
      >
        <span aria-hidden="true">↓</span>
      </button>
      <button
        type="button"
        ref={(el) => {
          button.current = el;
          menuButtonRef?.(el);
        }}
        className={iconBtn}
        aria-haspopup={isPhone ? 'dialog' : 'menu'}
        aria-expanded={isPhone ? sheetOpen : open}
        aria-label={t('gridEditor.row.actionsFor', { name })}
        title={t('gridEditor.row.actions')}
        onClick={() => (isPhone ? setSheetOpen(true) : open ? close(false) : openMenu())}
      >
        <span aria-hidden="true">…</span>
      </button>
      {isPhone && sheetOpen && (
        <RowSheet
          name={name}
          items={items}
          onClose={() => setSheetOpen(false)}
          onPick={(id) => {
            const it = items.find((x) => x.id === id);
            // Disabled items stay focusable but do nothing (same as the menu).
            if (!it || it.disabled) return;
            setSheetOpen(false);
            onAction(id as RowActionId, 'menu');
          }}
        />
      )}
      {!isPhone &&
        open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={t('gridEditor.row.actionsFor', { name })}
            className="fixed z-40 flex min-w-48 flex-col rounded border border-neutral-500 p-1 shadow-lg"
            style={{ top: pos.top, right: pos.right, background: 'var(--rg-surface)' }}
            onKeyDown={onMenuKey}
          >
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={it.disabled || undefined}
                className="min-h-[var(--ge-target)] rounded px-3 text-left hover:bg-neutral-100 aria-disabled:opacity-50 dark:hover:bg-neutral-800"
                onClick={() => {
                  setOpen(false);
                  onAction(it.id, 'menu');
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
