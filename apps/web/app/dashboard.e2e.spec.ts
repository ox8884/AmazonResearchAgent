import { expect, test } from '@playwright/test';
import { loginAsAdmin } from '../e2e/test-admin';

test('redirects every data-bearing page to login without a session', async ({ page }) => {
  for (const path of [
    '/ko/dashboard',
    '/ko/candidates',
    '/ko/candidates/test-candidate',
    '/ko/imports',
    '/ko/imports/new',
    '/ko/runs',
    '/ko/settings',
    '/ko/settings/ai'
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/ko\/login$/u);
  }
});

test('candidate detail switches from Korean to English without losing candidate', async ({
  page
}) => {
  await loginAsAdmin(page);
  await page.goto('/ko/candidates/test-candidate');
  await expect(page.getByText('경쟁도')).toBeVisible();
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/candidates\/test-candidate/u);
  await expect(page.getByText('Competition')).toBeVisible();
});
