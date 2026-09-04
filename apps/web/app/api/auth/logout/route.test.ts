import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  requireAdminMutation: vi.fn(),
  revokeAdminSession: vi.fn()
}));

vi.mock('../../../../lib/server/api-auth', () => ({
  requireAdminMutation: (...args: unknown[]) => fixtures.requireAdminMutation(...args)
}));

vi.mock('../../../../lib/server/admin-session-store', () => ({
  revokeAdminSession: (...args: unknown[]) => fixtures.revokeAdminSession(...args)
}));

import { POST } from './route';

describe('admin logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.requireAdminMutation.mockResolvedValue({
      sessionId: 'a'.repeat(32),
      csrfToken: 'csrf-token',
      expiresAtSeconds: 1_800_000_000
    });
    fixtures.revokeAdminSession.mockResolvedValue(undefined);
  });

  it('revokes the server-side session before clearing browser cookies', async () => {
    const response = await POST(new Request('https://app.example.test/api/auth/logout', {
      method: 'POST'
    }));

    expect(response.status).toBe(200);
    expect(fixtures.revokeAdminSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'a'.repeat(32)
    }));
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });
});
