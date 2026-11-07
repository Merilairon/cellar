'use client';

import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ImportErrorCode } from '@/lib/import/errors';
import { MAX_IMPORT_TEXT, MAX_IMPORT_URL } from '@/lib/import/schemas';
import { btn, btnPrimary, input } from '@/components/recipe/styles';
import { requestImport } from './api';
import { initialState, reducer, suggestsPaste, type ImportFailure, type Tab } from './import-state';

// Full literal keys, so the catalogue test can verify them.
const CODE_KEYS: Record<ImportErrorCode, string> = {
  blocked: 'import.errors.blocked',
  no_recipe: 'import.errors.no_recipe',
  timeout: 'import.errors.timeout',
  invalid_url: 'import.errors.invalid_url',
  private_address: 'import.errors.private_address',
  too_large: 'import.errors.too_large',
  fetch_failed: 'import.errors.fetch_failed',
  headless_unavailable: 'import.errors.headless_unavailable',
};

const TABS: Tab[] = ['url', 'paste'];
const PHASE_DELAY_MS = 1500;
// Presentational heuristic: the server may have switched to a browser render by now.
const RENDERING_DELAY_MS = 8000;
const PROGRESS_KEYS = {
  fetching: 'import.progress.fetching',
  parsing: 'import.progress.parsing',
  rendering: 'import.progress.rendering',
} as const;

export function ImportDialog() {
  const t = useTranslations();
  const router = useRouter();
  const [s, dispatch] = useReducer(reducer, initialState);
  const abort = useRef<AbortController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ url: null, paste: null });

  useEffect(() => {
    if (s.pasteFocus > 0) pasteRef.current?.focus();
  }, [s.pasteFocus]);
  useEffect(
    () => () => {
      abort.current?.abort();
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const stopTimer = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (s.busy) return;
    const value = s.tab === 'url' ? s.url.trim() : s.text;
    if (value.trim() === '') {
      (s.tab === 'url' ? urlRef : pasteRef).current?.focus();
      return;
    }
    dispatch({ type: 'submit' });
    const ctl = new AbortController();
    abort.current = ctl;
    if (s.tab === 'url') {
      timers.current = [
        setTimeout(() => dispatch({ type: 'phase', phase: 'parsing' }), PHASE_DELAY_MS),
        setTimeout(() => dispatch({ type: 'phase', phase: 'rendering' }), RENDERING_DELAY_MS),
      ];
    }
    const out = await requestImport(s.tab === 'url' ? { url: value } : { text: value }, ctl.signal);
    if (!out) return; // cancelled: the reducer was already reset
    stopTimer();
    if (out.ok) {
      dispatch({ type: 'done' });
      router.push(`/import/${out.id}`);
      return;
    }
    dispatch({ type: 'failed', failure: out.failure });
  }

  function cancel() {
    abort.current?.abort();
    stopTimer();
    dispatch({ type: 'cancel' });
  }

  function onTabKey(e: React.KeyboardEvent, tab: Tab) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % 2] : e.key === 'ArrowLeft' ? TABS[(i + 1) % 2] : null;
    if (!next) return;
    e.preventDefault();
    dispatch({ type: 'tab', tab: next });
    tabRefs.current[next]?.focus();
  }

  const tooLong = s.text.length > MAX_IMPORT_TEXT;
  const max = MAX_IMPORT_TEXT.toLocaleString('en');

  function message(f: ImportFailure): string[] {
    if (f.kind === 'code') {
      const out = [t(CODE_KEYS[f.code])];
      // Headless ran and the page still failed, or it was needed but is not available.
      if (f.headless === 'used') out.push(t('import.errors.headlessTried'));
      if (f.headless === 'busy') out.push(t('import.errors.headlessBusy'));
      if (f.headless === 'unavailable' && f.code !== 'headless_unavailable')
        out.push(t('import.errors.headlessUnavailableHint'));
      if (suggestsPaste(f)) out.push(t('import.errors.pasteHint'));
      return out;
    }
    if (f.kind === 'rateLimited') return [t('import.errors.rateLimited', { seconds: f.seconds })];
    if (f.kind === 'network') return [t('import.errors.network')];
    return [t('import.errors.generic')];
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
      <div role="tablist" aria-label={t('import.tabs.label')} className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            id={`import-tab-${tab}`}
            aria-selected={s.tab === tab}
            aria-controls={`import-panel-${tab}`}
            tabIndex={s.tab === tab ? 0 : -1}
            disabled={s.busy !== null}
            onClick={() => dispatch({ type: 'tab', tab })}
            onKeyDown={(e) => onTabKey(e, tab)}
            className={`${btn} ${s.tab === tab ? 'border-2 border-emerald-800 font-semibold dark:border-emerald-400' : ''}`}
          >
            {t(tab === 'url' ? 'import.tabs.url' : 'import.tabs.paste')}
          </button>
        ))}
      </div>

      {s.tab === 'url' ? (
        <div role="tabpanel" id="import-panel-url" aria-labelledby="import-tab-url">
          <label htmlFor="import-url" className="mb-1 block text-sm font-medium">
            {t('import.url.label')}
          </label>
          <input
            ref={urlRef}
            id="import-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={MAX_IMPORT_URL}
            value={s.url}
            placeholder={t('import.url.placeholder')}
            aria-describedby="import-url-hint"
            onChange={(e) => dispatch({ type: 'url', value: e.target.value })}
            className={input}
          />
          <p id="import-url-hint" className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {t('import.url.hint')}
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="import-panel-paste" aria-labelledby="import-tab-paste">
          <label htmlFor="import-text" className="mb-1 block text-sm font-medium">
            {t('import.paste.label')}
          </label>
          <textarea
            ref={pasteRef}
            id="import-text"
            rows={12}
            value={s.text}
            placeholder={t('import.paste.placeholder')}
            aria-describedby="import-text-hint"
            aria-invalid={tooLong || undefined}
            onChange={(e) => dispatch({ type: 'text', value: e.target.value })}
            className={`${input} font-mono text-sm`}
          />
          <p id="import-text-hint" className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {tooLong ? t('import.paste.tooLong', { max }) : t('import.paste.hint', { max })}
          </p>
        </div>
      )}

      {/* Live regions exist before their content changes, so updates are announced. */}
      <div aria-live="polite" className={s.busy ? '' : 'sr-only'}>
        {s.busy && (
          <div className="flex flex-col gap-2">
            <p>{t(PROGRESS_KEYS[s.busy])}</p>
            <div
              role="progressbar"
              aria-label={t('import.progress.label')}
              className="h-2 w-full overflow-hidden rounded bg-neutral-300 dark:bg-neutral-700"
            >
              <div className="h-full w-1/3 animate-pulse rounded bg-emerald-800 dark:bg-emerald-400" />
            </div>
          </div>
        )}
      </div>
      <div role="alert">
        {s.error && (
          <div className="rounded border border-red-700 p-3 text-red-800 dark:border-red-400 dark:text-red-300">
            <p className="font-semibold">{t('import.errors.title')}</p>
            {message(s.error).map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={s.busy !== null || tooLong}>
          {t('import.submit')}
        </button>
        {s.busy && (
          <button type="button" className={btn} onClick={cancel}>
            {t('import.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
