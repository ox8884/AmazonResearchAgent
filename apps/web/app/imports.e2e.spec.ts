import { expect, test } from '@playwright/test';
import path from 'node:path';
import { loginAsAdmin } from '../e2e/test-admin';

const fixtureRoot = path.resolve('../../tests/fixtures/opportunity-finder');
const fixtureFiles = [
  path.join(fixtureRoot, 'page-1.csv'),
  path.join(fixtureRoot, 'page-2.csv')
];

test('queues multiple CSV files and reports the import in Korean', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/imports', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ import_run_id: '7a985480-7a5d-4ef1-9648-2f443468e2fe' })
    });
  });

  await page.goto('/ko/imports/new');
  await page.waitForLoadState('networkidle');
  const input = page.locator('input[type=file]');
  await input.setInputFiles(fixtureFiles);
  expect(
    await input.evaluate((element: HTMLInputElement) =>
      Array.from(element.files ?? [], (file) => file.name)
    )
  ).toEqual(['page-1.csv', 'page-2.csv']);
  await expect(page.getByText('page-1.csv')).toBeVisible();
  await expect(page.getByText('page-2.csv')).toBeVisible();
  await page.getByRole('button', { name: '가져오기 시작' }).click();

  await expect(page.getByText('처리 대기')).toBeVisible();
  await expect(page.getByText('7a985480-7a5d-4ef1-9648-2f443468e2fe')).toBeVisible();
});

test('preserves the import route when switching to English', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ko/imports/new');
  await page.getByRole('link', { name: 'English' }).click();

  await expect(page).toHaveURL(/\/en\/imports\/new$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Upload CSV files' })).toBeVisible();
});

test('shows Korean showcase labels without mixed-language section headings', async ({ page }) => {
  await page.goto('/ko/showcase');

  await expect(page.getByRole('heading', { name: '동작' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '상태', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '지표' })).toBeVisible();
});

test('blocks a selection above the 20-file upload limit', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ko/imports/new');
  await page.waitForLoadState('networkidle');
  const files = Array.from({ length: 21 }, (_, index) => ({
    name: `page-${index + 1}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from('Keyword,Search Volume\\nitem,1000\\n')
  }));

  await page.locator('input[type=file]').setInputFiles(files);

  await expect(page.locator('.notice[role=alert]')).toContainText('최대 20개');
  await expect(page.getByRole('button', { name: '가져오기 시작' })).toBeDisabled();
});
