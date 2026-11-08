'use client';

import { useTranslations } from 'next-intl';
import { LIMITS } from '@/lib/grid/editor';
import { btn } from '../styles';

export type StepsToolbarProps = {
  canAdd: boolean;
  canAddColumn: boolean;
  onAddStep: () => void;
  onAddBanner: (kind: 'banner_top' | 'banner_bottom') => void;
};

/**
 * Add step / Add banner for one section (UX spec 8.2, 8.6). At the 100-step cap the buttons
 * stay focusable (aria-disabled) and the reason is visible text. Add banner is two plain
 * buttons instead of a menu: one fewer widget to operate and to test.
 */
export function StepsToolbar({ canAdd, canAddColumn, onAddStep, onAddBanner }: StepsToolbarProps) {
  const t = useTranslations();
  const reason = !canAdd
    ? t('gridEditor.step.limit', { max: LIMITS.steps })
    : !canAddColumn
      ? t('gridEditor.step.noRows')
      : null;
  return (
    <div className="ge-steptools" role="group" aria-label={t('gridEditor.step.toolsLabel')}>
      <button
        type="button"
        className={btn}
        aria-disabled={!canAddColumn || undefined}
        onClick={() => canAddColumn && onAddStep()}
      >
        {t('gridEditor.step.add')}
      </button>
      <button
        type="button"
        className={btn}
        aria-disabled={!canAdd || undefined}
        onClick={() => canAdd && onAddBanner('banner_top')}
      >
        {t('gridEditor.banner.addTop')}
      </button>
      <button
        type="button"
        className={btn}
        aria-disabled={!canAdd || undefined}
        onClick={() => canAdd && onAddBanner('banner_bottom')}
      >
        {t('gridEditor.banner.addBottom')}
      </button>
      {reason && <span className="ge-muted">{reason}</span>}
    </div>
  );
}
