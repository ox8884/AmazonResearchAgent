import { describe, expect, it } from 'vitest';
import {
  createAdminSession,
  hashAdminPassword,
  verifyAdminPassword,
  verifyAdminSession
} from './admin-session';
import { verifyCsrfRequest } from './csrf';

describe('single-admin session', () => {
  it('verifies the configured scrypt password and rejects a different value', async () => {
    const verifier = await hashAdminPassword('correct horse battery staple', Buffer.alloc(16, 7));

    await expect(verifyAdminPassword('correct horse battery staple', verifier)).resolves.toBe(true);
    await expect(verifyAdminPassword('wrong password', verifier)).resolves.toBe(false);
  });

  it('signs an expiring session with a browser-visible bound CSRF token', () => {
    const key = Buffer.alloc(32, 3);
    const issued = createAdminSession(key, new Date('2026-08-27T00:00:00.000Z'), 3_600);

    expect(verifyAdminSession(issued.token, key, new Date('2026-08-27T00:59:59.000Z'))).toMatchObject({
      csrfToken: issued.csrfToken
    });
    expect(verifyAdminSession(issued.token, key, new Date('2026-08-27T01:00:01.000Z'))).toBeNull();
    expect(verifyAdminSession(`${issued.token}tampered`, key, new Date('2026-08-27T00:10:00.000Z'))).toBeNull();
  });

  it('requires matching Origin, Host, session CSRF, cookie CSRF, and header CSRF', () => {
    const key = Buffer.alloc(32, 4);
    const issued = createAdminSession(key, new Date('2026-08-27T00:00:00.000Z'), 3_600);
    const request = new Request('https://app.example.test/api/ai-providers', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.test',
        host: 'app.example.test',
        cookie: `ara_admin_session=${issued.token}; ara_csrf=${issued.csrfToken}`,
        'x-csrf-token': issued.csrfToken
      }
    });

    expect(
      verifyCsrfRequest(request, key, new Date('2026-08-27T00:10:00.000Z'))
    ).toMatchObject({ csrfToken: issued.csrfToken });
    expect(() =>
      verifyCsrfRequest(
        new Request(request, { headers: { ...Object.fromEntries(request.headers), origin: 'https://evil.example' } }),
        key,
        new Date('2026-08-27T00:10:00.000Z')
      )
    ).toThrow();
  });
});
