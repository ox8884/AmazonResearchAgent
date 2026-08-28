import { defineConfig } from '@playwright/test';
import { e2eAdminEnvironment } from './e2e/test-admin';

const externalBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:3100';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function playwrightWebServerEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env.SUPABASE_URL = process.env.SUPABASE_URL?.trim() || LOCAL_SUPABASE_URL;
  env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || LOCAL_SUPABASE_SERVICE_ROLE_KEY;
  Object.assign(env, e2eAdminEnvironment);
  return env;
}


export default defineConfig({
  testMatch: '**/*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
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
          env: playwrightWebServerEnv()
        }
      })
});

