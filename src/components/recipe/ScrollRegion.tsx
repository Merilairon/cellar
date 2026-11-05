'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Focusable horizontal scroll container with an edge fade and arrow while columns are hidden
 * off-screen. The cue is decorative; assistive tech gets a text hint instead.
 */
export function ScrollRegion({
  label,
  stepCount,
  children,
}: {
  label: string;
  stepCount: number;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const ref = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    el.addEventListener('scroll', update, { passive: true });
    // ResizeObserver fires once on observe, which sets the initial state.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  // Chromium does not scroll a focused cell that is only partly visible, so a keyboard user
  // would see a clipped cell. Bring the whole cell into view; scroll-padding (CSS) already
  // keeps it clear of the sticky ingredient column on the start side.
  const revealFocused = (e: React.FocusEvent<HTMLDivElement>) => {
    const scroller = ref.current;
    const cell = (e.target as HTMLElement).closest('td');
    if (!scroller || !cell) return;
    const s = scroller.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const startInset = parseFloat(getComputedStyle(scroller).scrollPaddingInlineStart) || 0;
    if (c.right > s.right) scroller.scrollLeft += c.right - s.right + 2;
    else if (c.left < s.left + startInset) scroller.scrollLeft -= s.left + startInset - c.left;
  };

  return (
    <div className="rg-wrap">
      <div
        ref={ref}
        className="rg-scroller"
        role="region"
        tabIndex={0}
        onFocus={revealFocused}
        aria-label={label}
        aria-describedby={more ? hintId : undefined}
      >
        {children}
      </div>
      {more && (
        <>
          <div className="rg-fade" aria-hidden="true" />
          <span className="rg-arrow" aria-hidden="true">
            ›
          </span>
          <span id={hintId} className="sr-only">
            {t('recipe.grid.scrollHint', { count: stepCount })}
          </span>
        </>
      )}
    </div>
  );
}
