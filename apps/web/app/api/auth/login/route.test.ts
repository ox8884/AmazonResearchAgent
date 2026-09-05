import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAdminPassword } from '../../../../lib/server/admin-session';
import { AbuseGuardError } from '../../../../lib/server/abuse-guard';
import { POST } from './route';

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64,
  ARA_TRUST_CLOUDFLARE_CLIENT_IP: process.env.ARA_TRUST_CLOUDFLARE_CLIENT_IP,
  NODE_ENV: process.env.NODE_ENV
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

vi.mock('../../../../lib/server/login-guard', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/server/login-guard')
  >('../../../../lib/server/login-guard');
  return {
    ...actual,
    consumeDurableLoginAttempt: (clientIdentityHash: string | undefined) =>
      consumeDurableLoginAttempt(clientIdentityHash),
    withDurableLoginScrypt: <T>(work: () => Promise<T>) => withDurableLoginScrypt(work)
  };
});

vi.mock('../../../../lib/server/admin-session-store', () => ({
  AdminSessionStoreError: class AdminSessionStoreError extends Error {},
  persistAdminSession: (...args: unknown[]) => persistAdminSession(...args)
}));

function loginRequest(
  password: string,
  headers: Readonly<Record<string, string>> = {}
): Request {
  return new Request('https://app.example.test/api/auth/login', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      host: 'app.example.test',
      'content-type': 'application/json',
      ...headers
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
    vi.unstubAllEnvs();
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

  it('fails closed before rate-limit consumption when production is not configured to trust Cloudflare client IPs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ARA_TRUST_CLOUDFLARE_CLIENT_IP;

    const response = await POST(loginRequest('correct horse battery staple', {
      'cf-connecting-ip': '203.0.113.10'
    }));

    expect(response.status).toBe(401);
    expect(consumeDurableLoginAttempt).not.toHaveBeenCalled();
    expect(verifyAdminPassword).not.toHaveBeenCalled();
  });

  it('does not treat forwarded client-IP headers as identity outside the trusted Cloudflare deployment', async () => {
    delete process.env.ARA_TRUST_CLOUDFLARE_CLIENT_IP;
    const first = await POST(loginRequest('correct horse battery staple', {
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': '203.0.113.10'
    }));
    const second = await POST(loginRequest('correct horse battery staple', {
      'cf-connecting-ip': '203.0.113.11',
      'x-forwarded-for': '203.0.113.11'
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(consumeDurableLoginAttempt.mock.calls).toEqual([[undefined], [undefined]]);
  });

  it('allows a second trusted Cloudflare client after the first client exhausts its budget', async () => {
    process.env.ARA_TRUST_CLOUDFLARE_CLIENT_IP = 'true';
    const attemptsByClient = new Map<string, number>();
    consumeDurableLoginAttempt.mockImplementation((clientIdentityHash: unknown) => {
      if (typeof clientIdentityHash !== 'string') {
        throw new AbuseGuardError();
      }
      const nextAttempts = (attemptsByClient.get(clientIdentityHash) ?? 0) + 1;
      attemptsByClient.set(clientIdentityHash, nextAttempts);
      if (nextAttempts > 8) {
        throw new AbuseGuardError();
      }
    });
    verifyAdminPassword.mockImplementation(async (password: string) =>
      password === 'correct horse battery staple'
    );

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await POST(loginRequest('wrong', {
        'cf-connecting-ip': '2001:0db8:0:0:0:0:0:1'
      }));
      expect(response.status).toBe(401);
    }

    const sameClient = await POST(loginRequest('wrong', {
      'cf-connecting-ip': '2001:db8::1'
    }));
    expect(sameClient.status).toBe(401);

    const response = await POST(loginRequest('correct horse battery staple', {
      'cf-connecting-ip': '2001:db8::2'
    }));

    expect(response.status).toBe(200);
    expect(attemptsByClient.size).toBe(2);
  });
});
