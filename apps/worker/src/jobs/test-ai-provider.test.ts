import { describe, expect, it, vi } from 'vitest';
import type { ProviderRow, ProviderRuntimeStateRow } from '@ara/db';
import { runProviderConnectionTest } from './test-ai-provider';

const provider: ProviderRow = {
  id: 'provider-a',
  name: 'Codex Subscription',
  kind: 'subscription_command',
  adapter: 'codex',
  billing_type: 'subscription',
  enabled: false,
  priority: 1,
  config: {},
  settings_revision: 4,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

const runtime: ProviderRuntimeStateRow = {
  provider_id: provider.id,
  state: 'authorization_required',
  available: false,
  reason: 'setup_required',
  checked_at: null,
  ready_valid_until: null,
  retry_not_before: null,
  transient_failure_count: 0,
  auth_generation: 2,
  settings_revision: 4,
  execution_fingerprint: 'fingerprint-a',
  security_profile_version: 'subscription-isolation-v1',
  security_profile_digest: null,
  readiness_policy_version: 'ready-lease-v1',
  credential_source_digest: null,
  binary_identity_digest: null,
  terms_digest: null,
  capability_attestation_id: null,
  containment_attestation_id: null,
  probe_generation: 8,
  current_probe_job_id: null,
  current_probe_requested_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

describe('subscription provider connection status', () => {
  // Break: Test logs in, accepts evidence, issues Ready, or executes the provider client.
  it('only requests a new DB-owned probe generation', async () => {
    const requestProbe = vi.fn(async () => ({ job_id: 'job-a', probe_generation: 9 }));
    const result = await runProviderConnectionTest(provider.id, null, {
      providerLookup: {
        findProvider: async () => provider,
        findRuntimeState: async () => runtime
      },
      requestSubscriptionProbe: requestProbe
    });
    expect(requestProbe).toHaveBeenCalledWith({
      providerId: provider.id,
      expectedSettingsRevision: 4,
      expectedAuthGeneration: 2,
      expectedExecutionFingerprint: 'fingerprint-a'
    });
    expect(result).toMatchObject({
      available: false,
      healthCategory: 'unavailable',
      errorCategory: 'provider_probe_requested',
      models: []
    });
  });

  // Break: Test guesses missing runtime bindings and constructs a probe/client anyway.
  it('returns setup required without requesting when bindings are absent', async () => {
    const requestProbe = vi.fn();
    const result = await runProviderConnectionTest(provider.id, null, {
      providerLookup: {
        findProvider: async () => provider,
        findRuntimeState: async () => null
      },
      requestSubscriptionProbe: requestProbe
    });
    expect(requestProbe).not.toHaveBeenCalled();
    expect(result.errorCategory).toBe('provider_setup_required');
  });
});
