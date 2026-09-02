import {
  InvalidStructuredOutputError,
  routeAiRequest,
  type AiProviderResult,
  type ProviderCatalog,
  type RouteSelection,
  type StructuredAiRequest
} from '@ara/ai-router';
import type {
  AnalysisLeaseIdentity,
  JobLeaseIdentity,
  Json,
  ProviderAttemptRepository,
  ProviderRuntimeRepository
} from '@ara/db';
import {
  KeywordNormalizationSchema,
  type KeywordNormalization
} from '@ara/research-engine';
import {
  AiRequestSchema,
  SubscriptionFailureClassSchema,
  type Locale,
  type SubscriptionAdapter,
  type SubscriptionFailureClass
} from '@ara/shared';
import type { AdapterSemaphoreRegistry } from './adapter-semaphore';

const FALLBACK_FAILURES = new Set<SubscriptionFailureClass>([
  'auth_expired',
  'capacity_exhausted',
  'rate_limited',
  'transient_network',
  'client_transient',
  'timeout'
]);


export interface NormalizationExecutionTarget {
  readonly providerId: string;
  readonly modelId: string;
  readonly adapter: SubscriptionAdapter | null;
  readonly expectedSettingsRevision: number;
  readonly expectedAuthGeneration: number;
  readonly expectedExecutionFingerprint: string;
  execute(
    attemptId: string,
    request: StructuredAiRequest<KeywordNormalization>,
    signal: AbortSignal
  ): Promise<AiProviderResult<KeywordNormalization>>;
}

export interface NormalizationTargetAuthorization {
  readonly initialPaidPrimary: boolean;
}

export interface NormalizationExecutionRequest {
  readonly jobLease: JobLeaseIdentity;
  readonly analysisLease: AnalysisLeaseIdentity;
  readonly candidateId: string;
  readonly expectedCandidateState: string;
  readonly normalizationGeneration: number;
  readonly locale: Locale;
  readonly prompt: string;
  readonly inputHash: string;
  readonly catalog: ProviderCatalog;
  readonly signal: AbortSignal;
}

export type NormalizationExecutionResult =
  | {
      readonly kind: 'finalized';
      readonly targetState: 'Reject' | 'Needs Review' | 'Ready for API Validation';
    }
  | {
      readonly kind: 'deferred';
      readonly targetState: 'Waiting for AI Capacity';
    };

export interface NormalizationExecutionCoordinatorDependencies {
  readonly attempts: ProviderAttemptRepository;
  readonly runtime: Pick<ProviderRuntimeRepository, 'applyFailure'>;
  readonly semaphores: AdapterSemaphoreRegistry;
  resolveTarget(
    selection: RouteSelection,
    authorization: NormalizationTargetAuthorization
  ): Promise<NormalizationExecutionTarget>;
}

export interface CompletedNormalizationFinalizationRequest {
  readonly jobLease: JobLeaseIdentity;
  readonly analysisId: string;
  readonly analysisLeaseOwner: string;
  readonly leaseSeconds: number;
  readonly candidateId: string;
  readonly expectedCandidateState: string;
  readonly normalizationGeneration: number;
}

function toJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error('Provider result is not JSON serializable.');
  }
  return JSON.parse(serialized) as Json;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Normalization cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function failureClass(error: unknown): SubscriptionFailureClass {
  if (error instanceof InvalidStructuredOutputError) return 'schema_invalid_output';
  if (
    error instanceof Error &&
    'failureClass' in error &&
    typeof error.failureClass === 'string'
  ) {
    const parsed = SubscriptionFailureClassSchema.safeParse(error.failureClass);
    if (parsed.success) return parsed.data;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'cancelled_by_caller';
  }
  return 'unsafe_unknown';
}

function outcomeFor(error: unknown): {
  readonly failureClass: SubscriptionFailureClass;
  readonly eventType: 'attempt_failed' | 'attempt_cancelled' | 'attempt_not_consumed';
  readonly consumptionStatus: 'consumed' | 'not_consumed' | 'unknown';
  readonly resultClass: string;
  readonly proofCategory: string | null;
} {
  const classified = failureClass(error);
  if (classified === 'process_spawn_failure_pre_consumption') {
    return {
      failureClass: classified,
      eventType: 'attempt_not_consumed',
      consumptionStatus: 'not_consumed',
      resultClass: 'pre_spawn_failure',
      proofCategory: 'sandbox_not_started'
    };
  }
  if (
    classified === 'cancelled_by_caller' ||
    classified === 'cancelled_by_job_lease_loss' ||
    classified === 'cancelled_by_shutdown'
  ) {
    return {
      failureClass: classified,
      eventType: 'attempt_cancelled',
      consumptionStatus: 'unknown',
      resultClass: classified,
      proofCategory: null
    };
  }
  return {
    failureClass: classified,
    eventType: 'attempt_failed',
    consumptionStatus:
      classified === 'schema_invalid_output' || classified === 'business_validation_failure'
        ? 'consumed'
        : 'unknown',
    resultClass: classified,
    proofCategory: null
  };
}

async function withOptionalPermit<T>(
  semaphores: AdapterSemaphoreRegistry,
  adapter: SubscriptionAdapter | null,
  signal: AbortSignal,
  work: () => Promise<T>
): Promise<T> {
  return adapter === null ? work() : semaphores.withPermit(adapter, signal, work);
}

export class NormalizationExecutionCoordinator {
  constructor(private readonly dependencies: NormalizationExecutionCoordinatorDependencies) {}

  async finalizeCompleted(
    request: CompletedNormalizationFinalizationRequest
  ): Promise<NormalizationExecutionResult | { readonly kind: 'already_finalized' }> {
    const claim = await this.dependencies.attempts.claimCompletedFinalization({
      jobLease: request.jobLease,
      analysisId: request.analysisId,
      newAnalysisLeaseOwner: request.analysisLeaseOwner,
      leaseSeconds: request.leaseSeconds,
      candidateId: request.candidateId,
      expectedCandidateState: request.expectedCandidateState,
      expectedNormalizationGeneration: request.normalizationGeneration
    });
    if (claim.kind === 'already_committed') return { kind: 'already_finalized' };
    const finalized = await this.dependencies.attempts.finalizeCandidate({
      jobLease: request.jobLease,
      analysisLease: {
        analysisId: request.analysisId,
        owner: request.analysisLeaseOwner,
        epoch: claim.analysisLeaseEpoch
      },
      candidateId: request.candidateId,
      expectedCandidateState: request.expectedCandidateState,
      expectedNormalizationGeneration: request.normalizationGeneration
    });
    return { kind: 'finalized', targetState: finalized.targetState };
  }

  async execute(request: NormalizationExecutionRequest): Promise<NormalizationExecutionResult> {
    const reconciliation = await this.dependencies.attempts.reconcile({
      jobLease: request.jobLease,
      analysisLease: request.analysisLease
    });
    if (reconciliation.pendingWinnerAttemptId !== null) {
      return this.finalizeWinner(request, reconciliation.pendingWinnerAttemptId);
    }

    const excluded = new Set(reconciliation.attemptedProviderIds);
    let fallbackParentAttemptId = reconciliation.fallbackParentAttemptId;
    let initialPaidPrimaryAvailable =
      excluded.size === 0 && fallbackParentAttemptId === null;
    if (excluded.size > 0 && fallbackParentAttemptId === null) {
      return this.defer(request);
    }
    for (;;) {
      throwIfAborted(request.signal);
      const paidPrimaryProviderIds = initialPaidPrimaryAvailable
        ? request.catalog.entries
          .filter((entry) => (
            entry.enabled &&
            entry.paidPrimary === true &&
            entry.provider.billingType === 'payg' &&
            entry.roles?.includes('niche_normalization')
          ))
          .map((entry) => entry.provider.id)
        : [];
      const decision = routeAiRequest(AiRequestSchema.parse({
        role: 'niche_normalization',
        routerMode: 'Balanced',
        locale: request.locale,
        allowPaidFallback: false,
        paidPrimaryProviderIds,
        excludeProviderIds: [...excluded],
        payload: { candidateId: request.candidateId }
      }), request.catalog);
      if (decision.kind === 'defer') {
        return this.defer(request);
      }

      const target = await this.dependencies.resolveTarget(decision, {
        initialPaidPrimary: paidPrimaryProviderIds.includes(decision.providerId)
      });
      if (
        target.providerId !== decision.providerId ||
        target.modelId !== decision.model.id
      ) {
        throw new Error('Normalization execution target does not match the routed provider.');
      }

      const structuredRequest: StructuredAiRequest<KeywordNormalization> = {
        role: 'niche_normalization',
        modelId: target.modelId,
        locale: request.locale,
        prompt: request.prompt,
        inputHash: request.inputHash,
        schema: KeywordNormalizationSchema
      };
      let authorizationAttemptId: string | null = null;
      let failure: unknown;
      try {
        const result = await withOptionalPermit(
          this.dependencies.semaphores,
          target.adapter,
          request.signal,
          async () => {
            throwIfAborted(request.signal);
            const authorization = await this.dependencies.attempts.begin({
              jobLease: request.jobLease,
              analysisLease: request.analysisLease,
              providerId: target.providerId,
              modelId: target.modelId,
              expectedSettingsRevision: target.expectedSettingsRevision,
              expectedAuthGeneration: target.expectedAuthGeneration,
              expectedExecutionFingerprint: target.expectedExecutionFingerprint,
              fallbackParentAttemptId
            });
            authorizationAttemptId = authorization.attemptId;
            throwIfAborted(request.signal);
            return target.execute(authorization.attemptId, structuredRequest, request.signal);
          }
        );
        const attemptId = authorizationAttemptId;
        if (attemptId === null) {
          throw new Error('Provider execution completed without durable authorization.');
        }
        await this.dependencies.attempts.appendOutcome({
          attemptId,
          jobLease: request.jobLease,
          analysisLease: request.analysisLease,
          eventType: 'attempt_succeeded',
          consumptionStatus: 'consumed',
          resultClass: 'success',
          proofCategory: null,
          latencyMs: Math.max(0, Date.parse(result.completedAt) - Date.parse(result.startedAt)),
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          providerRequestCount: result.usage.requestCount,
          safeMetadata: {},
          output: toJson(result.output),
          usage: toJson(result.usage)
        });
        return this.finalizeWinner(request, attemptId);
      } catch (error) {
        failure = error;
        if (authorizationAttemptId === null) throw error;
        const outcome = outcomeFor(error);
        await this.dependencies.attempts.appendOutcome({
          attemptId: authorizationAttemptId,
          jobLease: request.jobLease,
          analysisLease: request.analysisLease,
          eventType: outcome.eventType,
          consumptionStatus: outcome.consumptionStatus,
          resultClass: outcome.resultClass,
          proofCategory: outcome.proofCategory,
          latencyMs: null,
          inputTokens: null,
          outputTokens: null,
          providerRequestCount: 1,
          safeMetadata: {},
          output: null,
          usage: null
        });
        if (outcome.eventType === 'attempt_cancelled') throw error;
        let fallbackAllowed: boolean;
        if (outcome.failureClass === 'process_spawn_failure_pre_consumption') {
          fallbackAllowed = true;
        } else if (target.adapter !== null) {
          const runtime = await this.dependencies.runtime.applyFailure({
            attemptId: authorizationAttemptId,
            jobLease: request.jobLease,
            analysisLease: request.analysisLease,
            failureClass: outcome.failureClass,
            retryAfterSeconds: null
          });
          fallbackAllowed = runtime.allow_fallback || runtime.allow_replay;
        } else {
          fallbackAllowed = FALLBACK_FAILURES.has(outcome.failureClass);
        }
        if (!fallbackAllowed) throw failure;
        initialPaidPrimaryAvailable = false;
        fallbackParentAttemptId = authorizationAttemptId;
        if (outcome.failureClass !== 'process_spawn_failure_pre_consumption') {
          excluded.add(target.providerId);
        }
        continue;
      }
      throw failure;
    }
  }

  private async finalizeWinner(
    request: NormalizationExecutionRequest,
    attemptId: string
  ): Promise<NormalizationExecutionResult> {
    await this.dependencies.attempts.finalizeAnalysis({
      attemptId,
      jobLease: request.jobLease,
      analysisLease: request.analysisLease
    });
    const finalized = await this.dependencies.attempts.finalizeCandidate({
      jobLease: request.jobLease,
      analysisLease: request.analysisLease,
      candidateId: request.candidateId,
      expectedCandidateState: request.expectedCandidateState,
      expectedNormalizationGeneration: request.normalizationGeneration
    });
    return { kind: 'finalized', targetState: finalized.targetState };
  }

  private async defer(
    request: NormalizationExecutionRequest
  ): Promise<NormalizationExecutionResult> {
    const result = await this.dependencies.attempts.deferCandidate({
      jobLease: request.jobLease,
      analysisId: request.analysisLease.analysisId,
      candidateId: request.candidateId,
      expectedCandidateState: request.expectedCandidateState,
      expectedNormalizationGeneration: request.normalizationGeneration
    });
    return { kind: 'deferred', targetState: result.targetState };
  }
}
