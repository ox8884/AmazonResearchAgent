import { describe, expect, it, vi } from 'vitest';
import { createProviderRuntimeRepository } from './provider-runtime-repository';

const bindings = {
  providerId: 'codex-subscription',
  expectedSettingsRevision: 4,
  expectedAuthGeneration: 2,
  expectedExecutionFingerprint: 'fp-codex-v4'
} as const;

const jobLease = {
  jobId: '00000000-0000-4000-8000-000000000001',
  owner: 'worker-a',
  epoch: 3,
} as const;
const analysisLease = {
  analysisId: '00000000-0000-4000-8000-000000000002',
  owner: 'analysis-worker-a',
  epoch: 4,
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
      securityProfileDigest: '0'.repeat(64),
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

  // Break: the repository drops freshly observed evidence before the authoritative Ready CAS.
  it('forwards every fresh evidence digest to the Ready CAS', async () => {
    const client = clientWith({ ready: true });
    const repository = createProviderRuntimeRepository(client as never);
    await repository.commitProbe({
      ...bindings,
      modelId: 'gpt-5.6',
      expectedProbeGeneration: 8,
      securityProfileDigest: '0'.repeat(64),
      termsDigest: '1'.repeat(64),
      credentialSourceDigest: '2'.repeat(64),
      binaryIdentityDigest: '3'.repeat(64),
      capabilityDigest: '4'.repeat(64),
      framingDigest: '5'.repeat(64),
      boundedBehaviorDigest: '6'.repeat(64),
      containmentDigest: '7'.repeat(64)
    });
    expect(client.rpc).toHaveBeenCalledWith('commit_ai_provider_probe', {
      provider_id: bindings.providerId,
      model_id: 'gpt-5.6',
      expected_settings_revision: 4,
      expected_auth_generation: 2,
      expected_execution_fingerprint: 'fp-codex-v4',
      expected_probe_generation: 8,
      security_profile_digest: '0'.repeat(64),
      terms_digest: '1'.repeat(64),
      credential_source_digest: '2'.repeat(64),
      binary_identity_digest: '3'.repeat(64),
      capability_digest: '4'.repeat(64),
      framing_digest: '5'.repeat(64),
      bounded_behavior_digest: '6'.repeat(64),
      containment_digest: '7'.repeat(64)
    });
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
      attemptId: '00000000-0000-4000-8000-000000000003',
      jobLease,
      analysisLease,
      failureClass: 'capacity_exhausted',
      retryAfterSeconds: 47
    });
    expect(client.rpc).toHaveBeenCalledWith('apply_ai_provider_runtime_failure', {
      attempt_id: '00000000-0000-4000-8000-000000000003',
      job_id: jobLease.jobId,
      job_lease_owner: jobLease.owner,
      job_lease_epoch: jobLease.epoch,
      analysis_id: analysisLease.analysisId,
      analysis_lease_owner: analysisLease.owner,
      analysis_lease_epoch: analysisLease.epoch,
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
