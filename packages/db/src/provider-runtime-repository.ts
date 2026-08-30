import type { SubscriptionAdapter, SubscriptionFailureClass } from '@ara/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisLeaseIdentity, JobLeaseIdentity } from './provider-attempt-repository';
import type { Database, Json } from './types';

export const READINESS_MAX_AGE_SECONDS = 600;
export const READINESS_POLICY_VERSION = 'ready-lease-v1';
export const SECURITY_PROFILE_VERSION = 'subscription-isolation-v1';

type RuntimeClient = Pick<SupabaseClient<Database>, 'rpc'>;

type RuntimeBindings = {
  readonly providerId: string;
  readonly expectedSettingsRevision: number;
  readonly expectedAuthGeneration: number;
  readonly expectedExecutionFingerprint: string;
};

export type ProbeRequest = {
  readonly job_id: string;
  readonly probe_generation: number;
};

export type RuntimeMutationResult = {
  readonly mutated: boolean;
  readonly allow_fallback: boolean;
  readonly allow_replay: boolean;
};

type RuntimeFailureClass = Exclude<
  SubscriptionFailureClass,
  'process_spawn_failure_pre_consumption'
>;

export type AcceptanceProbeInput = RuntimeBindings & {
  readonly modelId: string;
  readonly adapter: SubscriptionAdapter;
  readonly securityProfileVersion: string;
  readonly readinessPolicyVersion: string;
  readonly termsDigest: string;
  readonly credentialSourceDigest: string;
  readonly binaryIdentityDigest: string;
  readonly capabilityDigest: string;
  readonly framingDigest: string;
  readonly boundedBehaviorDigest: string;
  readonly containmentDigest: string;
  readonly evidence: Json;
};

export type ReadinessProbeInput = RuntimeBindings & {
  readonly modelId: string;
  readonly expectedProbeGeneration: number;
  readonly termsDigest: string;
  readonly credentialSourceDigest: string;
  readonly binaryIdentityDigest: string;
  readonly capabilityDigest: string;
  readonly framingDigest: string;
  readonly boundedBehaviorDigest: string;
  readonly containmentDigest: string;
};

export interface ProviderRuntimeRepository {
  requestProbe(input: RuntimeBindings): Promise<ProbeRequest>;
  commitAcceptanceProbe(input: AcceptanceProbeInput): Promise<Json>;
  activate(input: RuntimeBindings & { readonly modelId: string; readonly termsDigest: string }): Promise<ProbeRequest>;
  deactivate(input: { readonly providerId: string }): Promise<Json>;
  commitProbe(input: ReadinessProbeInput): Promise<Json>;
  applyFailure(input: {
    readonly attemptId: string;
    readonly jobLease: JobLeaseIdentity;
    readonly analysisLease: AnalysisLeaseIdentity;
    readonly failureClass: RuntimeFailureClass;
    readonly retryAfterSeconds: number | null;
  }): Promise<RuntimeMutationResult>;
  fenceAuth(input: RuntimeBindings): Promise<Json>;
  expireReadyLease(input: RuntimeBindings): Promise<ProbeRequest | null>;
  isRoutable(input: RuntimeBindings & { readonly modelId: string }): Promise<boolean>;
}

export class ProviderRuntimeRepositoryError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Could not ${operation}.`, { cause });
    this.name = 'ProviderRuntimeRepositoryError';
  }
}

function bindings(input: RuntimeBindings) {
  return {
    provider_id: input.providerId,
    expected_settings_revision: input.expectedSettingsRevision,
    expected_auth_generation: input.expectedAuthGeneration,
    expected_execution_fingerprint: input.expectedExecutionFingerprint
  };
}

function requireJsonObject(
  value: Json | null,
  operation: string
): { [key: string]: Json | undefined } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderRuntimeRepositoryError(operation);
  }
  return value;
}

function probeRequest(value: Json | null, operation: string): ProbeRequest {
  const object = requireJsonObject(value, operation);
  if (typeof object.job_id !== 'string' || typeof object.probe_generation !== 'number') {
    throw new ProviderRuntimeRepositoryError(operation);
  }
  return { job_id: object.job_id, probe_generation: object.probe_generation };
}

function runtimeMutation(
  value: Json | null,
  operation: string
): RuntimeMutationResult {
  const object = requireJsonObject(value, operation);
  if (
    typeof object.mutated !== 'boolean' ||
    typeof object.allow_fallback !== 'boolean' ||
    typeof object.allow_replay !== 'boolean'
  ) {
    throw new ProviderRuntimeRepositoryError(operation);
  }
  return {
    mutated: object.mutated,
    allow_fallback: object.allow_fallback,
    allow_replay: object.allow_replay
  };
}

export function createProviderRuntimeRepository(
  client: RuntimeClient
): ProviderRuntimeRepository {
  return {
    async requestProbe(input) {
      const operation = 'request provider readiness probe';
      const { data, error } = await client.rpc('request_ai_provider_probe', bindings(input));
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return probeRequest(data, operation);
    },

    async commitAcceptanceProbe(input) {
      const operation = 'commit provider acceptance probe';
      const { data, error } = await client.rpc('commit_ai_provider_acceptance_probe', {
        ...bindings(input),
        model_id: input.modelId,
        adapter: input.adapter,
        security_profile_version: input.securityProfileVersion,
        readiness_policy_version: input.readinessPolicyVersion,
        terms_digest: input.termsDigest,
        credential_source_digest: input.credentialSourceDigest,
        binary_identity_digest: input.binaryIdentityDigest,
        capability_digest: input.capabilityDigest,
        framing_digest: input.framingDigest,
        bounded_behavior_digest: input.boundedBehaviorDigest,
        containment_digest: input.containmentDigest,
        evidence: input.evidence
      });
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return requireJsonObject(data, operation);
    },

    async activate(input) {
      const operation = 'activate subscription provider';
      const { data, error } = await client.rpc('activate_subscription_provider', {
        ...bindings(input),
        model_id: input.modelId,
        terms_digest: input.termsDigest
      });
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return probeRequest(data, operation);
    },

    async deactivate(input) {
      const operation = 'deactivate subscription provider';
      const { data, error } = await client.rpc('deactivate_subscription_provider', {
        provider_id: input.providerId
      });
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return requireJsonObject(data, operation);
    },

    async commitProbe(input) {
      const operation = 'commit provider readiness probe';
      const { data, error } = await client.rpc('commit_ai_provider_probe', {
        ...bindings(input),
        model_id: input.modelId,
        expected_probe_generation: input.expectedProbeGeneration,
        terms_digest: input.termsDigest,
        credential_source_digest: input.credentialSourceDigest,
        binary_identity_digest: input.binaryIdentityDigest,
        capability_digest: input.capabilityDigest,
        framing_digest: input.framingDigest,
        bounded_behavior_digest: input.boundedBehaviorDigest,
        containment_digest: input.containmentDigest
      });
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return requireJsonObject(data, operation);
    },

    async applyFailure(input) {
      const operation = 'apply provider runtime failure';
      const { data, error } = await client.rpc('apply_ai_provider_runtime_failure', {
        attempt_id: input.attemptId,
        job_id: input.jobLease.jobId,
        job_lease_owner: input.jobLease.owner,
        job_lease_epoch: input.jobLease.epoch,
        analysis_id: input.analysisLease.analysisId,
        analysis_lease_owner: input.analysisLease.owner,
        analysis_lease_epoch: input.analysisLease.epoch,
        failure_class: input.failureClass,
        ...(input.retryAfterSeconds === null
          ? {}
          : { retry_after_seconds: input.retryAfterSeconds })
      });
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return runtimeMutation(data, operation);
    },

    async fenceAuth(input) {
      const operation = 'fence provider authorization';
      const { data, error } = await client.rpc('fence_ai_provider_auth', bindings(input));
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return requireJsonObject(data, operation);
    },

    async expireReadyLease(input) {
      const operation = 'expire provider readiness lease';
      const { data, error } = await client.rpc('expire_ai_provider_ready_lease', bindings(input));
      if (error) throw new ProviderRuntimeRepositoryError(operation, error);
      return data === null ? null : probeRequest(data, operation);
    },

    async isRoutable(input) {
      const { data, error } = await client.rpc('is_ai_provider_routable', {
        ...bindings(input),
        model_id: input.modelId
      });
      if (error || typeof data !== 'boolean') {
        throw new ProviderRuntimeRepositoryError('read provider routability', error);
      }
      return data;
    }
  };
}
