import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAdminPassword } from '../../../../lib/server/admin-session';
import {
  LOGIN_RATE_KEY,
  loginRateLimit,
  loginScryptGate
} from '../../../../lib/server/abuse-guard';
import { POST } from './route';

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64
};

const verifyAdminPassword = vi.fn();

vi.mock('../../../../lib/server/admin-session', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/server/admin-session')
  >('../../../../lib/server/admin-session');
  return {
    ...actual,
    verifyAdminPassword: (...args: unknown[]) => verifyAdminPassword(...args)
  };
});

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
    loginRateLimit.reset();
    loginScryptGate.reset();
    verifyAdminPassword.mockReset();
    verifyAdminPassword.mockResolvedValue(true);
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
      expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    }
    expect(verifyAdminPassword).toHaveBeenCalledTimes(8);
    const blocked = await POST(loginRequest('wrong'));
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toEqual({ error: 'invalid_credentials' });
    expect(verifyAdminPassword).toHaveBeenCalledTimes(8);
  });

  it('still issues a session for a legitimate login', async () => {
    const response = await POST(loginRequest('correct horse battery staple'));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((cookie) => cookie.includes('ara_admin_session='))).toBe(
      true
    );
  });

  it('does not start a second scrypt while one is in flight', async () => {
    let release: (() => void) | undefined;
    verifyAdminPassword.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        })
    );
    const first = POST(loginRequest('correct horse battery staple'));
    await Promise.resolve();
    const second = await POST(loginRequest('correct horse battery staple'));
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: 'invalid_credentials' });
    expect(verifyAdminPassword).toHaveBeenCalledTimes(1);
    release?.();
    expect((await first).status).toBe(200);
    expect(LOGIN_RATE_KEY).toBe('admin-login');
  });
});
