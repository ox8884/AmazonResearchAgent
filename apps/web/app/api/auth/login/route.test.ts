import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAdminPassword } from '../../../../lib/server/admin-session';
import { AbuseGuardError } from '../../../../lib/server/abuse-guard';
import { POST } from './route';

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64
};

const verifyAdminPassword = vi.fn();
const consumeDurableLoginAttempt = vi.fn();
const withDurableLoginScrypt = vi.fn();
const persistAdminSession = vi.fn();

vi.mock('../../../../lib/server/admin-session', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/server/admin-session')
  >('../../../../lib/server/admin-session');
  return {
    ...actual,
    verifyAdminPassword: (...args: unknown[]) => verifyAdminPassword(...args)
  };
});

vi.mock('../../../../lib/server/login-guard', () => ({
  consumeDurableLoginAttempt: () => consumeDurableLoginAttempt(),
  withDurableLoginScrypt: <T>(work: () => Promise<T>) => withDurableLoginScrypt(work)
}));

vi.mock('../../../../lib/server/admin-session-store', () => ({
  AdminSessionStoreError: class AdminSessionStoreError extends Error {},
  persistAdminSession: (...args: unknown[]) => persistAdminSession(...args)
}));

function loginRequest(password: string): Request {
  return new Request('https://app.example.test/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      host: 'app.example.test',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ password })
  });
}

describe('login abuse protection', () => {
  beforeEach(async () => {
    consumeDurableLoginAttempt.mockReset();
    consumeDurableLoginAttempt.mockResolvedValue(undefined);
    withDurableLoginScrypt.mockReset();
    withDurableLoginScrypt.mockImplementation(async (work: () => Promise<unknown>) => work());
    verifyAdminPassword.mockReset();
    verifyAdminPassword.mockResolvedValue(true);
    persistAdminSession.mockReset();
    persistAdminSession.mockResolvedValue(undefined);
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

  it('rejects further attempts before another password check once the login budget is spent', async () => {
    verifyAdminPassword.mockResolvedValue(false);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(loginRequest('wrong'));
      expect(response.status).toBe(401);
    }
    expect(verifyAdminPassword).toHaveBeenCalledTimes(8);
    consumeDurableLoginAttempt.mockRejectedValue(new AbuseGuardError());
    const blocked = await POST(loginRequest('wrong'));
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toEqual({ error: 'invalid_credentials' });
    expect(verifyAdminPassword).toHaveBeenCalledTimes(8);
  });

  it('still issues a session for a legitimate login', async () => {
    const response = await POST(loginRequest('correct horse battery staple'));
    expect(response.status).toBe(200);
    expect(
      response.headers.getSetCookie().some((cookie) => cookie.includes('ara_admin_session='))
    ).toBe(true);
    expect(persistAdminSession).toHaveBeenCalledOnce();
  });

  it('does not start a second scrypt while one is in flight', async () => {
    withDurableLoginScrypt.mockRejectedValueOnce(
      new AbuseGuardError('Too many concurrent requests.')
    );
    const blocked = await POST(loginRequest('correct horse battery staple'));
    expect(blocked.status).toBe(401);
    expect(verifyAdminPassword).not.toHaveBeenCalled();
  });
});
