import { describe, expect, it, vi } from 'vitest';
import {
  createProviderRepository,
  type ProviderRow,
  type ProviderRuntimeStateRow
} from './provider-repository';


const baseSnapshot: ProviderRow = {
  id: 'provider-a',
  name: 'Provider A',
  kind: 'openai_http',
  adapter: null,
  billing_type: 'subscription',
  enabled: true,
  priority: 1,
  config: { executionIdentity: 'fp-a' },
  settings_revision: 4,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};


const runtimeRow: ProviderRuntimeStateRow = {
  provider_id: 'provider-a',
  state: 'authorization_required',
  available: false,
  reason: null,
  checked_at: null,
  ready_valid_until: null,
  retry_not_before: null,
  transient_failure_count: 0,
  auth_generation: 2,
  settings_revision: 4,
  execution_fingerprint: 'fp-a',
  security_profile_version: 'subscription-isolation-v1',
  readiness_policy_version: 'ready-lease-v1',
  credential_source_digest: null,
  binary_identity_digest: null,
  terms_digest: null,
  capability_attestation_id: null,
  containment_attestation_id: null,
  probe_generation: 7,
  current_probe_job_id: null,
  current_probe_requested_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};


function settingsClient(snapshot: ProviderRow = baseSnapshot) {
  const rpc = vi.fn(async (..._call: [string, object]) => {
    void _call;
    return {
      data: snapshot,
      error: null
    };
  });
  return {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: snapshot, error: null })
        })
      })
    })
  };
}

function runtimeClient(row = runtimeRow) {
  return {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        order: async () => ({ data: [row], error: null }),
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null })
        })
      })
    })
  };
}

const settingsInput = {
  provider: {
    id: 'provider-a',
    name: 'Provider A',
    kind: 'openai_http',
    billing_type: 'subscription'
  },
  secret: null,
  models: [],
  reconcileMode: 'none' as const
};

describe('provider settings repository', () => {
  // Break: the committed HTTP snapshot omits the nullable adapter column.
  it('maps null adapter from a committed HTTP provider snapshot', async () => {
    const repository = createProviderRepository(settingsClient() as never);
    await expect(repository.saveSettings(settingsInput)).resolves.toMatchObject({
      kind: 'openai_http',
      adapter: null
    });
  });

  // Break: the committed subscription snapshot is rewritten as another family.
  it.each(['codex', 'grok'] as const)(
    'maps %s adapter from a committed subscription provider snapshot',
    async (adapter) => {
      const snapshot = {
        ...baseSnapshot,
        kind: 'subscription_command',
        adapter,
        billing_type: 'subscription'
      };
      const repository = createProviderRepository(settingsClient(snapshot) as never);
      const saved = await repository.saveSettings(settingsInput);
      expect(saved.kind).toBe('subscription_command');
      expect(saved.adapter).toBe(adapter);
      expect(saved.billing_type).toBe('subscription');
    }
  );

  // Break: saveSettings turns an absent optimistic revision into explicit null.
  it('omits absent optional settings revision instead of passing null', async () => {
    const client = settingsClient();
    const repository = createProviderRepository(client as never);
    await repository.saveSettings(settingsInput);
    expect(client.rpc).toHaveBeenCalledWith(
      'save_ai_provider_settings',
      expect.not.objectContaining({ expected_revision: expect.anything() })
    );
    expect(client.rpc.mock.calls[0]?.[1]).not.toHaveProperty('expected_revision');
  });

  // Break: saveSettings discards the atomic RPC row and returns a later SELECT.
  it('returns the committed settings snapshot instead of a newer row', async () => {
    const repository = createProviderRepository(settingsClient() as never);
    const saved = await repository.saveSettings({
      ...settingsInput,
      expectedRevision: 3
    });
    expect(saved.settings_revision).toBe(4);
    expect(saved.name).toBe('Provider A');
  });

  // Break: the committed mapper invents an adapter or mutates the stored family.
  it('preserves an existing provider kind and adapter in the committed settings snapshot', async () => {
    const snapshot = {
      ...baseSnapshot,
      kind: 'subscription_command',
      adapter: 'grok',
      config: { family: 'grok', executionIdentity: 'fp-grok' }
    };
    const repository = createProviderRepository(settingsClient(snapshot) as never);
    await expect(repository.saveSettings(settingsInput)).resolves.toMatchObject(snapshot);
  });
});

describe('provider runtime state repository', () => {
  // Break: runtime reads coerce a valid non-zero probe generation to a default.
  it('maps runtime probe generation without coercion', async () => {
    const repository = createProviderRepository(runtimeClient() as never);
    const [listed, found] = await Promise.all([
      repository.listRuntimeStates(),
      repository.findRuntimeState('provider-a')
    ]);
    expect(listed[0]?.probe_generation).toBe(7);
    expect(found?.probe_generation).toBe(7);
  });

  // Break: malformed negative generations enter routing snapshots.
  it('fails closed on a negative runtime probe generation', async () => {
    const repository = createProviderRepository(
      runtimeClient({ ...runtimeRow, probe_generation: -1 }) as never
    );
    await expect(repository.listRuntimeStates()).rejects.toThrow(
      'Could not load provider runtime state.'
    );
  });
});
