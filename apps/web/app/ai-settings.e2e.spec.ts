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
// Break: a successful OpenAI-compatible connection test is misattributed to every compatible provider card.

test('renders OpenAI-compatible connection test results without secrets', async ({ page }) => {
  const provider = {
    id: 'openai-compatible-fixture-a',
    product: 'openai_compatible_api',
    productLabel: 'OpenAI-Compatible API',
    name: 'Fixture Provider A',
    billingType: 'subscription',
    enabled: true,
    priority: 100,
    secretLast4: null,
    roles: ['niche_normalization'],
    baseUrl: 'https://provider.example/v1',
    networkScope: 'public',
    modelId: null,
    modelDiscovery: 'enabled',
    settingsRevision: 1,
    models: []
  };
  const secondProvider = {
    ...provider,
    id: 'openai-compatible-fixture-b',
    name: 'Fixture Provider B'
  };
  const refreshedProvider = { ...provider };
  const testRequests: Record<string, unknown>[] = [];
  const providerGets: unknown[] = [];

  await page.route('**/api/ai-providers', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    providerGets.push(providerGets.length === 0 ? [provider, secondProvider] : [refreshedProvider, secondProvider]);
    const listedProviders = providerGets.at(-1) as readonly typeof provider[];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: listedProviders })
    });
  });
  await page.route('**/api/ai-providers/test', async (route) => {
    testRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: 'job-openai-compatible', status: 'queued' })
    });
  });
  await page.route('**/api/ai-provider-tests/job-openai-compatible', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'job-openai-compatible',
        status: 'completed',
        result: {
          providerTest: {
            available: true,
            models: ['openai/gpt-5.6-terra', 'openai/gpt-5.6-mini']
          }
        },
        errorCategory: null
      })
    });
  });

  await loginAsAdmin(page, 'ko');
  const testedCard = page.locator('section.provider-result').filter({ hasText: provider.name });
  const otherCard = page.locator('section.provider-result').filter({ hasText: secondProvider.name });
  await testedCard.getByRole('button', { name: '연결 테스트' }).click();

  await expect.poll(() => testRequests).toEqual([{ providerId: provider.id }]);
  const status = testedCard.getByRole('status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('openai/gpt-5.6-terra');
  await expect(status).toContainText('openai/gpt-5.6-mini');
  await expect(otherCard.getByRole('status')).toHaveCount(0);
  await expect(otherCard).not.toContainText('openai/gpt-5.6-terra');
  await expect(otherCard).not.toContainText('openai/gpt-5.6-mini');
  await expect(page.getByLabel('API Key')).toHaveValue('');
  expect(JSON.stringify(provider)).not.toContain('plaintext-secret-fixture');
  expect(provider).not.toHaveProperty('apiKey');
  expect(JSON.stringify(secondProvider)).not.toContain('plaintext-secret-fixture');
  expect(secondProvider).not.toHaveProperty('apiKey');
});


// Break: browser edits hydrate plaintext, overwrite a secret with blank input, or retain an old key.

test('preserves write-only HTTP secrets through blank and replacement edits', async ({ page }) => {
  let providers: unknown[] = [];
  let secretLast4: string | null = null;
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/ai-providers', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers })
      });
      return;
    }
    const submitted = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(submitted);
    const submittedApiKey = typeof submitted.apiKey === 'string' ? submitted.apiKey.trim() : '';
    if (submittedApiKey) secretLast4 = submittedApiKey.slice(-4);
    const provider = {
      id: 'mock-provider',
      product: 'openai_compatible_api',
      productLabel: 'OpenAI-Compatible API',
      name: 'My Provider',
      billingType: 'subscription',
      enabled: true,
      priority: typeof submitted.priority === 'number' ? submitted.priority : 100,
      secretLast4,
      roles: ['niche_normalization'],
      baseUrl: 'http://127.0.0.1:4000/v1',
      networkScope: 'loopback',
      modelId: null,
      modelDiscovery: 'enabled',
      settingsRevision: submissions.length,
      models: []
    };
    providers = [provider];
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ provider })
    });
  });

  await loginAsAdmin(page, 'ko');
  await page.getByLabel('AI 제품').selectOption('openai_compatible_api');
  await page.getByLabel('Provider 이름').fill('My Provider');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:4000/v1');
  await page.getByLabel('Network scope').selectOption('loopback');
  await page.getByLabel('API Key').fill('secret-value');
  await page.getByRole('button', { name: '저장' }).click();

  await expect(page.getByText('••••alue')).toBeVisible();
  await expect(page.getByText('secret-value')).toHaveCount(0);
  expect(JSON.stringify(providers)).not.toContain('secret-value');
  expect(providers[0]).not.toHaveProperty('apiKey');
  expect(submissions[0]).toMatchObject({
    product: 'openai_compatible_api',
    name: 'My Provider',
    apiKey: 'secret-value'
  });
  expect(submissions[0]).not.toHaveProperty('kind');
  expect(submissions[0]).not.toHaveProperty('commandProfileId');

  await page.reload();
  await expect(page.getByLabel('API Key')).toHaveValue('');
  await page.getByLabel('Provider priority').fill('101');
  await page.getByRole('button', { name: '저장' }).click();

  expect(submissions[1]).toMatchObject({
    id: 'mock-provider',
    apiKey: '',
    priority: 101,
    settingsRevision: 1
  });
  await expect(page.getByText('••••alue')).toBeVisible();
  await expect(page.getByText('secret-value')).toHaveCount(0);
  expect(JSON.stringify(providers)).not.toContain('secret-value');

  await page.reload();
  await expect(page.getByLabel('API Key')).toHaveValue('');
  await page.getByLabel('API Key').fill('replacement-secret');
  await page.getByRole('button', { name: '저장' }).click();

  expect(submissions[2]).toMatchObject({
    id: 'mock-provider',
    apiKey: 'replacement-secret',
    settingsRevision: 2
  });
  await expect(page.getByText('••••cret')).toBeVisible();
  await expect(page.getByText('••••alue')).toHaveCount(0);
  await expect(page.getByText('replacement-secret')).toHaveCount(0);
  expect(JSON.stringify(providers)).not.toContain('replacement-secret');
  expect(providers[0]).not.toHaveProperty('apiKey');

  await page.reload();
  await expect(page.getByLabel('API Key')).toHaveValue('');
  await expect(page.getByText('replacement-secret')).toHaveCount(0);
});

test('subscription products expose only safe status, Test, and Disable', async ({ page }) => {
  const provider = {
    id: 'codex-subscription-v1',
    product: 'codex_subscription',
    productLabel: 'OpenAI Codex Subscription',
    name: 'OpenAI Codex Subscription',
    billingType: 'subscription',
    enabled: true,
    priority: 20,
    role: 'niche_normalization',
    modelLabel: 'GPT-5.6',
    setupStatus: 'setup_required',
    statusReason: 'setup_required',
    lastCheckedAt: null,
    settingsRevision: 1
  };
  const providerRequests: Record<string, unknown>[] = [];
  const testRequests: Record<string, unknown>[] = [];
  await page.route('**/api/ai-providers/test', async (route) => {
    testRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: 'job-subscription', status: 'queued' })
    });
  });
  await page.route('**/api/ai-provider-tests/job-subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'job-subscription',
        status: 'completed',
        result: {
          providerTest: { available: false, models: [] }
        },
        errorCategory: null
      })
    });
  });
  await page.route('**/api/ai-providers', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [provider] })
      });
      return;
    }
    providerRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    provider.enabled = false;
    provider.setupStatus = 'disabled';
    provider.statusReason = 'disabled';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providerId: provider.id, setupStatus: 'disabled' })
    });
  });

  await loginAsAdmin(page, 'ko');
  const product = page.getByLabel('AI 제품');
  await expect(product.locator('option')).toHaveText([
    'OpenAI Codex Subscription',
    'Grok Subscription',
    'OpenAI-Compatible API'
  ]);
  await expect(page.getByLabel('API Key')).toHaveCount(0);
  await expect(page.getByLabel('Base URL')).toHaveCount(0);
  await expect(page.getByLabel('Model ID')).toHaveCount(0);
  await expect(page.getByLabel('Provider enabled')).toHaveCount(0);
  await expect(page.getByText('subscription_command')).toHaveCount(0);
  await expect(page.getByText('niche_normalization')).toBeVisible();
  await expect(page.getByLabel('Provider priority')).toHaveValue('20');
  await expect(page.getByText('설정 필요')).toBeVisible();
  await expect(page.getByText('운영 서버에서 승인된 절차로 인증 또는 재인증하세요.')).toBeVisible();

  await page.getByRole('button', { name: '연결 테스트' }).click();
  await expect.poll(() => testRequests).toEqual([{ providerId: provider.id }]);
  await page.getByRole('button', { name: '비활성화' }).click();
  await expect.poll(() => providerRequests).toEqual([
    { action: 'disable', providerId: provider.id }
  ]);
  await expect(page.getByText('비활성화됨')).toBeVisible();
  await expect(page.getByText('설정 필요')).toHaveCount(0);

  await page.goto('/en/settings/ai');
  await expect(page.getByText('Disabled')).toBeVisible();
  await expect(page.getByText('Setup Required')).toHaveCount(0);
});
