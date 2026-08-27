import { expect, test } from '@playwright/test';

test('saves a custom provider without redisplaying the secret', async ({ page }) => {
  await page.route('**/api/ai-providers', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: {
          id: 'mock-provider',
          name: 'My Provider',
          kind: 'openai_http',
          billingType: 'subscription',
          enabled: true,
          secretLast4: 'alue',
          models: []
        }
      })
    });
  });

  await page.goto('/ko/settings/ai');
  await page.getByLabel('Provider name').fill('My Provider');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:4000/v1');
  await page.getByLabel('API Key').fill('secret-value');
  await page.getByRole('button', { name: '저장' }).click();

  await expect(page.getByText('••••alue')).toBeVisible();
  await expect(page.getByText('secret-value')).toHaveCount(0);
});
