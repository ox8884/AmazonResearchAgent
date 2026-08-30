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

export interface ProviderAttemptRepository {
  begin(input: BeginProviderAttemptInput): Promise<AttemptAuthorization>;
  finalizeCandidate(input: FinalizeCandidateInput): Promise<CandidateFinalizationResult>;
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

function parseAuthorization(value: Json | null): AttemptAuthorization {
  const operation = 'begin provider attempt';
  const object = requireObject(value, operation);
  if (
    typeof object.attempt_id !== 'string' ||
    typeof object.attempt_sequence !== 'number' ||
    !Number.isInteger(object.attempt_sequence) ||
    object.attempt_sequence < 1 ||
    typeof object.provider_id !== 'string' ||
    typeof object.model_id !== 'string' ||
    typeof object.billing_type !== 'string'
  ) {
    throw new ProviderAttemptRepositoryError(operation);
  }
  return {
    attemptId: object.attempt_id,
    attemptSequence: object.attempt_sequence,
    providerId: object.provider_id,
    modelId: object.model_id,
    adapter: nullableString(object.adapter, operation),
    billingType: object.billing_type
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
    }
  };
}
