import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const upsertProvider = vi.fn();
  const upsertSecret = vi.fn();
  const upsertModel = vi.fn();
  const findSecret = vi.fn();
  const listModels = vi.fn();
  return {
    upsertProvider,
    upsertSecret,
    upsertModel,
    findSecret,
    listModels
  };
});

vi.mock('../../../lib/server/api-auth', () => ({
  requireAdminMutation: vi.fn(),
  requireAdminRead: vi.fn(),
  adminAuthErrorResponse: vi.fn()
}));

vi.mock('../../../lib/server/database', () => ({
  getServerDatabaseContext: () => ({ client: {} }),
  ServerConfigurationError: class ServerConfigurationError extends Error {}
}));

vi.mock('@ara/db', () => ({
  createProviderRepository: () => fixtures,
  ProviderRepositoryError: class ProviderRepositoryError extends Error {}
}));

vi.mock('@ara/secret-store', () => ({
  encryptSecret: (plaintext: string) => ({
    ciphertext: 'cipher',
    iv: 'iv',
    authTag: 'tag',
    last4: plaintext.slice(-4)
  }),
  getEncryptionKeyFromEnvironment: () => Buffer.alloc(32, 3),
  SecretStoreError: class SecretStoreError extends Error {}
}));

import { POST } from './route';

describe('provider settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.upsertProvider.mockImplementation(async (input: { id: string }) => ({
      id: input.id,
      name: 'Safe provider',
      kind: 'command',
      billing_type: 'free',
      enabled: true,
      priority: 100,
      config: {},
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }));
    fixtures.findSecret.mockResolvedValue(null);
    fixtures.listModels.mockResolvedValue([]);
  });

  // Break: browser-supplied executable/args are persisted instead of a worker profile ID.
  it('stores command profile IDs and ignores executable fields', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Fake command',
          kind: 'command',
          billingType: 'free',
          executable: 'powershell.exe',
          fixedArgs: ['-Command', 'Get-ChildItem Env:'],
          commandProfileId: 'fake-command',
          modelId: 'fake-model',
          roles: ['niche_normalization'],
          enabled: true
        })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.upsertProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command',
        config: {
          commandProfileId: 'fake-command',
          modelId: 'fake-model',
          roles: ['niche_normalization']
        }
      })
    );
    expect(JSON.stringify(fixtures.upsertProvider.mock.calls)).not.toContain('powershell.exe');
    expect(fixtures.upsertSecret).not.toHaveBeenCalled();
  });

  // Break: a blank key overwrites the stored secret during edit.
  it('preserves an existing secret when the replacement key is blank', async () => {
    fixtures.upsertProvider.mockImplementation(async (input: { id: string }) => ({
      id: input.id,
      name: 'HTTP provider',
      kind: 'openai_http',
      billing_type: 'subscription',
      enabled: true,
      priority: 100,
      config: {},
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }));

    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'provider-existing',
          name: 'HTTP provider',
          kind: 'openai_http',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          apiKey: '   ',
          roles: []
        })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.upsertProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-existing',
        config: expect.objectContaining({
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          modelDiscovery: 'enabled'
        })
      })
    );
    expect(fixtures.upsertSecret).not.toHaveBeenCalled();
  });
});
