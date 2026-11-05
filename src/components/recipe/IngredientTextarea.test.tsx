import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { IngredientTextarea } from './IngredientTextarea';

describe('IngredientTextarea preview', () => {
  it('previews a range as 2-3 tbsp, not the lower bound', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <IngredientTextarea id="ing" value={'2-3 tbsp honey'} onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('2-3 tbsp');
    expect(html).toContain('honey');
  });
});
