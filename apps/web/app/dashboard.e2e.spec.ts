import { expect, test } from '@playwright/test';

test('candidate detail switches from Korean to English without losing candidate', async ({
  page
}) => {
  await page.goto('/ko/candidates/test-candidate');
  await expect(page.getByText('경쟁도')).toBeVisible();
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/candidates\/test-candidate/u);
  await expect(page.getByText('Competition')).toBeVisible();
});
