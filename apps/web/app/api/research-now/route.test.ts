import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAdminPassword } from '../../../lib/server/admin-session';
import { loginRateLimit, loginScryptGate } from '../../../lib/server/abuse-guard';
import { POST } from './route';
import { POST as login } from '../auth/login/route';

const enqueueResearchNow = vi.fn();

vi.mock('../../../lib/server/admin-session-store', () => ({
  persistAdminSession: async () => undefined,
  isAdminSessionActive: async () => true,
  AdminSessionStoreError: class AdminSessionStoreError extends Error {}
}));

vi.mock('../../../lib/server/research-now', () => ({
  enqueueResearchNow: (...args: unknown[]) => enqueueResearchNow(...args),
  ResearchNowEnqueueError: class ResearchNowEnqueueError extends Error {}
}));

vi.mock('../../../lib/server/login-guard', () => ({
  consumeDurableLoginAttempt: async () => undefined,
  consumeDurableImportAttempt: async () => undefined,
  trustedCloudflareClientIdentityHash: () => undefined,
  assertAdminClientAllowed: () => undefined,
  withDurableLoginScrypt: async <T>(work: () => Promise<T>) => work()
}));

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64
};

async function issueSession(): Promise<{ cookie: string; csrf: string }> {
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
  const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
  const csrf = decodeURIComponent(
    cookies
      .find((entry) => entry.startsWith('ara_csrf='))
      ?.split(';')[0]
      ?.slice('ara_csrf='.length) ?? ''
  );
  return { cookie, csrf };
}

function researchNowRequest(
  headers: HeadersInit,
  body: unknown
): Request {
  return new Request('https://app.example.test/api/research-now', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      host: 'app.example.test',
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });
}

describe('research now route', () => {
  beforeEach(async () => {
    enqueueResearchNow.mockReset();
    enqueueResearchNow.mockResolvedValue({
      researchRunId: '7a985480-7a5d-4ef1-9648-2f443468e2fe'
    });
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

  it('rejects unauthenticated research now before enqueue', async () => {
    const response = await POST(researchNowRequest({}, { mode: 'normal' }));
    expect(response.status).toBe(401);
    expect(enqueueResearchNow).not.toHaveBeenCalled();
  });

  it('rejects authenticated research now with a bad CSRF token', async () => {
    const session = await issueSession();
    const response = await POST(
      researchNowRequest(
        { cookie: session.cookie, 'x-csrf-token': 'not-the-session-csrf' },
        { mode: 'normal' }
      )
    );
    expect(response.status).toBe(403);
    expect(enqueueResearchNow).not.toHaveBeenCalled();
  });

  it('rejects an invalid mode before enqueue', async () => {
    const session = await issueSession();
    const response = await POST(
      researchNowRequest(
        { cookie: session.cookie, 'x-csrf-token': session.csrf },
        { mode: 'payg' }
      )
    );
    expect(response.status).toBe(400);
    expect(enqueueResearchNow).not.toHaveBeenCalled();
  });

  it('enqueues authenticated research now and returns 202', async () => {
    const session = await issueSession();
    const response = await POST(
      researchNowRequest(
        { cookie: session.cookie, 'x-csrf-token': session.csrf },
        { mode: 'normal' }
      )
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      research_run_id: '7a985480-7a5d-4ef1-9648-2f443468e2fe'
    });
    expect(enqueueResearchNow).toHaveBeenCalledOnce();
    expect(enqueueResearchNow).toHaveBeenCalledWith('normal');
  });
});
