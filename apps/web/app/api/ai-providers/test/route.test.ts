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

  // Break: browser-supplied execution or activation fields survive request parsing.
  it('rejects implementation details instead of stripping them', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'provider-safe',
          executable: 'powershell.exe'
        })
      })
    );

    expect(response.status).toBe(400);
    expect(fixtures.enqueueJob).not.toHaveBeenCalled();
  });

  // Break: Test starts provider work in the web process instead of queueing DB-owned probe logic.
  it('enqueues only the saved provider identifier for worker-owned probe semantics', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'provider-safe' })
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
