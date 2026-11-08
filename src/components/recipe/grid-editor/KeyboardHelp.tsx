'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Keyboard help (UX spec 14.1 item 3): one disclosure button after the toolbar that opens an
 * inline list of the chords in 14.3. Plain `aria-expanded` + `aria-controls`; nothing moves
 * focus, and Escape is not needed because it is not a popup.
 */
export function KeyboardHelp() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows: [string, string][] = [
    [t('gridEditor.help.walk'), t('gridEditor.help.walkDo')],
    [t('gridEditor.help.enter'), t('gridEditor.help.enterDo')],
    [t('gridEditor.help.f2'), t('gridEditor.help.f2Do')],
    [t('gridEditor.help.menu'), t('gridEditor.help.menuDo')],
    [t('gridEditor.help.rowMove'), t('gridEditor.help.rowMoveDo')],
    [t('gridEditor.help.stepBottom'), t('gridEditor.help.stepBottomDo')],
    [t('gridEditor.help.stepColumn'), t('gridEditor.help.stepColumnDo')],
    [t('gridEditor.help.del'), t('gridEditor.help.delDo')],
    [t('gridEditor.help.commit'), t('gridEditor.help.commitDo')],
    [t('gridEditor.help.undo'), t('gridEditor.help.undoDo')],
    [t('gridEditor.help.save'), t('gridEditor.help.saveDo')],
    [t('gridEditor.help.esc'), t('gridEditor.help.escDo')],
  ];
  return (
    <div className="ge-help">
      <button
        type="button"
        className="ge-linkbtn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t('gridEditor.help.toggle')}
      </button>
      {open && (
        <div id={id} className="ge-helpbody">
          <h3 className="ge-h3">{t('gridEditor.help.title')}</h3>
          <p className="ge-muted">{t('gridEditor.help.intro')}</p>
          <dl className="ge-helplist">
            {rows.map(([keys, what]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p className="ge-muted">{t('gridEditor.help.mouse')}</p>
        </div>
      )}
    </div>
  );
}
