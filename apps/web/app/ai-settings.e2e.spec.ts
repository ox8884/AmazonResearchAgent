import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from '../e2e/test-admin';

async function loginAsAdmin(page: Page, locale: 'ko' | 'en'): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(locale === 'ko' ? '관리자 비밀번호' : 'Admin password').fill(
    E2E_ADMIN_PASSWORD
  );
  await page.getByRole('button', { name: locale === 'ko' ? '로그인' : 'Log in' }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/settings/ai$`, 'u'));
}

test('redirects unauthenticated AI settings to login', async ({ page }) => {
  await page.goto('/ko/settings/ai');
  await expect(page).toHaveURL(/\/ko\/login$/u);
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible();
});

test('logs in and opens Korean and English AI settings', async ({ page }) => {
  await loginAsAdmin(page, 'ko');
  await expect(page.getByRole('heading', { level: 1, name: 'AI Provider 설정' })).toBeVisible();

  await page.goto('/en/login');
  await page.getByLabel('Admin password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/en\/settings\/ai$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'AI provider settings' })).toBeVisible();
});

test('saves a custom provider without redisplaying the secret', async ({ page }) => {
  await page.route('**/api/ai-providers', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [] })
      });
      return;
    }
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

  await loginAsAdmin(page, 'ko');
  await page.getByLabel('Provider name').fill('My Provider');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:4000/v1');
  await page.getByLabel('API Key').fill('secret-value');
  await page.getByRole('button', { name: '저장' }).click();

  await expect(page.getByText('••••alue')).toBeVisible();
  await expect(page.getByText('secret-value')).toHaveCount(0);
});
