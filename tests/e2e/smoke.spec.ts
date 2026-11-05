import { expect, test } from '@playwright/test';

test('placeholder page renders with Tailwind styles', async ({ page }) => {
  await page.goto('/');
  const h1 = page.getByRole('heading', { name: 'Recipe Book' });
  await expect(h1).toBeVisible();
  await expect(h1).toHaveCSS('font-weight', '700');
});
