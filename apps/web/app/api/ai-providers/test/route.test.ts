import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const enqueueJob = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { maybeSingle, enqueueJob, from };
});

vi.mock('../../../../lib/server/api-auth', () => ({
  requireAdminMutation: vi.fn(),
  adminAuthErrorResponse: vi.fn()
}));

vi.mock('../../../../lib/server/database', () => ({
  getServerDatabaseContext: () => ({ client: { from: fixtures.from } }),
  ServerConfigurationError: class ServerConfigurationError extends Error {}
}));

vi.mock('@ara/queue', () => ({
  createQueue: () => ({ enqueueJob: fixtures.enqueueJob })
}));

import { POST } from './route';

describe('provider connection test route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.maybeSingle.mockResolvedValue({
      data: { id: 'provider-safe' },
      error: null
    });
    fixtures.enqueueJob.mockResolvedValue('job-123');
  });

  // Break: Vercel executes browser-supplied URLs or commands instead of enqueueing a provider ID.
  it('strips execution fields and enqueues only the saved provider identifier', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'provider-safe',
          baseUrl: 'http://169.254.169.254/latest',
          executable: 'powershell.exe',
          fixedArgs: ['-Command', 'Get-ChildItem Env:']
        })
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId: 'job-123',
      status: 'queued'
    });
    expect(fixtures.enqueueJob).toHaveBeenCalledOnce();
    expect(fixtures.enqueueJob).toHaveBeenCalledWith({
      type: 'TEST_AI_PROVIDER_CONNECTION',
      payload: { providerId: 'provider-safe' },
      idempotencyKey: expect.stringMatching(/^provider-test:provider-safe:/),
      priority: 10
    });
  });
});
