import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCatalog } from '@ara/ai-router';
import type { ProviderRow, ProviderRuntimeStateRow } from '@ara/db';

const fixtures = vi.hoisted(() => ({
  providers: [] as ProviderRow[],
  runtimeStates: [] as ProviderRuntimeStateRow[],
  resolveCommandProfile: vi.fn()
}));

vi.mock('@ara/db', () => ({
  createProviderRepository: () => ({
    listProviders: async () => fixtures.providers,
    listModels: async () => [],
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
    await expect(resolvePersistedProviderCatalog({} as never)).resolves.toEqual({
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
    await expect(resolvePersistedProviderCatalog({} as never)).resolves.toEqual({
      entries: []
    });
    expect(fixtures.resolveCommandProfile).not.toHaveBeenCalled();
  });
});
