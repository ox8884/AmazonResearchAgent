import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const saveSettings = vi.fn();
  const upsertProvider = vi.fn();
  const upsertModel = vi.fn();
  const findSecret = vi.fn();
  const findProvider = vi.fn();
  const findRuntimeState = vi.fn();
  const listProviders = vi.fn();
  const listModels = vi.fn();
  const listSecrets = vi.fn();
  const listRuntimeStates = vi.fn();
  const deactivate = vi.fn();
  return {
    saveSettings,
    upsertProvider,
    upsertModel,
    findSecret,
    findProvider,
    findRuntimeState,
    listProviders,
    listModels,
    listSecrets,
    listRuntimeStates,
    deactivate
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
  createProviderRuntimeRepository: () => ({ deactivate: fixtures.deactivate }),
  ProviderRepositoryError: class ProviderRepositoryError extends Error {},
  ProviderRuntimeRepositoryError: class ProviderRuntimeRepositoryError extends Error {},
  fingerprintFromProviderConfig: () => 'fingerprint',
  secretCipherId: () => 'cipher-id'
}));


vi.mock('@ara/secret-store', () => ({
  encryptSecret: (plaintext: string) => ({
    ciphertext: 'cipher',
    iv: 'iv',
    authTag: 'tag',
    last4: plaintext.slice(-4)
  }),
  decryptSecret: () => 'stored-secret-value',
  getEncryptionKeyFromEnvironment: () => Buffer.alloc(32, 3),
  SecretStoreError: class SecretStoreError extends Error {}
}));

import { GET, POST } from './route';
import { ProviderRepositoryError } from '@ara/db';


describe('provider settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.saveSettings.mockImplementation(async (input: { provider: { id: string } }) => ({
      id: input.provider.id,
      name: 'Safe provider',
      kind: 'command',
      adapter: null,
      billing_type: 'free',
      enabled: true,
      priority: 100,
      config: {},
      settings_revision: 1,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }));
    fixtures.upsertProvider.mockImplementation(async (provider) => ({
      ...provider,
      settings_revision: 1,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }));
    fixtures.upsertModel.mockImplementation(async (model) => model);
    fixtures.findSecret.mockResolvedValue(null);
    fixtures.findProvider.mockResolvedValue(null);
    fixtures.findRuntimeState.mockResolvedValue(null);
    fixtures.listProviders.mockResolvedValue([]);
    fixtures.listModels.mockResolvedValue([]);
    fixtures.listSecrets.mockResolvedValue([]);
    fixtures.listRuntimeStates.mockResolvedValue([]);
    fixtures.deactivate.mockResolvedValue({ state: 'authorization_required' });
  });

  // Break: the removed raw command product can still reach browser mutation.
  it('rejects legacy command-provider browser input', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'command',
          executable: 'powershell.exe',
          commandProfileId: 'fake-command'
        })
      })
    );

    expect(response.status).toBe(400);
    expect(fixtures.saveSettings).not.toHaveBeenCalled();
  });

  // Break: a blank key overwrites the stored secret during edit.
  it('preserves an existing secret when the replacement key is blank', async () => {
    fixtures.saveSettings.mockImplementation(async (input: { provider: { id: string } }) => ({
      id: input.provider.id,
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
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          apiKey: '   ',
          roles: []
        })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          id: 'provider-existing',
          config: expect.objectContaining({
            baseUrl: 'https://provider.example/v1',
            networkScope: 'public',
            modelDiscovery: 'enabled'
          })
        }),
        secret: null
      })
    );
  });

  // Break: model status is saved in a second transaction after config/secret commit.
  it('persists config, secret, and model status in one saveSettings call', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          apiKey: 'replacement-secret-value',
          modelDiscovery: 'enabled',
          models: [{ modelId: 'kept-model', enabled: false, priority: 3 }],
          roles: ['niche_normalization'],
          enabled: true
        })
      })
    );
    expect(response.status).toBe(201);
    expect(fixtures.saveSettings).toHaveBeenCalledTimes(1);
    expect(fixtures.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: expect.objectContaining({ last4: 'alue' }),
        modelStatus: [{ modelId: 'kept-model', enabled: false, priority: 3 }]
      })
    );
  });


  it('rejects a model ID equal to the stored secret on blank-key edit', async () => {
    fixtures.findSecret.mockResolvedValue({
      provider_id: 'provider-existing',
      ciphertext: 'cipher',
      iv: 'iv',
      auth_tag: 'tag',
      last4: 'alue'
    });
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          apiKey: '',
          modelId: 'stored-secret-value',
          roles: []
        })
      })
    );
    expect(response.status).toBe(400);
    expect(fixtures.saveSettings).not.toHaveBeenCalled();
  });


  it('does not switch a discovery provider to manual when only model status is saved', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          modelDiscovery: 'enabled',
          models: [{ modelId: 'discovered-model', enabled: false, priority: 4 }],
          roles: ['niche_normalization']
        })
      })
    );
    expect(response.status).toBe(201);
    expect(fixtures.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          config: expect.objectContaining({
            modelDiscovery: 'enabled'
          })
        }),
        reconcileMode: 'none',
        modelStatus: [{ modelId: 'discovered-model', enabled: false, priority: 4 }]
      })
    );
    expect(fixtures.saveSettings.mock.calls[0]?.[0]?.provider.config.manualModelId).toBeUndefined();
  });

  it('enables a newly entered manual model when the checkbox is omitted', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          modelId: 'new-manual-model',
          modelDiscovery: 'disabled',
          roles: []
        })
      })
    );
    expect(response.status).toBe(201);
    expect(fixtures.saveSettings.mock.calls[0]?.[0]?.models[0]).toEqual(
      expect.objectContaining({
        model_id: 'new-manual-model',
        enabled: true,
        priority: 100
      })
    );
  });

  // Break: a stale settings form silently overwrites a newer provider revision.
  it('returns 409 when the submitted settings revision is stale', async () => {
    const error = new ProviderRepositoryError('save provider settings atomically');
    Object.assign(error, { cause: new Error('settings_revision_conflict') });
    fixtures.saveSettings.mockRejectedValue(error);

    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'openai_compatible_api',
          id: 'provider-existing',
          name: 'HTTP provider',
          billingType: 'subscription',
          baseUrl: 'https://provider.example/v1',
          networkScope: 'public',
          modelDiscovery: 'enabled',
          settingsRevision: 1,
          models: [{ modelId: 'gone-model', enabled: true, priority: 1 }],
          roles: []
        })
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'settings_conflict' });
  });

  // Break: a product choice can persist browser-controlled execution identity or secrets.
  it('maps Codex product choice to one fixed disabled subscription provider', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          product: 'codex_subscription',
          priority: 20
        })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.upsertProvider).toHaveBeenCalledWith({
      id: 'codex-subscription-v1',
      name: 'OpenAI Codex Subscription',
      kind: 'subscription_command',
      adapter: 'codex',
      billing_type: 'subscription',
      enabled: false,
      priority: 20,
      config: { roles: ['niche_normalization'] }
    });
    expect(fixtures.upsertModel).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: 'codex-subscription-v1',
      model_id: 'gpt-5.6',
      billing_type: 'subscription',
      enabled: false
    }));
    expect(fixtures.saveSettings).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.provider).toMatchObject({
      id: 'codex-subscription-v1',
      product: 'codex_subscription',
      productLabel: 'OpenAI Codex Subscription',
      billingType: 'subscription',
      enabled: false,
      role: 'niche_normalization',
      setupStatus: 'setup_required'
    });
    expect(JSON.stringify(body)).not.toMatch(
      /subscription_command|commandProfile|authHome|systemd|executionFingerprint|apiKey|secretLast4/u
    );
  });

  // Break: Zod strips injected implementation fields and persists the remaining request.
  it.each([
    ['command', '/bin/sh'],
    ['args', ['--unsafe']],
    ['endpoint', 'https://evil.example'],
    ['apiKey', 'secret'],
    ['modelId', 'browser-model'],
    ['authHome', '/tmp/auth'],
    ['enabled', true],
    ['available', true],
    ['ready', true],
    ['accepted', true]
  ])('rejects subscription implementation injection through %s', async (field, value) => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product: 'grok_subscription', [field]: value })
      })
    );

    expect(response.status).toBe(400);
    expect(fixtures.upsertProvider).not.toHaveBeenCalled();
    expect(fixtures.upsertModel).not.toHaveBeenCalled();
  });

  // Break: changing product on an existing ID converts a provider family.
  it('rejects product updates that change the persisted provider family', async () => {
    fixtures.findProvider.mockResolvedValue({
      id: 'codex-subscription-v1',
      name: 'OpenAI Codex Subscription',
      kind: 'subscription_command',
      adapter: 'grok',
      billing_type: 'subscription',
      enabled: false,
      priority: 100,
      config: {},
      settings_revision: 1,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    });
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product: 'codex_subscription' })
      })
    );

    expect(response.status).toBe(409);
    expect(fixtures.upsertProvider).not.toHaveBeenCalled();
  });

  // Break: editing subscription priority preserves a revision that still validates old runtime evidence.
  it('updates an existing subscription through revision-fenced atomic settings', async () => {
    fixtures.findProvider.mockResolvedValue({
      id: 'codex-subscription-v1',
      name: 'OpenAI Codex Subscription',
      kind: 'subscription_command',
      adapter: 'codex',
      billing_type: 'subscription',
      enabled: false,
      priority: 100,
      config: { roles: ['niche_normalization'] },
      settings_revision: 4,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    });
    fixtures.saveSettings.mockResolvedValue({
      id: 'codex-subscription-v1',
      name: 'OpenAI Codex Subscription',
      kind: 'subscription_command',
      adapter: 'codex',
      billing_type: 'subscription',
      enabled: false,
      priority: 5,
      config: { roles: ['niche_normalization'] },
      settings_revision: 5,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    });

    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product: 'codex_subscription', priority: 5 })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      secret: null,
      reconcileMode: 'manual',
      expectedRevision: 4,
      provider: expect.objectContaining({
        kind: 'subscription_command',
        adapter: 'codex',
        enabled: false,
        priority: 5
      }),
      models: [expect.objectContaining({ model_id: 'gpt-5.6', enabled: false })]
    }));
    expect(fixtures.upsertProvider).not.toHaveBeenCalled();
  });

  // Break: repeated product creation produces a second authoritative row.
  it('converges duplicate subscription product creation on the canonical row', async () => {
    for (let request = 0; request < 2; request += 1) {
      const response = await POST(
        new Request('https://app.example.test/api/ai-providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ product: 'codex_subscription' })
        })
      );
      expect(response.status).toBe(201);
    }
    expect(fixtures.upsertProvider).toHaveBeenCalledTimes(2);
    expect(fixtures.upsertProvider.mock.calls.map(([provider]) => provider.id)).toEqual([
      'codex-subscription-v1',
      'codex-subscription-v1'
    ]);
  });

  // Break: Disable edits flags directly instead of using the fenced authority.
  it('disables a subscription provider through fenced deactivation', async () => {
    fixtures.findProvider.mockResolvedValue({
      id: 'codex-subscription-v1',
      kind: 'subscription_command',
      adapter: 'codex'
    });
    fixtures.findRuntimeState.mockResolvedValue({ provider_id: 'codex-subscription-v1' });
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'disable', providerId: 'codex-subscription-v1' })
      })
    );

    expect(response.status).toBe(200);
    expect(fixtures.deactivate).toHaveBeenCalledWith({ providerId: 'codex-subscription-v1' });
    expect(fixtures.upsertProvider).not.toHaveBeenCalled();
  });

  // Break: a disabled setup row with no authority binding makes Disable fail or invent runtime state.
  it('treats disabled subscription setup without runtime state as idempotently disabled', async () => {
    fixtures.findProvider.mockResolvedValue({
      id: 'grok-subscription-v1',
      kind: 'subscription_command',
      adapter: 'grok',
      enabled: false
    });
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'disable', providerId: 'grok-subscription-v1' })
      })
    );

    expect(response.status).toBe(200);
    expect(fixtures.deactivate).not.toHaveBeenCalled();
  });

  // Break: Grok setup invents an unaccepted model identity.
  it('creates Grok as setup required without an unaccepted model row', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/ai-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ product: 'grok_subscription' })
      })
    );

    expect(response.status).toBe(201);
    expect(fixtures.upsertProvider).toHaveBeenCalledWith(expect.objectContaining({
      id: 'grok-subscription-v1',
      adapter: 'grok',
      enabled: false
    }));
    expect(fixtures.upsertModel).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      provider: {
        product: 'grok_subscription',
        modelLabel: 'Setup required',
        setupStatus: 'setup_required'
      }
    });
  });

  // Break: GET exposes raw provider families, adapters, runtime bindings, or unsanitized reasons.
  it('projects authoritative subscription state into a sanitized product response', async () => {
    fixtures.listProviders.mockResolvedValue([{
      id: 'codex-subscription-v1',
      name: 'internal-name',
      kind: 'subscription_command',
      adapter: 'codex',
      billing_type: 'subscription',
      enabled: true,
      priority: 7,
      config: { roles: ['niche_normalization'] },
      settings_revision: 4,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }]);
    fixtures.listRuntimeStates.mockResolvedValue([{
      provider_id: 'codex-subscription-v1',
      state: 'needs_attention',
      available: false,
      reason: 'credential_source_digest_mismatch:/private/path',
      checked_at: '2026-08-30T00:00:00.000Z',
      ready_valid_until: null,
      retry_not_before: null
    }]);

    const response = await GET(new Request('https://app.example.test/api/ai-providers'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      providers: [{
        id: 'codex-subscription-v1',
        product: 'codex_subscription',
        productLabel: 'OpenAI Codex Subscription',
        name: 'OpenAI Codex Subscription',
        billingType: 'subscription',
        enabled: true,
        priority: 7,
        role: 'niche_normalization',
        modelLabel: 'GPT-5.6',
        setupStatus: 'needs_attention',
        statusReason: null,
        lastCheckedAt: '2026-08-30T00:00:00.000Z',
        settingsRevision: 4
      }]
    });
    expect(JSON.stringify(body)).not.toMatch(
      /subscription_command|credential_source|private\/path|execution_fingerprint|auth_generation/u
    );
  });
});



