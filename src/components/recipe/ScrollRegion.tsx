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

  return (
    <div className="rg-wrap">
      <div
        ref={ref}
        className="rg-scroller"
        role="region"
        tabIndex={0}
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
