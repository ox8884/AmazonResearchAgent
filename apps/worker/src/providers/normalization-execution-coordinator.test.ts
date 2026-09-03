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

  it('routes the configured pay-as-you-go provider for normalization', async () => {
    const paygCatalog: ProviderCatalog = {
      entries: [{
        provider: {
          id: 'custom-openai',
          billingType: 'payg',
          health: async () => ({
            available: true,
            checkedAt: new Date(0).toISOString(),
            reason: null,
            retryAfterSeconds: null
          }),
          listModels: async () => [],
          runStructured: async () => {
            throw new Error('Target execution is required.');
          }
        },
        enabled: true,
        paidPrimary: true,
        priority: 0,
        roles: ['niche_normalization'],
        health: {
          available: true,
          checkedAt: new Date(0).toISOString(),
          reason: null,
          retryAfterSeconds: null
        },
        models: [{
          providerId: 'custom-openai',
          id: 'custom-model',
          displayName: 'custom-model',
          capabilities: ['structured_json'],
          billingType: 'payg',
          qualityRank: 0
        }]
      }]
    };
    const attempts = attemptRepository();
    const resolveTarget = vi.fn(async () => ({
      providerId: 'custom-openai',
      modelId: 'custom-model',
      adapter: null,
      expectedSettingsRevision: 1,
      expectedAuthGeneration: 1,
      expectedExecutionFingerprint: 'custom-fingerprint',
      execute: async () => ({
        output,
        providerId: 'custom-openai',
        modelId: 'custom-model',
        role: 'niche_normalization' as const,
        inputHash: 'input-hash',
        usage,
        costClass: 'payg' as const,
        startedAt: new Date(0).toISOString(),
        completedAt: new Date(1).toISOString()
      })
    }));
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget
    });

    await expect(coordinator.execute({ ...request(), catalog: paygCatalog })).resolves.toMatchObject({
      kind: 'finalized'
    });
    expect(resolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'custom-openai',
        model: expect.objectContaining({ billingType: 'payg' })
      }),
      { initialPaidPrimary: true }
    );
    expect(attempts.begin).toHaveBeenCalledWith(expect.objectContaining({
      initialPaidPrimary: true
    }));
  });

  // Break: a failed Z.ai primary becomes a PAYG retry or permits generic PAYG fallback.
  it('does not carry initial PAYG authority past the first attempted provider', async () => {
    const paygCatalog: ProviderCatalog = {
      entries: [
        {
          provider: {
            id: 'zai-primary',
            billingType: 'payg',
            health: async () => ({
              available: true,
              checkedAt: new Date(0).toISOString(),
              reason: null,
              retryAfterSeconds: null
            }),
            listModels: async () => [],
            runStructured: async () => {
              throw new Error('Target execution is required.');
            }
          },
          enabled: true,
          paidPrimary: true,
          priority: 0,
          roles: ['niche_normalization'],
          health: {
            available: true,
            checkedAt: new Date(0).toISOString(),
            reason: null,
            retryAfterSeconds: null
          },
          models: [{
            providerId: 'zai-primary',
            id: 'z-ai/glm-5.3-flash',
            displayName: 'z-ai/glm-5.3-flash',
            capabilities: ['structured_json'],
            billingType: 'payg',
            qualityRank: 0
          }]
        },
        ...catalog(['codex']).entries
      ]
    };
    const authorizations: Array<{
      readonly providerId: string;
      readonly initialPaidPrimary: boolean;
    }> = [];
    let zaiExecutions = 0;
    const coordinator = new NormalizationExecutionCoordinator({
      attempts: attemptRepository(),
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      async resolveTarget(selection, authorization) {
        authorizations.push({
          providerId: selection.providerId,
          initialPaidPrimary: authorization.initialPaidPrimary
        });
        if (selection.providerId === 'zai-primary') {
          return {
            providerId: 'zai-primary',
            modelId: 'z-ai/glm-5.3-flash',
            adapter: null,
            expectedSettingsRevision: 1,
            expectedAuthGeneration: 0,
            expectedExecutionFingerprint: 'zai-fingerprint',
            async execute() {
              if (zaiExecutions++ === 0) {
                throw Object.assign(new Error('spawn rejected'), {
                  failureClass: 'process_spawn_failure_pre_consumption' as const
                });
              }
              return {
                output,
                providerId: 'zai-primary',
                modelId: 'z-ai/glm-5.3-flash',
                role: 'niche_normalization' as const,
                inputHash: 'input-hash',
                usage,
                costClass: 'payg' as const,
                startedAt: new Date(0).toISOString(),
                completedAt: new Date(1).toISOString()
              };
            }
          };
        }
        return target('codex', async () => ({
          output,
          providerId: 'codex',
          modelId: 'codex-model',
          role: 'niche_normalization',
          inputHash: 'input-hash',
          usage,
          costClass: 'subscription',
          startedAt: new Date(0).toISOString(),
          completedAt: new Date(1).toISOString()
        }));
      }
    });

    await expect(coordinator.execute({ ...request(), catalog: paygCatalog })).resolves.toMatchObject({
      kind: 'finalized'
    });
    expect(authorizations).toEqual([
      { providerId: 'zai-primary', initialPaidPrimary: true },
      { providerId: 'codex', initialPaidPrimary: false }
    ]);
  });

  // Break: a restarted pre-spawn failure is treated as a new initial PAYG route.
  it('does not restore initial PAYG authority after a durable pre-spawn failure', async () => {
    const durableParentAttemptId = '00000000-0000-4000-8000-000000000101';
    const paygCatalog: ProviderCatalog = {
      entries: [
        {
          provider: {
            id: 'zai-primary',
            billingType: 'payg',
            health: async () => ({
              available: true,
              checkedAt: new Date(0).toISOString(),
              reason: null,
              retryAfterSeconds: null
            }),
            listModels: async () => [],
            runStructured: async () => {
              throw new Error('Target execution is required.');
            }
          },
          enabled: true,
          paidPrimary: true,
          priority: 0,
          roles: ['niche_normalization'],
          health: {
            available: true,
            checkedAt: new Date(0).toISOString(),
            reason: null,
            retryAfterSeconds: null
          },
          models: [{
            providerId: 'zai-primary',
            id: 'z-ai/glm-5.3-flash',
            displayName: 'z-ai/glm-5.3-flash',
            capabilities: ['structured_json'],
            billingType: 'payg',
            qualityRank: 0
          }]
        },
        ...catalog(['codex']).entries
      ]
    };
    const attempts = attemptRepository({
      reconcile: vi.fn(async () => ({
        attemptedProviderIds: [],
        pendingWinnerAttemptId: null,
        fallbackParentAttemptId: durableParentAttemptId
      }))
    });
    const resolveTarget = vi.fn(async (selection) => {
      if (selection.providerId === 'zai-primary') {
        return {
          providerId: 'zai-primary',
          modelId: 'z-ai/glm-5.3-flash',
          adapter: null,
          expectedSettingsRevision: 1,
          expectedAuthGeneration: 0,
          expectedExecutionFingerprint: 'zai-fingerprint',
          async execute() {
            return {
              output,
              providerId: 'zai-primary',
              modelId: 'z-ai/glm-5.3-flash',
              role: 'niche_normalization' as const,
              inputHash: 'input-hash',
              usage,
              costClass: 'payg' as const,
              startedAt: new Date(0).toISOString(),
              completedAt: new Date(1).toISOString()
            };
          }
        };
      }
      return target('codex', async () => ({
        output,
        providerId: 'codex',
        modelId: 'codex-model',
        role: 'niche_normalization',
        inputHash: 'input-hash',
        usage,
        costClass: 'subscription',
        startedAt: new Date(0).toISOString(),
        completedAt: new Date(1).toISOString()
      }));
    });
    const coordinator = new NormalizationExecutionCoordinator({
      attempts,
      runtime: runtimeRepository(),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget
    });

    await expect(coordinator.execute({ ...request(), catalog: paygCatalog })).resolves.toMatchObject({
      kind: 'finalized'
    });
    expect(resolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'codex' }),
      { initialPaidPrimary: false }
    );
    expect(attempts.begin).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'codex',
      fallbackParentAttemptId: durableParentAttemptId
    }));
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
    expect(resolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'grok' }),
      { initialPaidPrimary: false }
    );
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
