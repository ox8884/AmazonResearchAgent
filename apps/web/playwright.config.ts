import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const baseURL = externalBaseUrl ?? 'http://localhost:3000';

export default defineConfig({
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: true,
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: `${baseURL}/ko/showcase`,
          reuseExistingServer: true,
          timeout: 60_000
        }
      })
});
