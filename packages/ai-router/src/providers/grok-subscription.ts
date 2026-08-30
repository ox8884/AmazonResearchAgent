import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AiUsageSchema,
  type AiModelDescriptor,
  type SubscriptionFailureClass
} from '@ara/shared';
import type {
  ProviderHealth,
  RawAiProvider,
  RawAiProviderResult,
  RawStructuredAiRequest
} from '../provider';
import { SubscriptionSandboxError } from './subscription-errors';
import type {
  SubscriptionProcessTransport,
  SubscriptionResultEnvelope
} from './subscription-process';

export const GROK_SUBSCRIPTION_IDENTITY = Object.freeze({
  profileId: 'grok-subscription-v1' as const,
  binaryPath: '/usr/local/libexec/amazon-research/grok-subscription-client',
  authHomePath: '/var/lib/amazon-research/subscription/grok',
  invocationRoot: '/run/amazon-research/subscription/grok',
  unitTemplate: 'amazon-research-grok@.service' as const,
  policyDigest: 'ef953f76994eb6ce44481b106097dca3962612244d1e9410326ee6061f0a3e2c',
  acceptedModelId: null,
  acceptedBinaryVersion: null,
  acceptedBinarySha256: null
});

export interface GrokBinaryIdentity {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
  readonly version: string;
  readonly sha256: string;
}

export interface GrokAuthHomeIdentity {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
}

const PROFILE_PROVENANCE: unique symbol = Symbol('grok-profile-provenance');

export interface GrokSandboxProfile {
  readonly adapter: 'grok';
  readonly profileId: 'grok-subscription-v1';
  readonly unitTemplate: 'amazon-research-grok@.service';
  readonly invocationRoot: string;
}

export interface GrokExecutionProfile {
  readonly [PROFILE_PROVENANCE]: 'accepted' | 'fixture';
  readonly adapter: 'grok';
  readonly profileId: 'grok-subscription-v1';
  readonly activation: 'disabled' | 'enabled';
  readonly clientAcceptance: 'accepted' | 'fixture_only';
  readonly modelId: string;
  readonly fixedClientArguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly binary: GrokBinaryIdentity;
  readonly authHome: GrokAuthHomeIdentity;
  readonly sandbox: GrokSandboxProfile & { readonly policyDigest: string };
}

interface GrokInvocation {
  readonly attemptId: string;
  readonly modelId: string;
  readonly role: 'niche_normalization';
  readonly locale: string;
  readonly prompt: string;
  readonly inputHash: string;
}

export type GrokSubscriptionTransport = SubscriptionProcessTransport<
  GrokSandboxProfile,
  GrokInvocation,
  SubscriptionResultEnvelope
>;

const OUTPUT_SCHEMA = z.record(z.string(), z.unknown());
const CREDENTIAL_SCHEMA = z.object({
  kind: z.literal('grok_oauth_subscription'),
  authenticated: z.literal(true),
  endpoint: z.literal('official'),
  providerOverride: z.null()
}).strict();
const FORBIDDEN_ENVIRONMENT = [
  'XAI_API_KEY',
  'XAI_BASE_URL',
  'GROK_ACCESS_TOKEN',
  'GROK_PROVIDER'
] as const;
const RESULT_FAILURES = new Map<string, SubscriptionFailureClass>([
  ['OAUTH_EXPIRED', 'auth_expired'],
  ['CREDENTIAL_SOURCE_MISMATCH', 'credential_source_mismatch'],
  ['BINARY_IDENTITY_MISMATCH', 'binary_identity_mismatch'],
  ['PROFILE_MISMATCH', 'profile_mismatch'],
  ['CONTAINMENT_FAILURE', 'containment_failure'],
  ['CAPABILITY_FAILURE', 'capability_failure'],
  ['CAPACITY_EXHAUSTED', 'capacity_exhausted'],
  ['RATE_LIMITED', 'rate_limited'],
  ['TRANSIENT_NETWORK', 'transient_network'],
  ['CLIENT_TRANSIENT', 'client_transient'],
  ['SCHEMA_INVALID_OUTPUT', 'schema_invalid_output'],
  ['BUSINESS_VALIDATION_FAILURE', 'business_validation_failure']
]);

function retryable(failureClass: SubscriptionFailureClass): boolean {
  return ['capacity_exhausted', 'rate_limited', 'transient_network', 'client_transient', 'timeout']
    .includes(failureClass);
}

export class GrokSubscriptionError extends Error {
  constructor(
    message: string,
    readonly failureClass: SubscriptionFailureClass,
    readonly retryable: boolean,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'GrokSubscriptionError';
  }

  static fromResult(result: SubscriptionResultEnvelope): GrokSubscriptionError {
    const failureClass = RESULT_FAILURES.get(result.rawOutput.trim()) ?? 'unsafe_unknown';
    return new GrokSubscriptionError('Grok subscription invocation failed.', failureClass, retryable(failureClass));
  }

  static fromCause(cause: unknown): GrokSubscriptionError {
    if (cause instanceof GrokSubscriptionError) return cause;
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return new GrokSubscriptionError('Grok invocation was cancelled.', 'cancelled_by_caller', false, cause);
    }
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      return new GrokSubscriptionError('Grok invocation timed out.', 'timeout', true, cause);
    }
    if (cause instanceof SubscriptionSandboxError) {
      const failureClass: SubscriptionFailureClass = cause.kind === 'cancelled'
        ? 'cancelled_by_caller'
        : cause.kind === 'timeout'
          ? 'timeout'
          : cause.kind === 'cleanup'
            ? 'containment_failure'
            : cause.kind === 'start' && (cause.phase === 'S0' || cause.phase === 'S1')
              ? 'process_spawn_failure_pre_consumption'
              : 'unsafe_unknown';
      return new GrokSubscriptionError('Grok sandbox failed.', failureClass, retryable(failureClass), cause);
    }
    return new GrokSubscriptionError('Grok invocation failed unsafely.', 'unsafe_unknown', false, cause);
  }
}

export class GrokSetupRequiredError extends GrokSubscriptionError {
  readonly state = 'setup_required' as const;

  constructor(message = 'Grok subscription setup is not accepted.') {
    super(message, 'profile_mismatch', false);
    this.name = 'GrokSetupRequiredError';
  }
}

export function inspectGrokCredentialSource(
  evidence: unknown,
  environment: Readonly<Record<string, string | undefined>>
): z.infer<typeof CREDENTIAL_SCHEMA> {
  if (FORBIDDEN_ENVIRONMENT.some((name) => environment[name] !== undefined)) {
    throw new GrokSubscriptionError('Grok credential precedence is not OAuth-only.', 'credential_source_mismatch', false);
  }
  const parsed = CREDENTIAL_SCHEMA.safeParse(evidence);
  if (!parsed.success) throw new GrokSetupRequiredError('Grok OAuth authorization is required.');
  return parsed.data;
}

export function parseGrokNormalizationOutput(rawOutput: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(rawOutput);
  } catch (cause) {
    throw new GrokSubscriptionError('Grok output is not one strict JSON value.', 'schema_invalid_output', false, cause);
  }
  const parsed = OUTPUT_SCHEMA.safeParse(value);
  if (!parsed.success) {
    throw new GrokSubscriptionError('Grok output is not a JSON object.', 'schema_invalid_output', false, parsed.error);
  }
  return parsed.data;
}

export function createGrokSubscriptionFixtureProfile(modelId: 'grok-fixture-model'): GrokExecutionProfile {
  return Object.freeze({
    adapter: 'grok',
    profileId: GROK_SUBSCRIPTION_IDENTITY.profileId,
    activation: 'enabled',
    [PROFILE_PROVENANCE]: 'fixture' as const,
    clientAcceptance: 'fixture_only',
    modelId,
    fixedClientArguments: Object.freeze(['--fixed-profile', GROK_SUBSCRIPTION_IDENTITY.profileId]),
    environment: Object.freeze({}),
    binary: Object.freeze({ path: GROK_SUBSCRIPTION_IDENTITY.binaryPath, ownerUid: 501, ownerGid: 501, mode: 0o500, version: 'fixture-only', sha256: '0'.repeat(64) }),
    authHome: Object.freeze({ path: GROK_SUBSCRIPTION_IDENTITY.authHomePath, ownerUid: 502, ownerGid: 502, mode: 0o700 }),
    sandbox: Object.freeze({ adapter: 'grok', profileId: GROK_SUBSCRIPTION_IDENTITY.profileId, unitTemplate: GROK_SUBSCRIPTION_IDENTITY.unitTemplate, invocationRoot: GROK_SUBSCRIPTION_IDENTITY.invocationRoot, policyDigest: GROK_SUBSCRIPTION_IDENTITY.policyDigest })
  });
}

function validateProfile(profile: GrokExecutionProfile): void {
  const fixture = profile[PROFILE_PROVENANCE] === 'fixture' &&
    profile.clientAcceptance === 'fixture_only' &&
    profile.modelId === 'grok-fixture-model';
  const accepted = profile[PROFILE_PROVENANCE] === 'accepted' &&
    profile.clientAcceptance === 'accepted' &&
    GROK_SUBSCRIPTION_IDENTITY.acceptedModelId !== null &&
    profile.modelId === GROK_SUBSCRIPTION_IDENTITY.acceptedModelId;
  if ((!fixture && !accepted) || profile.adapter !== 'grok' ||
    profile.profileId !== GROK_SUBSCRIPTION_IDENTITY.profileId ||
    profile.binary.path !== GROK_SUBSCRIPTION_IDENTITY.binaryPath ||
    profile.authHome.path !== GROK_SUBSCRIPTION_IDENTITY.authHomePath ||
    profile.sandbox.unitTemplate !== GROK_SUBSCRIPTION_IDENTITY.unitTemplate ||
    profile.sandbox.invocationRoot !== GROK_SUBSCRIPTION_IDENTITY.invocationRoot ||
    profile.sandbox.policyDigest !== GROK_SUBSCRIPTION_IDENTITY.policyDigest ||
    profile.fixedClientArguments.join('\0') !== `--fixed-profile\0${profile.profileId}` ||
    Object.keys(profile.environment).length !== 0) {
    throw new GrokSetupRequiredError();
  }
}

export class GrokSubscriptionAdapter implements RawAiProvider {
  readonly id: string;
  readonly billingType = 'subscription' as const;

  constructor(
    private readonly options: {
      readonly profile: GrokExecutionProfile;
      readonly transport: GrokSubscriptionTransport;
    }
  ) {
    validateProfile(options.profile);
    if (options.transport.isolation !== 'systemd-subscription-sandbox-v1') {
      throw new GrokSetupRequiredError('Grok systemd isolation is not accepted.');
    }
    this.id = options.profile.profileId;
  }

  async health(): Promise<ProviderHealth> {
    return {
      available: this.options.profile.activation === 'enabled',
      checkedAt: new Date().toISOString(),
      reason: this.options.profile.activation === 'enabled' ? null : 'Grok subscription setup required.',
      retryAfterSeconds: null
    };
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    return [{ providerId: this.id, id: this.options.profile.modelId, displayName: this.options.profile.modelId, capabilities: ['structured_json', 'health'], billingType: 'subscription', qualityRank: 100 }];
  }

  async runRaw(request: RawStructuredAiRequest, signal: AbortSignal = new AbortController().signal): Promise<RawAiProviderResult> {
    const profile = this.options.profile;
    if (profile.activation !== 'enabled' || request.role !== 'niche_normalization' || request.modelId !== profile.modelId) {
      throw new GrokSetupRequiredError();
    }
    const attemptId = randomUUID();
    const startedAt = new Date().toISOString();
    let result: SubscriptionResultEnvelope;
    try {
      result = await this.options.transport.run(profile.sandbox, { attemptId, modelId: request.modelId, role: 'niche_normalization', locale: request.locale, prompt: request.prompt, inputHash: request.inputHash }, signal);
    } catch (cause) {
      throw GrokSubscriptionError.fromCause(cause);
    }
    if (result.outcome !== 'success' || result.adapter !== 'grok' || result.attemptId !== attemptId || result.clientExit.code !== 0 || result.clientExit.signal !== null) {
      throw GrokSubscriptionError.fromResult(result);
    }
    return { rawOutput: parseGrokNormalizationOutput(result.rawOutput), providerId: this.id, modelId: request.modelId, role: request.role, inputHash: request.inputHash, usage: AiUsageSchema.parse({ inputTokens: null, outputTokens: null, totalTokens: null, requestCount: 1 }), costClass: 'subscription', startedAt, completedAt: new Date().toISOString() };
  }
}
