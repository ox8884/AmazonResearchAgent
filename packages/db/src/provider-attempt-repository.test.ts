import { describe, expect, it, vi } from 'vitest';
import {
  createProviderAttemptRepository,
  type AnalysisLeaseIdentity,
  type JobLeaseIdentity
} from './provider-attempt-repository';

const jobLease: JobLeaseIdentity = {
  jobId: '00000000-0000-4000-8000-000000000001',
  owner: 'worker-a',
  epoch: 3
};
const analysisLease: AnalysisLeaseIdentity = {
  analysisId: '00000000-0000-4000-8000-000000000002',
  owner: 'analysis-worker-a',
  epoch: 4
};

function clientWith(data: unknown, error: unknown = null) {
  return { rpc: vi.fn(async (..._call: [string, object]) => {
    void _call;
    return { data, error };
  }) };
}

describe('provider attempt repository', () => {
  // Break: a stale same-owner job or analysis process can authorize provider consumption.
  it('passes both lease epochs to the pre-spawn transaction', async () => {
    const client = clientWith({
      attempt_id: '00000000-0000-4000-8000-000000000003',
      attempt_sequence: 1,
      provider_id: 'codex-subscription',
      model_id: 'gpt-5.6',
      adapter: 'codex',
      billing_type: 'subscription'
    });
    const repository = createProviderAttemptRepository(client as never);
    await repository.begin({
      jobLease,
      analysisLease,
      providerId: 'codex-subscription',
      modelId: 'gpt-5.6',
      expectedSettingsRevision: 2,
      expectedAuthGeneration: 1,
      expectedExecutionFingerprint: 'fp-v2',
      fallbackParentAttemptId: null
    });
    expect(client.rpc).toHaveBeenCalledWith('begin_ai_provider_attempt', expect.objectContaining({
      job_id: jobLease.jobId,
      job_lease_owner: jobLease.owner,
      job_lease_epoch: jobLease.epoch,
      analysis_id: analysisLease.analysisId,
      analysis_lease_owner: analysisLease.owner,
      analysis_lease_epoch: analysisLease.epoch
    }));
  });

  // Break: candidate-domain state can be supplied by the caller instead of derived from stored output.
  it('finalizes a candidate with identities only', async () => {
    const client = clientWith({ kind: 'committed', target_state: 'Reject' });
    const repository = createProviderAttemptRepository(client as never);
    await repository.finalizeCandidate({
      jobLease,
      analysisLease,
      candidateId: '00000000-0000-4000-8000-000000000004',
      expectedCandidateState: 'AI Screening',
      expectedNormalizationGeneration: 0
    });
    const args = client.rpc.mock.calls[0]?.[1];
    expect(client.rpc).toHaveBeenCalledWith('finalize_normalized_candidate', expect.any(Object));
    expect(args).not.toEqual(expect.objectContaining({
      output: expect.anything(),
      target_state: expect.anything(),
      reasons: expect.anything(),
      canonical_niche: expect.anything()
    }));
  });

  // Break: malformed authoritative JSON results are trusted by TypeScript callers.
  it('fails closed on an invalid authorization result', async () => {
    const repository = createProviderAttemptRepository(clientWith({ attempt_id: 'only-id' }) as never);
    await expect(repository.begin({
      jobLease,
      analysisLease,
      providerId: 'codex-subscription',
      modelId: 'gpt-5.6',
      expectedSettingsRevision: 2,
      expectedAuthGeneration: 1,
      expectedExecutionFingerprint: 'fp-v2',
      fallbackParentAttemptId: null
    })).rejects.toThrow('Could not begin provider attempt.');
  });
});
