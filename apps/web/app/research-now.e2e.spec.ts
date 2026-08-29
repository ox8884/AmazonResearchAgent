import { expect, test } from '@playwright/test';

test('Research Now enqueues work and returns immediately', async ({ page }) => {
  await page.route('**/api/research-now', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ research_run_id: '7a985480-7a5d-4ef1-9648-2f443468e2fe' })
    });
  });

  await page.goto('/ko/dashboard');
  await page.getByRole('button', { name: '지금 리서치' }).click();
  await expect(page.getByText('대기열에 추가됨')).toBeVisible();
});
