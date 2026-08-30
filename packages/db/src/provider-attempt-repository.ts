import type {
  ProviderAttemptEventType,
  ProviderConsumptionStatus
} from '@ara/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types';

type ProviderAttemptClient = Pick<SupabaseClient<Database>, 'rpc'>;

export type JobLeaseIdentity = {
  readonly jobId: string;
  readonly owner: string;
  readonly epoch: number;
};

export type AnalysisLeaseIdentity = {
  readonly analysisId: string;
  readonly owner: string;
  readonly epoch: number;
};

export type AttemptAuthorization = {
  readonly attemptId: string;
  readonly attemptSequence: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapter: string | null;
  readonly billingType: string;
};

export type BeginProviderAttemptInput = {
  readonly jobLease: JobLeaseIdentity;
  readonly analysisLease: AnalysisLeaseIdentity;
  readonly providerId: string;
  readonly modelId: string;
  readonly expectedSettingsRevision: number;
  readonly expectedAuthGeneration: number;
  readonly expectedExecutionFingerprint: string;
  readonly fallbackParentAttemptId: string | null;
};

export type AppendProviderAttemptOutcomeInput = {
  readonly attemptId: string;
  readonly jobLease: JobLeaseIdentity;
  readonly analysisLease: AnalysisLeaseIdentity;
  readonly eventType: Exclude<ProviderAttemptEventType, 'attempt_started'>;
  readonly consumptionStatus: ProviderConsumptionStatus;
  readonly resultClass: string;
  readonly proofCategory: string | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly providerRequestCount: number | null;
  readonly safeMetadata: Json;
  readonly output: Json | null;
  readonly usage: Json | null;
};

export type ProviderAttemptOutcome = {
  readonly eventType: Exclude<ProviderAttemptEventType, 'attempt_started'>;
};

export type AnalysisFinalizationResult = {
  readonly status: 'completed';
  readonly outputSha256: string;
};

export type CandidateFinalizationResult = {
  readonly kind: 'committed' | 'already_committed';
  readonly targetState: 'Reject' | 'Needs Review' | 'Ready for API Validation';
  readonly decisionId: string | null;
  readonly nicheClusterId: string | null;
};

export type FinalizeCandidateInput = {
  readonly jobLease: JobLeaseIdentity;
  readonly analysisLease: AnalysisLeaseIdentity;
  readonly candidateId: string;
  readonly expectedCandidateState: string;
  readonly expectedNormalizationGeneration: number;
};

export type CompletedAnalysisFinalizationClaim =
  | { readonly kind: 'already_committed'; readonly analysisLeaseEpoch: null }
  | { readonly kind: 'claimed'; readonly analysisLeaseEpoch: number };

export type CandidateDeferralResult = {
  readonly kind: 'deferred' | 'already_deferred';
  readonly targetState: 'Waiting for AI Capacity';
};

export type AttemptReconciliation = {
  readonly attemptedProviderIds: readonly string[];
  readonly pendingWinnerAttemptId: string | null;
  readonly fallbackParentAttemptId: string | null;
};

export interface ProviderAttemptRepository {
  begin(input: BeginProviderAttemptInput): Promise<AttemptAuthorization>;
  appendOutcome(input: AppendProviderAttemptOutcomeInput): Promise<ProviderAttemptOutcome>;
  finalizeAnalysis(input: {
    readonly attemptId: string;
    readonly jobLease: JobLeaseIdentity;
    readonly analysisLease: AnalysisLeaseIdentity;
  }): Promise<AnalysisFinalizationResult>;
  finalizeCandidate(input: FinalizeCandidateInput): Promise<CandidateFinalizationResult>;
  claimCompletedFinalization(input: {
    readonly jobLease: JobLeaseIdentity;
    readonly analysisId: string;
    readonly newAnalysisLeaseOwner: string;
    readonly leaseSeconds: number;
    readonly candidateId: string;
    readonly expectedCandidateState: string;
    readonly expectedNormalizationGeneration: number;
  }): Promise<CompletedAnalysisFinalizationClaim>;
  deferCandidate(input: {
    readonly jobLease: JobLeaseIdentity;
    readonly analysisId: string;
    readonly candidateId: string;
    readonly expectedCandidateState: string;
    readonly expectedNormalizationGeneration: number;
  }): Promise<CandidateDeferralResult>;
  reconcile(input: {
    readonly jobLease: JobLeaseIdentity;
    readonly analysisLease: AnalysisLeaseIdentity;
  }): Promise<AttemptReconciliation>;
}

export class ProviderAttemptRepositoryError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ProviderAttemptRepositoryError';
  }
}

function requireObject(
  value: Json | null,
  operation: string
): { [key: string]: Json | undefined } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return value;
}

function nullableString(value: Json | undefined, operation: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new ProviderAttemptRepositoryError(operation);
  return value;
}

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function nullableUuid(value: Json | undefined, operation: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !canonicalUuidPattern.test(value)) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return value;
}

function requiredString(value: Json | undefined, operation: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return value;
}

function parseAuthorization(value: Json | null): AttemptAuthorization {
  const operation = 'begin provider attempt';
  const object = requireObject(value, operation);
  if (
    typeof object.attempt_sequence !== 'number' ||
    !Number.isSafeInteger(object.attempt_sequence) ||
    object.attempt_sequence < 1
  ) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return {
    attemptId: requiredString(object.attempt_id, operation),
    attemptSequence: object.attempt_sequence,
    providerId: requiredString(object.provider_id, operation),
    modelId: requiredString(object.model_id, operation),
    adapter: nullableString(object.adapter, operation),
    billingType: requiredString(object.billing_type, operation)
  };
}

function parseCandidateFinalization(value: Json | null): CandidateFinalizationResult {
  const operation = 'finalize normalized candidate';
  const object = requireObject(value, operation);
  const kind = object.kind;
  const targetState = object.target_state;
  if (
    (kind !== 'committed' && kind !== 'already_committed') ||
    (targetState !== 'Reject' &&
      targetState !== 'Needs Review' &&
      targetState !== 'Ready for API Validation')
  ) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return {
    kind,
    targetState,
    decisionId: nullableString(object.decision_id, operation),
    nicheClusterId: nullableString(object.niche_cluster_id, operation)
  };
}

function leaseArgs(jobLease: JobLeaseIdentity, analysisLease: AnalysisLeaseIdentity) {
  return {
    job_id: jobLease.jobId,
    job_lease_owner: jobLease.owner,
    job_lease_epoch: jobLease.epoch,
    analysis_id: analysisLease.analysisId,
    analysis_lease_owner: analysisLease.owner,
    analysis_lease_epoch: analysisLease.epoch
  };
}

function jobArgs(jobLease: JobLeaseIdentity) {
  return {
    job_id: jobLease.jobId,
    job_lease_owner: jobLease.owner,
    job_lease_epoch: jobLease.epoch
  };
}

export function createProviderAttemptRepository(
  client: ProviderAttemptClient
): ProviderAttemptRepository {
  return {
    async begin(input) {
      const operation = 'begin provider attempt';
      const { data, error } = await client.rpc('begin_ai_provider_attempt', {
        ...leaseArgs(input.jobLease, input.analysisLease),
        provider_id: input.providerId,
        model_id: input.modelId,
        expected_settings_revision: input.expectedSettingsRevision,
        expected_auth_generation: input.expectedAuthGeneration,
        expected_execution_fingerprint: input.expectedExecutionFingerprint,
        ...(input.fallbackParentAttemptId === null
          ? {}
          : { fallback_parent_attempt_id: input.fallbackParentAttemptId })
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      return parseAuthorization(data);
    },

    async appendOutcome(input) {
      const operation = 'append provider attempt outcome';
      const { data, error } = await client.rpc('append_ai_provider_attempt_outcome', {
        attempt_id: input.attemptId,
        ...leaseArgs(input.jobLease, input.analysisLease),
        event_type: input.eventType,
        consumption_status: input.consumptionStatus,
        result_class: input.resultClass,
        ...(input.proofCategory === null ? {} : { proof_category: input.proofCategory }),
        ...(input.latencyMs === null ? {} : { latency_ms: input.latencyMs }),
        ...(input.inputTokens === null ? {} : { input_tokens: input.inputTokens }),
        ...(input.outputTokens === null ? {} : { output_tokens: input.outputTokens }),
        ...(input.providerRequestCount === null
          ? {}
          : { provider_request_count: input.providerRequestCount }),
        safe_metadata: input.safeMetadata,
        ...(input.output === null ? {} : { output: input.output }),
        ...(input.usage === null ? {} : { usage: input.usage })
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      const eventType = requireObject(data, operation).event_type;
      if (
        eventType !== 'attempt_succeeded' &&
        eventType !== 'attempt_failed' &&
        eventType !== 'attempt_cancelled' &&
        eventType !== 'attempt_not_consumed' &&
        eventType !== 'attempt_unknown_after_crash'
      ) {
        throw new ProviderAttemptRepositoryError(operation);
      }
      return { eventType };
    },

    async finalizeAnalysis(input) {
      const operation = 'finalize AI analysis from provider attempt';
      const { data, error } = await client.rpc('finalize_ai_analysis_from_attempt', {
        attempt_id: input.attemptId,
        ...leaseArgs(input.jobLease, input.analysisLease)
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      const object = requireObject(data, operation);
      const outputSha256 = requiredString(object.output_sha256, operation);
      if (object.status !== 'completed' || !/^[a-f0-9]{64}$/u.test(outputSha256)) {
        throw new ProviderAttemptRepositoryError(operation);
      }
      return { status: 'completed', outputSha256 };
    },

    async finalizeCandidate(input) {
      const operation = 'finalize normalized candidate';
      const { data, error } = await client.rpc('finalize_normalized_candidate', {
        ...leaseArgs(input.jobLease, input.analysisLease),
        candidate_id: input.candidateId,
        expected_candidate_state: input.expectedCandidateState,
        expected_normalization_generation: input.expectedNormalizationGeneration
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      return parseCandidateFinalization(data);
    },

    async claimCompletedFinalization(input) {
      const operation = 'claim completed AI analysis finalization';
      const { data, error } = await client.rpc('claim_completed_ai_analysis_finalization', {
        ...jobArgs(input.jobLease),
        analysis_id: input.analysisId,
        new_analysis_lease_owner: input.newAnalysisLeaseOwner,
        lease_seconds: input.leaseSeconds,
        candidate_id: input.candidateId,
        expected_candidate_state: input.expectedCandidateState,
        expected_normalization_generation: input.expectedNormalizationGeneration
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      const object = requireObject(data, operation);
      if (object.kind === 'already_committed') {
        return { kind: 'already_committed', analysisLeaseEpoch: null };
      }
      if (
        object.kind !== 'claimed' ||
        typeof object.analysis_lease_epoch !== 'number' ||
        !Number.isSafeInteger(object.analysis_lease_epoch) ||
        object.analysis_lease_epoch < 1
      ) {
        throw new ProviderAttemptRepositoryError(operation);
      }
      return { kind: 'claimed', analysisLeaseEpoch: object.analysis_lease_epoch };
    },

    async deferCandidate(input) {
      const operation = 'defer candidate normalization';
      const { data, error } = await client.rpc('defer_candidate_normalization', {
        ...jobArgs(input.jobLease),
        analysis_id: input.analysisId,
        candidate_id: input.candidateId,
        expected_candidate_state: input.expectedCandidateState,
        expected_normalization_generation: input.expectedNormalizationGeneration
      });
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      const object = requireObject(data, operation);
      if (
        (object.kind !== 'deferred' && object.kind !== 'already_deferred') ||
        object.target_state !== 'Waiting for AI Capacity'
      ) {
        throw new ProviderAttemptRepositoryError(operation);
      }
      return { kind: object.kind, targetState: object.target_state };
    },

    async reconcile(input) {
      const operation = 'reconcile provider attempts';
      const { data, error } = await client.rpc('reconcile_ai_provider_attempts',
        leaseArgs(input.jobLease, input.analysisLease));
      if (error) throw new ProviderAttemptRepositoryError(operation, error);
      const object = requireObject(data, operation);
      if (
        !Array.isArray(object.attempted_provider_ids) ||
        !object.attempted_provider_ids.every((value) => typeof value === 'string')
      ) {
        throw new ProviderAttemptRepositoryError(operation);
      }
      return {
        attemptedProviderIds: object.attempted_provider_ids,
        pendingWinnerAttemptId: nullableUuid(object.pending_winner_attempt_id, operation),
        fallbackParentAttemptId: nullableUuid(object.fallback_parent_attempt_id, operation)
      };
    }
  };
}
