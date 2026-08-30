import { describe, expect, it, vi } from 'vitest';
import type { AiProvider, ProviderCatalog } from '@ara/ai-router';
import type {
  AnalysisLeaseIdentity,
  JobLeaseIdentity,
  ProviderAttemptRepository,
  ProviderRuntimeRepository
} from '@ara/db';
import type { AiProviderResult } from '@ara/ai-router';
import type { KeywordNormalization } from '@ara/research-engine';
import { AdapterSemaphoreRegistry } from './adapter-semaphore';
import {
  NormalizationExecutionCoordinator,
  type NormalizationExecutionTarget
} from './normalization-execution-coordinator';

const jobLease: JobLeaseIdentity = {
  jobId: '00000000-0000-4000-8000-000000000001',
  owner: 'worker-a',
  epoch: 2
};
const analysisLease: AnalysisLeaseIdentity = {
  analysisId: '00000000-0000-4000-8000-000000000002',
  owner: 'analysis-worker-a',
  epoch: 3
};
const output: KeywordNormalization = {
  classification: 'product_niche',
  canonicalNiche: 'Batter Dispenser',
  canonicalEnglish: 'Batter Dispenser',
  catalogPhrases: ['pancake dispenser'],
  aliases: ['batter bottle'],
  productFit: 'strong',
  riskFlags: ['food_contact'],
  confidence: 0.91,
  reason: 'Distinct product niche.'
};
const usage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  requestCount: 1
};

function provider(id: string): AiProvider {
  return {
    id,
    billingType: 'subscription',
    async health() {
      return {
        available: true,
        checkedAt: new Date(0).toISOString(),
        reason: null,
        retryAfterSeconds: null
      };
    },
    async listModels() {
      return [];
    },
    async runStructured<T>(): Promise<AiProviderResult<T>> {
      throw new Error('Subscription execution must use the authorized target.');
    }
  };
}

function catalog(ids: readonly string[]): ProviderCatalog {
  return {
    entries: ids.map((id, priority) => ({
      provider: provider(id),
      enabled: true,
      priority,
      roles: ['niche_normalization'],
      health: {
        available: true,
        checkedAt: new Date(0).toISOString(),
        reason: null,
        retryAfterSeconds: null
      },
      models: [{
        providerId: id,
        id: `${id}-model`,
        displayName: `${id}-model`,
        capabilities: ['structured_json'],
        billingType: 'subscription',
        qualityRank: priority
      }]
    }))
  };
}

function request() {
  return {
    jobLease,
    analysisLease,
    candidateId: '00000000-0000-4000-8000-000000000003',
    expectedCandidateState: 'AI Screening',
    normalizationGeneration: 0,
    locale: 'ko' as const,
    prompt: 'normalize this keyword',
    inputHash: 'input-hash',
    catalog: catalog(['codex', 'grok']),
    signal: new AbortController().signal
  };
}

function attemptRepository(overrides: Partial<ProviderAttemptRepository> = {}): ProviderAttemptRepository {
  return {
    reconcile: vi.fn(async () => ({
      attemptedProviderIds: [],
      pendingWinnerAttemptId: null,
      fallbackParentAttemptId: null
    })),
    begin: vi.fn(async (input) => ({
      attemptId: input.providerId === 'codex'
        ? '00000000-0000-4000-8000-000000000101'
        : '00000000-0000-4000-8000-000000000102',
      attemptSequence: input.providerId === 'codex' ? 1 : 2,
      providerId: input.providerId,
      modelId: input.modelId,
      adapter: input.providerId,
      billingType: 'subscription'
    })),
    appendOutcome: vi.fn(async (input) => ({ eventType: input.eventType })),
    finalizeAnalysis: vi.fn(async () => ({ status: 'completed' as const, outputSha256: 'a'.repeat(64) })),
    finalizeCandidate: vi.fn(async () => ({
      kind: 'committed' as const,
      targetState: 'Ready for API Validation' as const,
      decisionId: '00000000-0000-4000-8000-000000000201',
      nicheClusterId: '00000000-0000-4000-8000-000000000202'
    })),
    claimCompletedFinalization: vi.fn(async () => ({ kind: 'claimed' as const, analysisLeaseEpoch: 4 })),
    deferCandidate: vi.fn(async () => ({
      kind: 'deferred' as const,
      targetState: 'Waiting for AI Capacity' as const
    })),
    ...overrides
  };
}

function runtimeRepository(): Pick<ProviderRuntimeRepository, 'applyFailure'> {
  return {
    applyFailure: vi.fn(async () => ({
      mutated: true,
      allow_fallback: true,
      allow_replay: false
    }))
  };
}

function target(
  providerId: 'codex' | 'grok',
  execute: NormalizationExecutionTarget['execute']
): NormalizationExecutionTarget {
  return {
    providerId,
    modelId: `${providerId}-model`,
    adapter: providerId,
    expectedSettingsRevision: 1,
    expectedAuthGeneration: 2,
    expectedExecutionFingerprint: `${providerId}-fingerprint`,
    execute
  };
}

describe('NormalizationExecutionCoordinator', () => {
  // Break: provider execution starts before durable begin or receives a locally generated UUID.
  it('commits durable authorization before passing the exact attempt UUID to execution', async () => {
    const events: string[] = [];
    const repository = attemptRepository({
      begin: vi.fn(async (input) => {
        events.push(`begin:${input.providerId}`);
        return {
          attemptId: '00000000-0000-4000-8000-000000000101',
          attemptSequence: 1,
          providerId: input.providerId,
          modelId: input.modelId,
          adapter: 'codex',
          billingType: 'subscription'
        };
      })
    });
    const execute = vi.fn(async (attemptId: string) => {
      events.push(`execute:${attemptId}`);
      return {
        output,
        providerId: 'codex',
        modelId: 'codex-model',
        role: 'niche_normalization' as const,
        inputHash: 'input-hash',
        usage,
        costClass: 'subscription' as const,
        startedAt: new Date(0).toISOString(),
        completedAt: new Date(1).toISOString()
      };
    });
    const coordinator = new NormalizationExecutionCoordinator({
      attempts: repository,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async () => target('codex', execute)
    });

    await expect(coordinator.execute(request())).resolves.toMatchObject({
      kind: 'finalized',
      targetState: 'Ready for API Validation'
    });
    expect(events).toEqual([
      'begin:codex',
      'execute:00000000-0000-4000-8000-000000000101'
    ]);
    expect(execute).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000101',
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  // Break: a recoverable Codex failure either retries Codex, selects PAYG, or skips runtime writeback before Grok.
  it('writes a recoverable failure before falling back once to a distinct provider', async () => {
    const calls: string[] = [];
    const attempts = attemptRepository({
      appendOutcome: vi.fn(async (input) => {
        calls.push(`outcome:${input.attemptId}`);
        return { eventType: input.eventType };
      }),
      reconcile: vi.fn()
        .mockResolvedValueOnce({ attemptedProviderIds: [], pendingWinnerAttemptId: null, fallbackParentAttemptId: null })
        .mockResolvedValueOnce({
          attemptedProviderIds: ['codex'],
          pendingWinnerAttemptId: null,
          fallbackParentAttemptId: '00000000-0000-4000-8000-000000000101'
        })
    });
    const runtime = runtimeRepository();
    vi.mocked(runtime.applyFailure).mockImplementation(async () => {
      calls.push('runtime');
      return { mutated: true, allow_fallback: true, allow_replay: false };
    });
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime,
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async (selection) => selection.providerId === 'codex'
        ? target('codex', async () => {
            throw Object.assign(new Error('capacity'), {
              failureClass: 'capacity_exhausted' as const
            });
          })
        : target('grok', async () => ({
            output,
            providerId: 'grok',
            modelId: 'grok-model',
            role: 'niche_normalization',
            inputHash: 'input-hash',
            usage,
            costClass: 'subscription',
            startedAt: new Date(0).toISOString(),
            completedAt: new Date(1).toISOString()
          }))
    });

    await expect(coordinator.execute(request())).resolves.toMatchObject({ kind: 'finalized' });
    expect(calls.slice(0, 2)).toEqual([
      'outcome:00000000-0000-4000-8000-000000000101',
      'runtime'
    ]);
    expect(attempts.begin).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerId: 'grok',
        fallbackParentAttemptId: '00000000-0000-4000-8000-000000000101'
      })
    );
  });

  // Break: a fresh coordinator loses the durable parent and sends a null parent after restart.
  it('resumes with the DB-derived parent and routes only the distinct unpaid fallback', async () => {
    const fallbackParentAttemptId = '00000000-0000-4000-8000-000000000101';
    const attempts = attemptRepository({
      reconcile: vi.fn(async () => ({
        attemptedProviderIds: ['codex'],
        pendingWinnerAttemptId: null,
        fallbackParentAttemptId
      }))
    });
    const resolveTarget = vi.fn(async () => target('grok', async () => ({
      output,
      providerId: 'grok',
      modelId: 'grok-model',
      role: 'niche_normalization' as const,
      inputHash: 'input-hash',
      usage,
      costClass: 'subscription' as const,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString()
    })));
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget
    });

    await expect(coordinator.execute(request())).resolves.toMatchObject({ kind: 'finalized' });
    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(resolveTarget).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'grok'
    }));
    expect(attempts.begin).toHaveBeenCalledOnce();
    expect(attempts.begin).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'grok',
      fallbackParentAttemptId
    }));
  });

  // Break: crash-unknown evidence starts a distinct provider with a null, DB-rejected parent.
  it('defers without routing when reconciliation has attempts but no eligible parent', async () => {
    const attempts = attemptRepository({
      reconcile: vi.fn(async () => ({
        attemptedProviderIds: ['codex'],
        pendingWinnerAttemptId: null,
        fallbackParentAttemptId: null
      }))
    });
    const resolveTarget = vi.fn();
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget
    });

    await expect(coordinator.execute(request())).resolves.toMatchObject({
      kind: 'deferred',
      targetState: 'Waiting for AI Capacity'
    });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(attempts.begin).not.toHaveBeenCalled();
    expect(attempts.deferCandidate).toHaveBeenCalledOnce();
  });

  // Break: reconciliation ignores a staged winner and consumes the provider again after a crash.
  it('finalizes a staged winner without executing another provider', async () => {
    const attempts = attemptRepository({
      reconcile: vi.fn(async () => ({
        attemptedProviderIds: ['codex'],
        pendingWinnerAttemptId: '00000000-0000-4000-8000-000000000101',
        fallbackParentAttemptId: null
      }))
    });
    const execute = vi.fn();
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async () => target('codex', execute)
    });

    await expect(coordinator.execute(request())).resolves.toMatchObject({ kind: 'finalized' });
    expect(execute).not.toHaveBeenCalled();
    expect(attempts.finalizeAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: '00000000-0000-4000-8000-000000000101'
    }));
    expect(attempts.finalizeCandidate).toHaveBeenCalledOnce();
  });
});
