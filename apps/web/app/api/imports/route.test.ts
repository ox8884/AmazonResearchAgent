import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashAdminPassword } from '../../../lib/server/admin-session';
import {
  importConcurrencyGate,
  importRateLimit,
  loginRateLimit,
  loginScryptGate
} from '../../../lib/server/abuse-guard';
import { POST } from './route';
import { POST as login } from '../auth/login/route';

const enqueueImport = vi.fn();

vi.mock('../../../lib/server/enqueue-import', () => ({
  enqueueImport: (...args: unknown[]) => enqueueImport(...args),
  ImportEnqueueError: class ImportEnqueueError extends Error {}
}));

vi.mock('../../../lib/server/login-guard', () => ({
  consumeDurableLoginAttempt: async () => undefined,
  withDurableLoginScrypt: async <T>(work: () => Promise<T>) => work()
}));

vi.mock('../../../lib/import-upload', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/import-upload')>(
    '../../../lib/import-upload'
  );
  return {
    ...actual,
    prepareUploadFiles: async (files: readonly File[]) =>
      files.map((file) => ({
        fileName: file.name,
        contentType: 'text/csv',
        bytes: Buffer.from('Keyword,Search Volume\nitem,1\n')
      }))
  };
});

const originalEnvironment = {
  ADMIN_PASSWORD_SCRYPT: process.env.ADMIN_PASSWORD_SCRYPT,
  APP_SESSION_SIGNING_KEY_B64: process.env.APP_SESSION_SIGNING_KEY_B64
};

function csvFile(): File {
  return new File(['Keyword,Search Volume\nitem,1\n'], 'page-1.csv', {
    type: 'text/csv'
  });
}

function importBody(): FormData {
  const body = new FormData();
  body.set('locale', 'ko');
  body.append('files', csvFile());
  return body;
}

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

describe('import route authentication', () => {
  beforeEach(async () => {
    enqueueImport.mockReset();
    enqueueImport.mockResolvedValue('7a985480-7a5d-4ef1-9648-2f443468e2fe');
    loginRateLimit.reset();
    loginScryptGate.reset();
    importRateLimit.reset();
    importConcurrencyGate.reset();
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

  it('rejects unauthenticated uploads before enqueue', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/imports', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test'
        },
        body: importBody()
      })
    );
    expect(response.status).toBe(401);
    expect(enqueueImport).not.toHaveBeenCalled();
  });

  it('rejects authenticated uploads with a bad CSRF token', async () => {
    const session = await issueSession();
    const response = await POST(
      new Request('https://app.example.test/api/imports', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test',
          cookie: session.cookie,
          'x-csrf-token': 'not-the-session-csrf'
        },
        body: importBody()
      })
    );
    expect(response.status).toBe(403);
    expect(enqueueImport).not.toHaveBeenCalled();
  });

  it('queues a valid authenticated import', async () => {
    const session = await issueSession();
    const response = await POST(
      new Request('https://app.example.test/api/imports', {
        method: 'POST',
        headers: {
          origin: 'https://app.example.test',
          host: 'app.example.test',
          cookie: session.cookie,
          'x-csrf-token': session.csrf
        },
        body: importBody()
      })
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      import_run_id: '7a985480-7a5d-4ef1-9648-2f443468e2fe'
    });
    expect(enqueueImport).toHaveBeenCalledOnce();
  });
});
