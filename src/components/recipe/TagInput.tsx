'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  addMany,
  fetchTagNames,
  AUTOCOMPLETE_DEBOUNCE_MS,
  autocompleteUrl,
  moveActive,
  removeTag,
  tagProblem,
  visibleSuggestions,
  type TagAddProblem,
} from '@/lib/recipes/tag-input';
import { MAX_TAGS_PER_RECIPE } from '@/lib/recipes/tag-name';
import { input as inputClass } from './styles';

// Tag names are user data: they are only ever rendered as React text, never as HTML.

const PROBLEM_KEYS = {
  too_long: 'tags.field.errors.too_long',
  invalid: 'tags.field.errors.invalid',
  limit: 'tags.field.errors.limit',
} as const;
const problemKey = (p: TagAddProblem) => (p === 'empty' ? null : PROBLEM_KEYS[p]);

/**
 * Editable tag chips with an autocomplete combobox. The visible label comes from the caller
 * (FormField) and points at the text input through `id`. `describedBy` carries the field's
 * server error id.
 */
export function TagInput({
  id,
  tags,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const t = useTranslations();
  const uid = useId();
  const listId = `${uid}-list`;
  const hintId = `${uid}-hint`;
  const errId = `${uid}-err`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [commitProblem, setCommitProblem] = useState<TagAddProblem | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const shown = visibleSuggestions(suggestions, tags);
  const expanded = open && autocompleteUrl(text) !== null && shown.length > 0;
  const live = tagProblem(text);
  const problem: TagAddProblem | null = live ?? commitProblem;
  const problemText = problem && problemKey(problem) ? t(problemKey(problem)!) : null;

  // Debounced autocomplete. A newer keystroke aborts the request and its result is dropped.
  useEffect(() => {
    const url = autocompleteUrl(text);
    if (url === null) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      void fetchTagNames(url, ctl.signal).then((fetched) => {
        if (fetched === null || ctl.signal.aborted) return;
        const names = visibleSuggestions(fetched, tags);
        setSuggestions(names);
        setActive(-1);
        setOpen(true);
        setAnnouncement(t('tags.field.suggestions', { count: names.length }));
      });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // `tags` is read only to hide chosen names; re-running on it would refetch after each add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function commit(raw: string) {
    const r = addMany(tags, raw);
    onChange(r.tags);
    setText(r.rejected.join(', '));
    setCommitProblem(r.problem && r.problem !== 'empty' ? r.problem : null);
    setOpen(false);
    setActive(-1);
    setSuggestions([]);
    if (r.problem && problemKey(r.problem)) setAnnouncement(t(problemKey(r.problem)!));
    else if (r.added.length > 0)
      setAnnouncement(t('tags.field.added', { name: r.added.join(', ') }));
    else if (r.rejected.length === 0 && raw.trim() !== '')
      setAnnouncement(t('tags.field.alreadyAdded', { name: raw.trim().toLowerCase() }));
  }

  function remove(name: string) {
    onChange(removeTag(tags, name));
    setAnnouncement(t('tags.field.removed', { name }));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (shown.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => moveActive(open ? a : -1, shown.length, key));
    } else if (key === 'Enter') {
      if (expanded && active >= 0) {
        e.preventDefault();
        commit(shown[active]);
      } else if (text.trim() !== '') {
        e.preventDefault(); // add the tag, do not submit the recipe form
        commit(text);
      }
    } else if (key === ',') {
      e.preventDefault();
      if (text.trim() !== '') commit(text);
    } else if (key === 'Backspace') {
      if (text === '' && tags.length > 0) {
        e.preventDefault();
        remove(tags[tags.length - 1]);
      }
    } else if (key === 'Escape' && expanded) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div>
      <ul aria-label={t('tags.field.listLabel')} className="mb-2 flex flex-wrap gap-2">
        {tags.map((name) => (
          <li
            key={name}
            className="inline-flex items-center rounded border border-neutral-500 pl-2 text-sm"
          >
            <span>{name}</span>
            <button
              type="button"
              aria-label={t('tags.field.remove', { name })}
              onClick={() => remove(name)}
              className="inline-flex size-11 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-invalid={invalid || problemText ? true : undefined}
          aria-describedby={[hintId, problemText ? errId : null, describedBy]
            .filter(Boolean)
            .join(' ')}
          autoComplete="off"
          placeholder={t('tags.field.placeholder')}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setCommitProblem(null);
            // A pasted list ("a, b, c") is committed at once; typing a comma is handled in keydown.
            if (v.includes(',') || v.includes('\n')) commit(v);
            else setText(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            if (text.trim() !== '') commit(text);
          }}
          className={inputClass}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={t('tags.field.suggestionsLabel')}
          hidden={!expanded}
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded border border-neutral-500 bg-white shadow dark:bg-neutral-900"
        >
          {expanded &&
            shown.map((name, i) => (
              <li
                key={name}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // mousedown (not click) so the input keeps focus and blur does not fire first
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(name);
                }}
                className={`flex min-h-11 cursor-pointer items-center px-3 ${
                  i === active ? 'bg-emerald-100 dark:bg-emerald-900' : ''
                }`}
              >
                {name}
              </li>
            ))}
        </ul>
      </div>
      <p id={hintId} className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        {t('tags.field.hint', { count: tags.length, max: MAX_TAGS_PER_RECIPE })}
      </p>
      {problemText && (
        <p id={errId} className="mt-1 text-sm text-red-700 dark:text-red-400">
          {problemText}
        </p>
      )}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
