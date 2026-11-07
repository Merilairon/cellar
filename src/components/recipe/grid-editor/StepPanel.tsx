'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { uncoveredRows, type EditorIssue } from '@/lib/grid/editor';
import type { EditorSection } from '@/lib/grid/editor';
import type { EditorStep } from '@/lib/grid/editor';
import type { StepFields } from '@/lib/grid/editor';
import type { StepKind } from '@/lib/grid/editor';
import { FormField } from '../FormField';
import { btn, btnDanger, errorText, input } from '../styles';
import { issueText } from './issue-text';
import { issueMessage } from './text';

export type ResizeType = 'stepGrowStart' | 'stepShrinkStart' | 'stepGrowEnd' | 'stepShrinkEnd';

/** What the panel can ask for. Every call is one reducer action (one undo step). */
export type StepPanelApi = {
  edit: (patch: Partial<StepFields>, field: string) => void;
  resize: (type: ResizeType) => void;
  move: (dir: -1 | 1) => void;
  convert: (to?: StepKind) => void;
  remove: () => void;
};

export type StepPanelProps = {
  section: EditorSection;
  step: EditorStep;
  /** Index among the section's column steps (0-based), or the banner's index in its group. */
  position: number;
  /** Count of column steps, or of banners in the same group. */
  groupSize: number;
  issues: EditorIssue[];
  doc: Parameters<typeof issueText>[0];
  api: StepPanelApi;
  /** Phone sheet variant (T8): steppers always shown, text fields in a closed disclosure. */
  sheet?: { onClose: () => void };
  /** Id for the heading when a dialog labels itself by it. */
  headingId?: string;
};

const toInt = (v: string, max: number): number | null | undefined => {
  if (v.trim() === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : undefined;
};

/**
 * The step / banner panel under a section's table (UX spec 6, 8.1, 8.4, 8.5; G14): heading,
 * Adjust rows disclosure (column steps), action row, text fields. Plain controls only, so it
 * works at every width and without a pointer. Reused by the phone sheet (T8) via `StepForm`.
 */
export function StepPanel({
  section,
  step,
  position,
  groupSize,
  issues,
  doc,
  api,
  sheet,
  headingId,
}: StepPanelProps) {
  const t = useTranslations();
  const autoId = useId();
  const headId = headingId ?? autoId;
  const adjustId = useId();
  const [adjustOpen, setAdjusting] = useState(false);
  const adjusting = adjustOpen || !!sheet;
  const [choosing, setChoosing] = useState(false);
  const isColumn = step.kind === 'column';
  const label =
    step.label || (isColumn ? t('gridEditor.step.newLabel') : t('gridEditor.banner.empty'));
  const rows = section.ingredients;
  const n = rows.length;
  const start = step.row_start ?? 0;
  const end = step.row_end ?? 0;

  const heading = isColumn
    ? t('gridEditor.step.heading', { n: position + 1, label })
    : t('gridEditor.banner.heading', { label });
  const fieldError = issues.find(
    (i) =>
      i.target?.stepKey === step.key && (i.code === 'label_empty' || i.code === 'banner_empty'),
  );
  const errText = fieldError
    ? (() => {
        const x = issueText(doc, fieldError);
        return issueMessage(t, x.key, x.values);
      })()
    : undefined;

  const fid = (f: string) => `ge-f-${step.key}-${f}`;
  const num = (
    f: 'temp_c' | 'temp_f' | 'minutes_min' | 'minutes_max',
    text: string,
    max: number,
  ) => (
    <FormField id={fid(f)} label={text}>
      {(p) => (
        <input
          {...p}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={step[f] ?? ''}
          onChange={(e) => {
            const v = toInt(e.target.value, max);
            if (v !== undefined) api.edit({ [f]: v }, f);
          }}
          className={input}
        />
      )}
    </FormField>
  );

  const stepper = (
    id: 'start' | 'end',
    minus: ResizeType,
    plus: ResizeType,
    row: number,
    minusDisabled: boolean,
    plusDisabled: boolean,
  ) => {
    const text = id === 'start' ? t('gridEditor.step.startRow') : t('gridEditor.step.endRow');
    const mk = (type: ResizeType, sign: string, name: string, disabled: boolean) => (
      <button
        type="button"
        className={`${btn} ge-stepper`}
        aria-label={name}
        aria-disabled={disabled || undefined}
        onClick={() => api.resize(type)}
      >
        <span aria-hidden="true">{sign}</span>
      </button>
    );
    return (
      <div className="ge-stepperrow" role="group" aria-label={text}>
        <span className="ge-stepperlabel">{text}</span>
        {mk(
          minus,
          '-',
          id === 'start'
            ? t('gridEditor.step.startEarlier', { label })
            : t('gridEditor.step.endEarlier', { label }),
          minusDisabled,
        )}
        <span className="ge-steppervalue">
          {t('gridEditor.step.rowValue', { n: row + 1, total: n, name: rows[row]?.name ?? '' })}
        </span>
        {mk(
          plus,
          '+',
          id === 'start'
            ? t('gridEditor.step.startLater', { label })
            : t('gridEditor.step.endLater', { label }),
          plusDisabled,
        )}
      </div>
    );
  };

  const defaultWhere = isColumn && end === n - 1 ? 'banner_bottom' : 'banner_top';
  const [where, setWhere] = useState<'banner_top' | 'banner_bottom'>(defaultWhere);

  const gaps = uncoveredRows(section.steps, n).map((i) => rows[i].name || '...');

  const covered = rows.slice(start, end + 1).map((r) => r.name || '...');
  const coveredNames =
    covered.length > 4 ? `${covered[0]} ... ${covered[covered.length - 1]}` : covered.join(', ');

  const wrapFields = (node: React.ReactNode) =>
    !sheet ? (
      node
    ) : (
      <details className="ge-details">
        <summary className="ge-summary">{t('gridEditor.sheet.details')}</summary>
        {node}
      </details>
    );

  return (
    <section
      className="ge-panel"
      aria-labelledby={headId}
      data-ge-panel={step.key}
      onKeyDown={(e) => {
        // Chords belong to the table; inside the panel only plain editing keys apply.
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault();
      }}
    >
      <div className="ge-panelhead">
        <h4 id={headId} className="ge-h4" tabIndex={-1}>
          {heading}
        </h4>
        {sheet && (
          <button type="button" className={btn} data-ge-sheet-close onClick={sheet.onClose}>
            {t('gridEditor.sheet.close')}
          </button>
        )}
      </div>

      <div className="ge-panelbar">
        {isColumn ? (
          <>
            {!sheet && (
              <button
                type="button"
                className={btn}
                aria-expanded={adjusting}
                aria-controls={adjustId}
                onClick={() => setAdjusting((v) => !v)}
              >
                {t('gridEditor.step.adjust')}
              </button>
            )}
            <button
              type="button"
              className={btn}
              aria-disabled={position === 0 || undefined}
              onClick={() => api.move(-1)}
            >
              {t('gridEditor.step.moveLeft')}
            </button>
            <button
              type="button"
              className={btn}
              aria-disabled={position >= groupSize - 1 || undefined}
              onClick={() => api.move(1)}
            >
              {t('gridEditor.step.moveRight')}
            </button>
            <button type="button" className={btn} onClick={() => setChoosing(true)}>
              {t('gridEditor.step.toBanner')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={btn}
              aria-disabled={position === 0 || undefined}
              onClick={() => api.move(-1)}
            >
              {t('gridEditor.banner.moveUp')}
            </button>
            <button
              type="button"
              className={btn}
              aria-disabled={position >= groupSize - 1 || undefined}
              onClick={() => api.move(1)}
            >
              {t('gridEditor.banner.moveDown')}
            </button>
            <button type="button" className={btn} onClick={() => api.convert('column')}>
              {t('gridEditor.step.toStep')}
            </button>
          </>
        )}
        <button type="button" className={btnDanger} onClick={api.remove}>
          {t('gridEditor.step.delete')}
        </button>
      </div>

      {choosing && isColumn && (
        <fieldset className="ge-choice">
          <legend>{t('gridEditor.step.convertWhere', { label })}</legend>
          <label>
            <input
              type="radio"
              name={`ge-where-${step.key}`}
              checked={where === 'banner_top'}
              onChange={() => setWhere('banner_top')}
            />{' '}
            {t('gridEditor.banner.top')}
          </label>
          <label>
            <input
              type="radio"
              name={`ge-where-${step.key}`}
              checked={where === 'banner_bottom'}
              onChange={() => setWhere('banner_bottom')}
            />{' '}
            {t('gridEditor.banner.bottom')}
          </label>
          <button
            type="button"
            className={btn}
            onClick={() => {
              setChoosing(false);
              api.convert(where);
            }}
          >
            {t('gridEditor.step.convert')}
          </button>
          <button type="button" className={btn} onClick={() => setChoosing(false)}>
            {t('gridEditor.step.convertCancel')}
          </button>
        </fieldset>
      )}

      {isColumn && adjusting && (
        <div
          id={adjustId}
          role="region"
          aria-label={t('gridEditor.step.adjustPanel', { label })}
          className="ge-adjust"
        >
          {stepper('start', 'stepGrowStart', 'stepShrinkStart', start, start <= 0, start >= end)}
          {stepper('end', 'stepShrinkEnd', 'stepGrowEnd', end, end <= start, end >= n - 1)}
          {sheet ? (
            <>
              <p className="ge-muted">{t('gridEditor.sheet.covers', { count: end - start + 1 })}</p>
              <ol start={start + 1} className="ge-covered" data-ge-covered>
                {rows.slice(start, end + 1).map((r) => (
                  <li key={r.key}>{r.name || '...'}</li>
                ))}
              </ol>
              {gaps.length > 0 && (
                <p className="ge-warnline">
                  <span aria-hidden="true">!</span>{' '}
                  {t('gridEditor.issue.row_uncovered', { names: gaps.join(', ') })}
                </p>
              )}
            </>
          ) : (
            <p className="ge-muted">
              {t('gridEditor.step.covers', { count: end - start + 1, names: coveredNames })}
            </p>
          )}
        </div>
      )}

      {wrapFields(
        <div className="ge-fields">
          <FormField id={fid('label')} label={t('recipe.form.step.label')} code={undefined}>
            {(p) => (
              <>
                <input
                  {...p}
                  value={step.label}
                  maxLength={80}
                  required={!isColumn}
                  aria-required="true"
                  aria-invalid={errText ? true : undefined}
                  aria-describedby={errText ? `${fid('label')}-err` : undefined}
                  data-ge-field={`label:${step.key}`}
                  onChange={(e) => api.edit({ label: e.target.value }, 'label')}
                  className={input}
                />
                {errText && (
                  <p id={`${fid('label')}-err`} className={errorText}>
                    {errText}
                  </p>
                )}
              </>
            )}
          </FormField>
          <FormField id={fid('detail')} label={t('recipe.form.step.detail')} className="ge-wide">
            {(p) => (
              <textarea
                {...p}
                rows={2}
                maxLength={4000}
                value={step.detail}
                onChange={(e) => api.edit({ detail: e.target.value }, 'detail')}
                className={input}
              />
            )}
          </FormField>
          {num('temp_c', t('recipe.form.step.tempC'), 1000)}
          {num('temp_f', t('recipe.form.step.tempF'), 2000)}
          {num('minutes_min', t('recipe.form.step.minutesMin'), 100_000)}
          {num('minutes_max', t('recipe.form.step.minutesMax'), 100_000)}
        </div>,
      )}
      {isColumn && !sheet && <p className="ge-muted">{t('gridEditor.hint.resize')}</p>}
    </section>
  );
}
