import { describe, expect, it, vi } from 'vitest';
import { createProviderRuntimeRepository } from './provider-runtime-repository';

const bindings = {
  providerId: 'codex-subscription',
  expectedSettingsRevision: 4,
  expectedAuthGeneration: 2,
  expectedExecutionFingerprint: 'fp-codex-v4'
} as const;

function clientWith(
  data: unknown = {
    job_id: 'job-1',
    probe_generation: 1,
    mutated: true,
    allow_fallback: false,
    allow_replay: false
  },
  error: unknown = null
) {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe('provider runtime repository', () => {
  it('forwards strict CAS bindings when requesting a repeatable probe', async () => {
    const client = clientWith({ job_id: 'job-1', probe_generation: 8 });
    const repository = createProviderRuntimeRepository(client as never);
    await repository.requestProbe(bindings);
    expect(client.rpc).toHaveBeenCalledWith('request_ai_provider_probe', {
      provider_id: bindings.providerId,
      expected_settings_revision: 4,
      expected_auth_generation: 2,
      expected_execution_fingerprint: 'fp-codex-v4'
    });
  });

  it('commits acceptance evidence without an availability input', async () => {
    const client = clientWith({ capability_attestation_id: 'cap-1' });
    const repository = createProviderRuntimeRepository(client as never);
    await repository.commitAcceptanceProbe({
      ...bindings,
      modelId: 'gpt-5.6',
      adapter: 'codex',
      securityProfileVersion: 'isolation-v1',
      readinessPolicyVersion: 'lease-v1',
      termsDigest: 'terms-v1',
      credentialSourceDigest: 'credential-v1',
      binaryIdentityDigest: 'binary-v1',
      capabilityDigest: 'capability-v1',
      framingDigest: 'framing-v1',
      boundedBehaviorDigest: 'bounded-v1',
      containmentDigest: 'containment-v1',
      evidence: { verified: true }
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'commit_ai_provider_acceptance_probe',
      expect.not.objectContaining({ available: expect.anything(), state: expect.anything() })
    );
  });

  it.each([
    ['commitProbe', 'commit_ai_provider_probe'],
    ['activate', 'activate_subscription_provider'],
    ['deactivate', 'deactivate_subscription_provider'],
    ['fenceAuth', 'fence_ai_provider_auth'],
    ['expireReadyLease', 'expire_ai_provider_ready_lease']
  ] as const)('uses %s through its authoritative RPC', async (method, rpcName) => {
    const client = clientWith();
    const repository = createProviderRuntimeRepository(client as never);
    const input = method === 'commitProbe'
      ? { ...bindings, modelId: 'gpt-5.6', expectedProbeGeneration: 8 }
      : method === 'activate'
        ? { ...bindings, modelId: 'gpt-5.6', termsDigest: 'terms-v1' }
        : method === 'deactivate'
          ? { providerId: bindings.providerId }
          : bindings;
    await repository[method](input as never);
    expect(client.rpc).toHaveBeenCalledWith(rpcName, expect.any(Object));
  });

  it('passes canonical failure classification and retry delay unchanged', async () => {
    const client = clientWith({ mutated: true, allow_fallback: true, allow_replay: false });
    const repository = createProviderRuntimeRepository(client as never);
    await repository.applyFailure({
      ...bindings,
      modelId: 'gpt-5.6',
      failureClass: 'capacity_exhausted',
      retryAfterSeconds: 47
    });
    expect(client.rpc).toHaveBeenCalledWith('apply_ai_provider_runtime_failure', {
      provider_id: bindings.providerId,
      model_id: 'gpt-5.6',
      expected_settings_revision: 4,
      expected_auth_generation: 2,
      expected_execution_fingerprint: 'fp-codex-v4',
      failure_class: 'capacity_exhausted',
      retry_after_seconds: 47
    });
  });

  it('fails closed when an authoritative RPC returns no result', async () => {
    const repository = createProviderRuntimeRepository(clientWith(null) as never);
    await expect(repository.requestProbe(bindings)).rejects.toThrow(
      'Could not request provider readiness probe.'
    );
  });
});
