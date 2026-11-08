'use client';

import { useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { call } from '../api';
import { btn, btnDanger, btnPrimary, errorText, input } from '../styles';
import {
  counterAnnouncement,
  noteErrorFor,
  noteReason,
  NOTE_MAX,
  type NoteErrorKey,
} from './notes-logic';

export type Note = {
  id: string;
  body: string;
  shared: boolean;
  author: string;
  mine: boolean;
  created_at: string;
  updated_at: string;
};

type T = ReturnType<typeof useTranslations>;

function noteError(t: T, key: NoteErrorKey): string {
  if (key === 'limit') return t('notes.error.limit');
  if (key === 'empty') return t('notes.error.empty');
  if (key === 'tooLong') return t('notes.error.tooLong');
  if (key === 'forbidden') return t('notes.error.forbidden');
  if (key === 'network') return t('notes.error.network');
  return t('notes.error.generic');
}

async function failureKey(res: Response | null): Promise<NoteErrorKey> {
  if (!res) return noteErrorFor(0, null);
  const body: unknown = await res.json().catch(() => null);
  return noteErrorFor(res.status, body);
}

const autoGrow = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
};

function Marker({ shared }: { shared: boolean }) {
  const t = useTranslations();
  return shared ? (
    <span className="inline-flex items-center gap-1 rounded border border-solid border-neutral-600 px-2 py-0.5 text-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 6 1.7 6 5.5" />
      </svg>
      {t('notes.marker.shared')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-dashed border-[var(--md-private-line)] bg-[var(--rg-banner)] px-2 py-0.5 text-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      {t('notes.marker.private')}
    </span>
  );
}

function Visibility({
  shared,
  onChange,
  help,
}: {
  shared: boolean;
  onChange: (shared: boolean) => void;
  help: string;
}) {
  const t = useTranslations();
  const name = useId();
  return (
    <fieldset className="mt-2">
      <legend className="font-medium">{t('notes.visibility.legend')}</legend>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="radio"
          name={name}
          className="size-5"
          checked={!shared}
          onChange={() => onChange(false)}
        />
        {t('notes.visibility.private')}
      </label>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="radio"
          name={name}
          className="size-5"
          checked={shared}
          onChange={() => onChange(true)}
        />
        {t('notes.visibility.shared')}
      </label>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{help}</p>
    </fieldset>
  );
}

/** Notes under the recipe: oldest first, add form below, inline edit and confirm-only delete. */
export function Notes({
  recipeId,
  canManage,
  initialNotes,
}: {
  recipeId: string;
  /** Owner or admin: may delete other users' shared notes (never edit, never see private ones). */
  canManage: boolean;
  initialNotes: Note[];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [draft, setDraft] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<NoteErrorKey | null>(null);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string; shared: boolean } | null>(
    null,
  );
  const [editError, setEditError] = useState<NoteErrorKey | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const addArea = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const reasonId = `${uid}-reason`;

  const focusLater = (selector: string, fallback?: () => void) =>
    requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(selector);
      if (el) el.focus();
      else fallback?.();
    });
  const noteSel = (id: string, act: string) => `[data-note="${id}"] [data-act="${act}"]`;

  const reason = noteReason(draft);
  const reasonText = reason
    ? reason.key === 'empty'
      ? t('notes.add.reasonEmpty')
      : t('notes.add.reasonTooLong', { n: reason.over })
    : null;

  const add = async () => {
    if (reasonText) {
      setStatus(reasonText);
      return;
    }
    setBusy(true);
    setAddError(null);
    const res = await call(`/api/recipes/${recipeId}/notes`, 'POST', { body: draft, shared });
    setBusy(false);
    if (res?.status === 201) {
      const note = (await res.json()) as Note;
      setNotes((prev) => [...prev, note]);
      setDraft('');
      if (addArea.current) addArea.current.style.height = 'auto';
      setStatus(t('notes.added'));
      addArea.current?.focus();
    } else {
      setAddError(await failureKey(res));
    }
  };

  const save = async () => {
    if (!editing) return;
    const bad = noteReason(editing.body);
    if (bad) {
      setEditError(bad.key === 'empty' ? 'empty' : 'tooLong');
      return;
    }
    setBusy(true);
    setEditError(null);
    const res = await call(`/api/recipes/${recipeId}/notes/${editing.id}`, 'PUT', {
      body: editing.body,
      shared: editing.shared,
    });
    setBusy(false);
    if (res?.ok) {
      const note = (await res.json()) as Note;
      setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
      setEditing(null);
      setStatus(t('notes.saved'));
      focusLater(noteSel(note.id, 'edit'));
    } else {
      setEditError(await failureKey(res));
    }
  };

  const remove = async (id: string) => {
    const index = notes.findIndex((n) => n.id === id);
    const next = notes[index + 1] ?? notes[index - 1] ?? null;
    const res = await call(`/api/recipes/${recipeId}/notes/${id}`, 'DELETE');
    setConfirmId(null);
    if (res?.status === 204 || res?.status === 404) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setStatus(t('notes.deleted'));
      focusLater(next ? `[data-note="${next.id}"] button` : '[data-add-note]');
    } else {
      setStatus(noteError(t, await failureKey(res)));
      focusLater(noteSel(id, 'delete'));
    }
  };

  return (
    <section ref={root} aria-labelledby={`${uid}-h`} className="mt-8 max-w-prose">
      <h2 id={`${uid}-h`} className="text-xl font-semibold">
        {t('notes.heading')} ({notes.length})
      </h2>
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {status}
      </p>

      {notes.length === 0 ? (
        <p className="mt-2">{t('notes.empty')}</p>
      ) : (
        <ul aria-label={t('notes.list.label')} className="mt-2 flex flex-col gap-3">
          {notes.map((n) => {
            const isEditing = editing?.id === n.id;
            const canDelete = n.mine || (canManage && n.shared);
            return (
              <li key={n.id} data-note={n.id} className="rounded border border-neutral-400 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">{n.mine ? t('notes.you') : n.author}</span>
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">
                    {format.dateTime(new Date(n.created_at), { dateStyle: 'medium' })}
                  </span>
                  <Marker shared={n.shared} />
                </div>
                {isEditing ? (
                  <div
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditing(null);
                        setEditError(null);
                        focusLater(noteSel(n.id, 'edit'));
                      }
                    }}
                  >
                    <label htmlFor={`${uid}-e-${n.id}`} className="sr-only">
                      {t('notes.edit')}
                    </label>
                    <textarea
                      id={`${uid}-e-${n.id}`}
                      ref={(el) => {
                        if (el && !el.dataset.ready) {
                          el.dataset.ready = '1';
                          el.focus();
                          el.setSelectionRange(el.value.length, el.value.length);
                          autoGrow(el);
                        }
                      }}
                      rows={3}
                      value={editing.body}
                      aria-invalid={editError === 'empty' || editError === 'tooLong' || undefined}
                      aria-describedby={editError ? `${uid}-ee` : undefined}
                      className={`${input} mt-2`}
                      onChange={(e) => {
                        autoGrow(e.target);
                        setEditing({ ...editing, body: e.target.value });
                      }}
                    />
                    <Visibility
                      shared={editing.shared}
                      onChange={(v) => setEditing({ ...editing, shared: v })}
                      help={
                        editing.shared === n.shared
                          ? editing.shared
                            ? t('notes.visibility.sharedHelp')
                            : t('notes.visibility.privateHelp')
                          : editing.shared
                            ? t('notes.visibility.nowShared')
                            : t('notes.visibility.nowPrivate')
                      }
                    />
                    {editError && (
                      <p id={`${uid}-ee`} className={errorText}>
                        {noteError(t, editError)}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={busy}
                        onClick={() => void save()}
                      >
                        {t('notes.save')}
                      </button>
                      <button
                        type="button"
                        className={btn}
                        onClick={() => {
                          setEditing(null);
                          setEditError(null);
                          focusLater(noteSel(n.id, 'edit'));
                        }}
                      >
                        {t('notes.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{n.body}</p>
                    {confirmId === n.id ? (
                      <div
                        role="group"
                        aria-label={t('notes.deleteConfirm')}
                        className="mt-2"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setConfirmId(null);
                            focusLater(noteSel(n.id, 'delete'));
                          }
                        }}
                      >
                        <p>{t('notes.deleteConfirm')}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnDanger}
                            onClick={() => void remove(n.id)}
                          >
                            {t('notes.deleteYes')}
                          </button>
                          <button
                            type="button"
                            className={btn}
                            autoFocus
                            onClick={() => {
                              setConfirmId(null);
                              focusLater(noteSel(n.id, 'delete'));
                            }}
                          >
                            {t('notes.deleteKeep')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      canDelete && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {n.mine && (
                            <button
                              type="button"
                              data-act="edit"
                              className={btn}
                              onClick={() => {
                                setEditError(null);
                                setEditing({ id: n.id, body: n.body, shared: n.shared });
                              }}
                            >
                              {t('notes.edit')}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              data-act="delete"
                              className={btnDanger}
                              onClick={() => setConfirmId(n.id)}
                            >
                              {t('notes.delete')}
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <label htmlFor={`${uid}-add`} className="font-semibold">
          {t('notes.add.label')}
        </label>
        <textarea
          id={`${uid}-add`}
          ref={addArea}
          data-add-note
          rows={3}
          value={draft}
          aria-invalid={addError === 'empty' || addError === 'tooLong' || undefined}
          aria-describedby={addError ? `${uid}-ae` : undefined}
          className={`${input} mt-1`}
          onChange={(e) => {
            autoGrow(e.target);
            const ann = counterAnnouncement(draft.length, e.target.value.length);
            if (ann) {
              setStatus(
                ann.key === 'limit'
                  ? t('notes.counter.limit')
                  : t('notes.counter.left', { n: ann.n }),
              );
            }
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {t('notes.counter.value', { n: draft.length, max: NOTE_MAX })}{' '}
          {t('notes.add.hintCtrlEnter')}
        </p>
        {addError && (
          <p id={`${uid}-ae`} className={errorText}>
            {noteError(t, addError)}
          </p>
        )}
        <Visibility
          shared={shared}
          onChange={setShared}
          help={shared ? t('notes.visibility.sharedHelp') : t('notes.visibility.privateHelp')}
        />
        <button
          type="button"
          className={`${btnPrimary} mt-2 aria-disabled:opacity-60`}
          aria-disabled={reasonText ? 'true' : undefined}
          aria-describedby={reasonText ? reasonId : undefined}
          disabled={busy}
          onClick={() => void add()}
        >
          {t('notes.add.submit')}
        </button>
        {reasonText && (
          <p id={reasonId} className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {reasonText}
          </p>
        )}
      </div>
    </section>
  );
}
