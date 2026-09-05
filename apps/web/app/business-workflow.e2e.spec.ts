import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { loginAsAdmin } from '../e2e/test-admin';

const candidateId = '00000000-0000-4000-8000-000000000301';
const beforeEvidenceRoot = path.resolve(
  '../../.superpowers/sdd/2026-09-04-budget-first-research/review-logs/evidence/2026-09-05-budget-first-workflow'
);
const finalEvidenceRoot = path.resolve('../../review-logs/evidence/2026-09-05-budget-first-workflow');
const settingLabels = {
  launchBudgetUsd: '출시 예산 (USD)',
  minimumPreAdMarginPct: '광고 전 최소 마진 (%)',
  minimumPostAdMarginPct: '광고 후 최소 마진 (%)',
  minimumRoiPct: '최소 ROI (%)'
} as const;

type Settings = { readonly launchBudgetUsd: string; readonly minimumPreAdMarginPct: string; readonly minimumPostAdMarginPct: string; readonly minimumRoiPct: string };

test.use({ bypassCSP: true });

async function captureAtViewports(page: Page, root: string, name: string): Promise<void> {
  for (const width of [375, 768, 1280] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(root, `${name}-${width}.png`), fullPage: true });
  }
}

async function captureBaseline(page: Page): Promise<void> {
  const routes = [
    ['candidate', `/ko/candidates/${candidateId}`],
    ['settings', '/ko/settings'],
    ['imports', '/ko/imports/new']
  ] as const;
  for (const [name, route] of routes) {
    await openSharedPage(page, route);
    await captureAtViewports(page, path.join(beforeEvidenceRoot, 'before'), name);
  }
}

async function openSharedPage(page: Page, route: string): Promise<void> {
  await page.goto(route);
  const reload = page.getByRole('button', { name: 'Reload' });
  if (await reload.isVisible({ timeout: 500 })) await reload.click();
}

async function saveSettings(page: Page, settings: Settings) {
  await openSharedPage(page, '/ko/settings');
  for (const [field, label] of Object.entries(settingLabels) as [keyof Settings, string][]) {
    await page.getByLabel(label).fill(settings[field]);
  }
  for (const [field, label] of Object.entries(settingLabels) as [keyof Settings, string][]) {
    await expect(page.getByLabel(label)).toHaveValue(settings[field]);
  }
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/research-settings') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '상업 기준 저장' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json() as { settings: Record<keyof Settings, number> };
  for (const [field, value] of Object.entries(settings) as [keyof Settings, string][]) expect(payload.settings[field]).toBe(Number(value));
  await expect(page.getByText('출시 예산·수익성 기준을 저장했습니다.')).toBeVisible();
  return payload.settings;
}

async function openCandidateWithFreshAssessment(page: Page) {
  const responsePromise = page.waitForResponse((response) => response.url().includes(`/api/candidates/${candidateId}/business`) && response.request().method() === 'GET');
  await openSharedPage(page, `/ko/candidates/${candidateId}`);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ assessment: { settings: Record<keyof Settings, number> } }>;
}

async function fillCommercialEvidence(page: Page): Promise<void> {
  await page.getByLabel('제품 사양 레퍼런스').fill('QA bamboo utensil holder exact specification');
  await page.getByLabel('제품 사양 설명').fill('Countertop bamboo utensil holder with removable drip tray.');
  await page.getByLabel('금액·견적 출처 레퍼런스').fill('QA supplier quote');
  await page.getByLabel('출처 URL').fill('https://supplier.example/qa-bamboo-utensil-holder');
  await page.getByLabel('공급처 이름').fill('QA Supplier');
  await page.getByLabel('판매가 (USD)').fill('30');
  await page.getByLabel('Amazon referral fee (USD)').fill('3');
  await page.getByLabel('FBA fulfillment fee (USD)').fill('4');
  await page.getByLabel('Other variable cost (USD)').fill('0');
  await page.getByLabel('예상 단위 광고비 (USD)').fill('3');
  await page.getByLabel('예상 단위 반품비 (USD)').fill('1');
  await page.getByLabel('수량').fill('100');
  await page.getByLabel('MOQ').fill('100');
  await page.getByLabel('도착 단가 (USD)').fill('5');
  await page.getByLabel('도착 총액 (USD)').fill('500');
  await page.getByLabel('선행 출시 비용 (USD)').fill('100');
  await page.getByLabel('출시 광고 현금 (USD)').fill('100');
  await page.getByLabel('출시 예비 현금 (USD)').fill('100');
  await page.getByLabel('브랜드 적합성').selectOption('pass');
  await page.getByLabel('시장 검증').selectOption('pass');
  await page.getByLabel('관측 시작').fill('2026-08-01T00:00');
  await page.getByLabel('관측 종료').fill('2026-08-31T23:59');
  await page.getByLabel('비교 근거').fill('QA fixture comparison against the saved Top Products notes.');
}

async function saveCommercialEvidence(page: Page): Promise<void> {
  await fillCommercialEvidence(page);
  await page.getByRole('button', { name: '상업 근거 저장' }).click();
  await expect(page.getByText('상업 근거를 저장했습니다.')).toBeVisible();
}

const defaultSettings: Settings = { launchBudgetUsd: '3000', minimumPreAdMarginPct: '35', minimumPostAdMarginPct: '35', minimumRoiPct: '150' };

test('persists four saved settings and candidate evidence after reload', async ({ page }) => {
  await loginAsAdmin(page);
  if (process.env['BUSINESS_CAPTURE_PHASE'] === 'before') {
    await captureBaseline(page);
    return;
  }

  await saveSettings(page, defaultSettings);
  await page.reload();
  for (const [field, label] of Object.entries(settingLabels) as [keyof Settings, string][]) await expect(page.getByLabel(label)).toHaveValue(defaultSettings[field]);

  await openCandidateWithFreshAssessment(page);
  await expect(page.getByRole('heading', { name: '상업 근거 및 다음 조치' })).toBeVisible();
  await saveCommercialEvidence(page);
  await expect(page.getByText('견적 초안 준비')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('수량')).toHaveValue('100');
  await expect(page.getByText('견적 초안 준비')).toBeVisible();
});

test('uses GET-only assessment refresh after each saved target change and quantity edit', async ({ page }) => {
  test.skip(process.env['BUSINESS_CAPTURE_PHASE'] === 'before', 'Baseline capture only needs the original page state.');
  await loginAsAdmin(page);
  await saveSettings(page, defaultSettings);
  await openCandidateWithFreshAssessment(page);
  await saveCommercialEvidence(page);

  let businessPostCount = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/api/candidates/${candidateId}/business`) && request.method() === 'POST') businessPostCount += 1;
  });
  const budgetResponse = await saveSettings(page, { ...defaultSettings, launchBudgetUsd: '600' });
  expect(budgetResponse.launchBudgetUsd).toBe(600);
  const budgetAssessment = await openCandidateWithFreshAssessment(page);
  expect(budgetAssessment.assessment.settings.launchBudgetUsd).toBe(600);
  await expect(page.getByText('보류')).toBeVisible();
  await expect(page.getByText('출시 현금이 현재 예산을 초과합니다.')).toBeVisible();
  await expect(page.getByLabel('수량')).toHaveValue('100');
  expect(businessPostCount).toBe(0);

  await page.getByLabel('제품 사양 설명').fill('Unsaved QA description stays in the form.');
  const manualRefreshPromise = page.waitForResponse((response) => response.url().includes(`/api/candidates/${candidateId}/business`) && response.request().method() === 'GET');
  await page.getByRole('button', { name: '현재 기준 다시 확인' }).click();
  const manualRefresh = await manualRefreshPromise;
  expect((await manualRefresh.json() as { assessment: { settings: { launchBudgetUsd: number } } }).assessment.settings.launchBudgetUsd).toBe(600);
  await expect(page.getByLabel('제품 사양 설명')).toHaveValue('Unsaved QA description stays in the form.');
  expect(businessPostCount).toBe(0);

  const targetResponse = await saveSettings(page, { ...defaultSettings, minimumPreAdMarginPct: '60', minimumPostAdMarginPct: '60', minimumRoiPct: '400' });
  expect(targetResponse.minimumPreAdMarginPct).toBe(60);
  expect(targetResponse.minimumPostAdMarginPct).toBe(60);
  expect(targetResponse.minimumRoiPct).toBe(400);
  const targetAssessment = await openCandidateWithFreshAssessment(page);
  expect(targetAssessment.assessment.settings.minimumPreAdMarginPct).toBe(60);
  expect(targetAssessment.assessment.settings.minimumPostAdMarginPct).toBe(60);
  expect(targetAssessment.assessment.settings.minimumRoiPct).toBe(400);
  await expect(page.getByText('현재 마진·ROI 목표를 충족하지 않습니다.')).toBeVisible();
  expect(businessPostCount).toBe(0);

  await saveSettings(page, defaultSettings);
  await openCandidateWithFreshAssessment(page);
  await page.getByLabel('수량').fill('600');
  await page.getByLabel('도착 총액 (USD)').fill('3000');
  await page.getByRole('button', { name: '상업 근거 저장' }).click();
  await expect(page.getByText('상업 근거를 저장했습니다.')).toBeVisible();
  await expect(page.getByText('보류')).toBeVisible();
  await expect(page.getByText('출시 현금이 현재 예산을 초과합니다.')).toBeVisible();
  expect(businessPostCount).toBe(1);
});

test('captures populated, missing, and overbudget Task 3 views', async ({ page }) => {
  test.skip(process.env['BUSINESS_CAPTURE_PHASE'] !== 'after', 'Capture is an explicit evidence step.');
  await loginAsAdmin(page);

  await saveSettings(page, { ...defaultSettings, launchBudgetUsd: '5000' });
  await openCandidateWithFreshAssessment(page);
  await expect(page.getByText('견적 초안 준비')).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'after'), 'candidate-populated');

  await page.route(`**/api/candidates/${candidateId}/business`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        evidence: null,
        assessment: {
          stage: 'basic_check', gaps: ['business_evidence'],
          settings: { launchBudgetUsd: 5000, minimumPreAdMarginPct: 35, minimumPostAdMarginPct: 35, minimumRoiPct: 150 },
          estimatedLaunchCashUsd: null, estimatedUnitContributionUsd: null, estimatedMarginPct: null, purchaseApproved: false
        }
      })
    });
  });
  await openCandidateWithFreshAssessment(page);
  await expect(page.getByText('상업 근거가 아직 기록되지 않았습니다.')).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'after'), 'candidate-missing-fixture');
  await page.unroute(`**/api/candidates/${candidateId}/business`);

  await saveSettings(page, defaultSettings);
  await openCandidateWithFreshAssessment(page);
  await expect(page.getByText('출시 현금이 현재 예산을 초과합니다.')).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'after'), 'candidate-overbudget');

  await openSharedPage(page, '/ko/settings');
  await expect(page.getByRole('heading', { name: '출시 예산·수익성 기준' })).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'after'), 'settings');
  await openSharedPage(page, '/ko/imports/new');
  await expect(page.getByText('웹 리서치 인계')).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'after'), 'imports');
  await page.setViewportSize({ width: 1280, height: 1000 });
});

test('captures a draft-preserving criteria refresh', async ({ page }) => {
  test.skip(process.env['BUSINESS_CAPTURE_PHASE'] !== 'fix-round-1', 'Capture the changed refresh feedback separately.');
  await loginAsAdmin(page);
  await openCandidateWithFreshAssessment(page);
  await page.getByLabel('제품 사양 설명').fill('Unsaved QA description stays in the form.');
  const refreshPromise = page.waitForResponse((response) => response.url().includes(`/api/candidates/${candidateId}/business`) && response.request().method() === 'GET');
  await page.getByRole('button', { name: '현재 기준 다시 확인' }).click();
  await refreshPromise;
  await expect(page.getByLabel('제품 사양 설명')).toHaveValue('Unsaved QA description stays in the form.');
  await expect(page.getByRole('status')).toBeVisible();
  await captureAtViewports(page, path.join(finalEvidenceRoot, 'fix-round-1'), 'candidate-draft-refresh');
  await page.setViewportSize({ width: 1280, height: 1000 });
});
