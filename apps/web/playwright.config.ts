import { defineConfig } from '@playwright/test';
import { e2eAdminEnvironment } from './e2e/test-admin';

const externalBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:3100';

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
          command: 'pnpm exec next dev --port 3100 --hostname 127.0.0.1',
          url: `${baseURL}/ko/showcase`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            ...process.env,
            ...e2eAdminEnvironment
          }
        }
      })
});
