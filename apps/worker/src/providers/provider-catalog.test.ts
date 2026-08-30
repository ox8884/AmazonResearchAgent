import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCatalog } from '@ara/ai-router';
import type {
  ModelRow,
  ProviderRow,
  ProviderRuntimeStateRow
} from '@ara/db';

const fixtures = vi.hoisted(() => {
  const providers: ProviderRow[] = [];
  const models: ModelRow[] = [];
  const runtimeStates: ProviderRuntimeStateRow[] = [];
  return { providers, models, runtimeStates, resolveCommandProfile: vi.fn() };
});

function fixtureProviderRepository() {
  return {
    listProviders: async () => fixtures.providers,
    listModels: async () => fixtures.models,
    listSecrets: async () => [],
    listRuntimeStates: async () => fixtures.runtimeStates
  };
}

vi.mock('@ara/db', () => ({
  createProviderRepository: () => ({
    listProviders: async () => fixtures.providers,
    listModels: async () => fixtures.models,
    listSecrets: async () => [],
    listRuntimeStates: async () => fixtures.runtimeStates
  }),
  fingerprintFromProviderConfig: () => 'fingerprint',
  secretCipherId: () => null
}));

vi.mock('./command-profiles', () => ({
  resolveApprovedCommandProfile: fixtures.resolveCommandProfile
}));

import {
  ProviderCatalogCache,
  resolvePersistedProviderCatalog
} from './provider-catalog';

const providerBase: ProviderRow = {
  id: 'provider-a',
  name: 'Provider A',
  kind: 'openai_http',
  adapter: null,
  billing_type: 'subscription',
  enabled: true,
  priority: 1,
  config: {},
  settings_revision: 1,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

const runtimeState: ProviderRuntimeStateRow = {
  provider_id: 'provider-a',
  state: 'ready',
  available: true,
  reason: null,
  checked_at: new Date(0).toISOString(),
  ready_valid_until: new Date(600_000).toISOString(),
  retry_not_before: null,
  transient_failure_count: 0,
  auth_generation: 2,
  settings_revision: 1,
  execution_fingerprint: 'fp-a',
  security_profile_version: 'subscription-isolation-v1',
  security_profile_digest: 'a'.repeat(64),
  readiness_policy_version: 'ready-lease-v1',
  credential_source_digest: 'credential-a',
  binary_identity_digest: 'binary-a',
  terms_digest: 'terms-a',
  capability_attestation_id: 'capability-a',
  containment_attestation_id: 'containment-a',
  probe_generation: 9,
  current_probe_job_id: null,
  current_probe_requested_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

beforeEach(() => {
  fixtures.providers = [];
  fixtures.runtimeStates = [];
  fixtures.models = [];
  fixtures.resolveCommandProfile.mockReset();
});


describe('provider catalog cache', () => {
  // Break: every job reloads providers, or a stale catalog is served after TTL/force refresh.
  it('reuses a catalog within TTL and reloads after expiry or force', async () => {
    let now = 1_000;
    let loads = 0;
    const empty: ProviderCatalog = { entries: [] };
    const cache = new ProviderCatalogCache(
      async () => {
        loads += 1;
        return empty;
      },
      60_000,
      () => now
    );

    await expect(cache.resolve()).resolves.toBe(empty);
    await expect(cache.resolve()).resolves.toBe(empty);
    expect(loads).toBe(1);

    now = 61_000;
    await cache.resolve();
    expect(loads).toBe(2);

    await cache.resolve(true);
    expect(loads).toBe(3);

    cache.invalidate();
    await cache.resolve();
    expect(loads).toBe(4);
  });
});

describe('provider catalog family dispatch', () => {
  // Break: a future provider kind falls through to the legacy CommandProvider branch.
  it('never sends an unknown kind through CommandProvider', async () => {
    fixtures.providers = [
      {
        ...providerBase,
        kind: 'future_provider',
        config: { commandProfileId: 'fake-command', modelId: 'future-model' }
      }
    ];
    await expect(resolvePersistedProviderCatalog(null, {
      providerRepository: fixtureProviderRepository()
    })).resolves.toEqual({
      entries: []
    });
    expect(fixtures.resolveCommandProfile).not.toHaveBeenCalled();
  });

  // Break: subscription_command is treated as legacy command despite Task 5 not existing.
  it('keeps subscription providers unavailable without constructing CommandProvider', async () => {
    fixtures.providers = [
      {
        ...providerBase,
        kind: 'subscription_command',
        adapter: 'codex',
        config: { commandProfileId: 'fake-command', modelId: 'codex-model' }
      }
    ];
    fixtures.runtimeStates = [runtimeState];
    await expect(resolvePersistedProviderCatalog(null, {
      providerRepository: fixtureProviderRepository()
    })).resolves.toEqual({
      entries: []
    });
    expect(fixtures.resolveCommandProfile).not.toHaveBeenCalled();
  });
});

  // Break: accepted subscription adapters route without current DB lease/attestations.
  it('includes only a DB-routable accepted subscription model', async () => {
    fixtures.providers = [{
      ...providerBase,
      kind: 'subscription_command',
      adapter: 'codex',
      config: { roles: ['niche_normalization'] }
    }];
    fixtures.models = [{
      id: 'model-row',
      provider_id: 'provider-a',
      model_id: 'gpt-5.6',
      display_name: 'GPT 5.6',
      capabilities: ['structured_json'],
      billing_type: 'subscription',
      quality_rank: 1,
      enabled: true,
      priority: 1,
      origin: 'manual',
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }];
    fixtures.runtimeStates = [{
      ...runtimeState,
      settings_revision: 1,
      execution_fingerprint: 'fp-a',
      credential_source_digest: 'credential',
      binary_identity_digest: 'binary',
      terms_digest: 'terms',
      capability_attestation_id: 'capability',
      containment_attestation_id: 'containment'
    }];
    const accepted = {
      id: 'codex-subscription-v1',
      billingType: 'subscription' as const,
      async health() {
        return { available: true, checkedAt: new Date(0).toISOString(), reason: null, retryAfterSeconds: null };
      },
      async listModels() { return []; },
      async runAuthorizedRaw() { throw new Error('not invoked'); }
    };
    const runtime = {
      isRoutable: vi.fn(async () => true),
      expireReadyLease: vi.fn(async () => null)
    };
    const catalog = await resolvePersistedProviderCatalog(null, {
      providerRepository: fixtureProviderRepository(),
      subscriptionAdapters: { codex: accepted },
      runtimeRepository: runtime
    });
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]?.provider.id).toBe('provider-a');
    expect(catalog.entries[0]?.models[0]?.providerId).toBe('provider-a');
    expect(runtime.isRoutable).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-a',
      modelId: 'gpt-5.6'
    }));
  });

  it('rejects missing host security identity before DB routing', async () => {
    fixtures.providers = [{ ...providerBase, kind: 'subscription_command', adapter: 'codex' }];
    fixtures.models = [{
      id: 'model-row', provider_id: 'provider-a', model_id: 'gpt-5.6', display_name: 'GPT 5.6',
      capabilities: ['structured_json'], billing_type: 'subscription', quality_rank: 1,
      enabled: true, priority: 1, origin: 'manual', created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }];
    fixtures.runtimeStates = [{ ...runtimeState, security_profile_digest: null }];
    const accepted = {
      id: 'codex', billingType: 'subscription' as const,
      async health() { return { available: true, checkedAt: '', reason: null, retryAfterSeconds: null }; },
      async listModels() { return []; },
      async runAuthorizedRaw() { throw new Error('not invoked'); }
    };
    const runtime = {
      isRoutable: vi.fn(async () => true),
      expireReadyLease: vi.fn(async () => null)
    };
    await expect(resolvePersistedProviderCatalog(null, {
      providerRepository: fixtureProviderRepository(),
      subscriptionAdapters: { codex: accepted },
      runtimeRepository: runtime
    })).resolves.toEqual({ entries: [] });
    expect(runtime.isRoutable).not.toHaveBeenCalled();
  });

  // Break: stale DB lease remains in catalog instead of requesting a new generation.
  it('omits unroutable subscriptions and asks DB to refresh expiry', async () => {
    fixtures.providers = [{ ...providerBase, kind: 'subscription_command', adapter: 'codex' }];
    fixtures.models = [{
      id: 'model-row', provider_id: 'provider-a', model_id: 'gpt-5.6', display_name: 'GPT 5.6',
      capabilities: ['structured_json'], billing_type: 'subscription', quality_rank: 1,
      enabled: true, priority: 1, origin: 'manual', created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString()
    }];
    fixtures.runtimeStates = [{
      ...runtimeState,
      credential_source_digest: 'credential', binary_identity_digest: 'binary', terms_digest: 'terms',
      capability_attestation_id: 'capability', containment_attestation_id: 'containment'
    }];
    const accepted = {
      id: 'codex', billingType: 'subscription' as const,
      async health() { return { available: true, checkedAt: '', reason: null, retryAfterSeconds: null }; },
      async listModels() { return []; },
      async runAuthorizedRaw() { throw new Error('not invoked'); }
    };
    const runtime = { isRoutable: vi.fn(async () => false), expireReadyLease: vi.fn(async () => null) };
    await expect(resolvePersistedProviderCatalog(null, {
      providerRepository: fixtureProviderRepository(),
      subscriptionAdapters: { codex: accepted },
      runtimeRepository: runtime
    })).resolves.toEqual({ entries: [] });
    expect(runtime.expireReadyLease).toHaveBeenCalledOnce();
  });
