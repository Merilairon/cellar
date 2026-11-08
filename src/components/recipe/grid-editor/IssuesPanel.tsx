'use client';

import { useTranslations } from 'next-intl';
import type { EditorDoc, EditorIssue } from '@/lib/grid/editor';
import { issueText } from './issue-text';
import { issueMessage } from './text';

type Item = { issue: EditorIssue; kind: 'error' | 'warning'; text: string; names?: string };

/**
 * Errors (block Save) then warnings (do not), each with a word, an icon, the message and a
 * Go to button. `row_uncovered` is one item per section (UX spec 11). Not a live region:
 * transitions are announced by the single editor-level status region.
 */
export function IssuesPanel({
  doc,
  errors,
  warnings,
  headingRef,
  onGoTo,
}: {
  doc: EditorDoc;
  errors: EditorIssue[];
  warnings: EditorIssue[];
  headingRef: React.Ref<HTMLHeadingElement>;
  onGoTo: (issue: EditorIssue) => void;
}) {
  const t = useTranslations();

  const items: Item[] = [];
  const build = (list: EditorIssue[], kind: 'error' | 'warning') => {
    const uncoveredBySection = new Map<number, EditorIssue[]>();
    for (const issue of list) {
      if (issue.code === 'row_uncovered') {
        const m = /^sections\.(\d+)\./.exec(issue.path);
        const si = m ? Number(m[1]) : 0;
        uncoveredBySection.set(si, [...(uncoveredBySection.get(si) ?? []), issue]);
        continue;
      }
      const { key, values } = issueText(doc, issue);
      const sec = issue.target
        ? doc.sections.find((s) => s.key === issue.target?.sectionKey)
        : null;
      const si = sec ? doc.sections.indexOf(sec) : 0;
      items.push({
        issue,
        kind,
        text: issueMessage(t, key, {
          ...values,
          title: sec?.title?.trim() || t('recipe.section', { n: si + 1 }),
        }),
      });
    }
    for (const [si, group] of uncoveredBySection) {
      const sec = doc.sections[si];
      const names = group
        .map((g) => sec?.ingredients[Number(/ingredients\.(\d+)/.exec(g.path)?.[1])]?.name)
        .filter(Boolean)
        .join(', ');
      items.push({
        issue: group[0],
        kind,
        text: t('gridEditor.issue.row_uncovered', { names }),
      });
    }
  };
  build(errors, 'error');
  build(warnings, 'warning');

  return (
    <section aria-labelledby="ge-issues-h" className="ge-issues" data-empty={items.length === 0}>
      <h3 id="ge-issues-h" ref={headingRef} tabIndex={-1} className="ge-h3">
        {t('gridEditor.issue.title')}
      </h3>
      {items.length === 0 ? (
        <p className="ge-muted">{t('gridEditor.issue.none')}</p>
      ) : (
        <ul className="ge-issuelist">
          {items.map((it, n) => (
            <li key={`${it.issue.path}-${it.issue.code}-${n}`} data-kind={it.kind}>
              <span className="ge-issuebadge">
                <span aria-hidden="true">{it.kind === 'error' ? '✕' : '!'}</span>{' '}
                {it.kind === 'error'
                  ? t('gridEditor.issue.problem')
                  : t('gridEditor.issue.warning')}
              </span>
              <span className="ge-issuetext">{it.text}</span>
              {it.issue.target && (
                <button type="button" className="ge-linkbtn" onClick={() => onGoTo(it.issue)}>
                  {t('gridEditor.issue.goTo')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
