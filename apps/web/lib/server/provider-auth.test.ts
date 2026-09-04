import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listProviders, POST as saveProvider } from '../../app/api/ai-providers/route';
import { POST as testProvider } from '../../app/api/ai-providers/test/route';
import { GET as getProviderTest } from '../../app/api/ai-provider-tests/[jobId]/route';
import { POST as login } from '../../app/api/auth/login/route';
import { hashAdminPassword } from './admin-session';
import { loginRateLimit, loginScryptGate } from './abuse-guard';

vi.mock('./login-guard', () => ({
  consumeDurableLoginAttempt: async () => undefined,
  withDurableLoginScrypt: async <T>(work: () => Promise<T>) => work()
}));

vi.mock('./admin-session-store', () => ({
  persistAdminSession: async () => undefined,
  isAdminSessionActive: async () => true,
  revokeAdminSession: async () => undefined,
  AdminSessionStoreError: class AdminSessionStoreError extends Error {}
}));

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64
};

beforeEach(async () => {
  loginRateLimit.reset();
  loginScryptGate.reset();
  process.env.ADMIN_PASSWORD_SCRYPT = await hashAdminPassword(
    'correct horse battery staple',
    Buffer.alloc(16, 2)
  );
  process.env.APP_SESSION_SIGNING_KEY_B64 = Buffer.alloc(32, 5).toString('base64');
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('provider administration authentication', () => {
  it('rejects unauthenticated provider reads and mutations before database access', async () => {
    const read = await listProviders(
      new Request('https://app.example.test/api/ai-providers')
    );
    const mutation = await saveProvider(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      })
    );
    const test = await testProvider(
      new Request('https://app.example.test/api/ai-providers/test', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ providerId: 'provider-1' })
      })
    );
    const poll = await getProviderTest(
      new Request('https://app.example.test/api/ai-provider-tests/job-1'),
      { params: Promise.resolve({ jobId: 'job-1' }) }
    );

    expect(read.status).toBe(401);
    expect(mutation.status).toBe(401);
    expect(test.status).toBe(401);
    expect(poll.status).toBe(401);
  });

  it('issues HttpOnly SameSite Strict session and bound CSRF cookies', async () => {
    const response = await login(
      new Request('https://app.example.test/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ password: 'correct horse battery staple' })
      })
    );
    const cookies = response.headers.getSetCookie();

    expect(response.status).toBe(200);
    expect(cookies).toHaveLength(2);
    expect(cookies.some((cookie) => cookie.includes('ara_admin_session=') && cookie.includes('HttpOnly'))).toBe(true);
    expect(cookies.every((cookie) => cookie.includes('SameSite=Strict'))).toBe(true);
    expect(cookies.some((cookie) => cookie.includes('ara_csrf=') && !cookie.includes('HttpOnly'))).toBe(true);
  });
});
