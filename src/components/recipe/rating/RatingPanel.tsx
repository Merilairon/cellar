'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { call } from '../api';
import { RatingSummary } from './RatingSummary';
import { StarRating } from './StarRating';
import { withMyRating, withoutMyRating, type RatingState } from './rating-format';

const SAVE_DELAY_MS = 400;

/** Recipe page: average and count, plus the viewer's own control with a debounced save. */
export function RatingPanel({ recipeId, initial }: { recipeId: string; initial: RatingState }) {
  const t = useTranslations();
  const [rating, setRating] = useState<RatingState>(initial);
  const [status, setStatus] = useState('');
  const confirmed = useRef<RatingState>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);

  const save = async (stars: number) => {
    pending.current = null;
    const res = await call(`/api/recipes/${recipeId}/rating`, 'PUT', { stars });
    if (res?.ok) {
      const body = (await res.json()) as {
        rating_avg: number | null;
        rating_count: number;
        my_rating: number | null;
      };
      const next = { avg: body.rating_avg, count: body.rating_count, mine: body.my_rating };
      confirmed.current = next;
      setRating(next);
      setStatus(t('rating.saved', { n: stars }));
    } else {
      setRating(confirmed.current);
      setStatus(t('rating.error.save'));
    }
  };

  // Leaving the page with a pending change still sends it.
  const flush = useRef(save);
  useEffect(() => {
    flush.current = save;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void flush.current(pending.current);
    },
    [],
  );

  const select = (stars: number) => {
    setRating(withMyRating(confirmed.current, stars));
    pending.current = stars;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(stars), SAVE_DELAY_MS);
  };

  const clear = async () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setRating(withoutMyRating(confirmed.current));
    const res = await call(`/api/recipes/${recipeId}/rating`, 'DELETE');
    if (res?.status === 204) {
      confirmed.current = withoutMyRating(confirmed.current);
      setStatus(t('rating.cleared'));
    } else {
      setRating(confirmed.current);
      setStatus(t('rating.error.save'));
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <RatingSummary avg={rating.avg} count={rating.count} />
      <StarRating mine={rating.mine} onSelect={select} onClear={() => void clear()} />
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
    </div>
  );
}
