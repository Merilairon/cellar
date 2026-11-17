import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/en.json';
import { UndoToast } from './UndoToast';

describe('UndoToast', () => {
  it('sits in a named region landmark (F16: axe "region") with its text hidden from AT', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <UndoToast
          toast={{ message: 'Row deleted', onUndo: () => {}, doc: null }}
          onDismiss={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toMatch(/role="region"[^>]*aria-label="Undo last deletion"/);
    expect(html).toContain('<span aria-hidden="true" class="flex-1">Row deleted</span>');
  });
});
