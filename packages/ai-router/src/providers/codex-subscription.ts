import { z } from 'zod';
import { AiUsageSchema, type AiModelDescriptor } from '@ara/shared';
import {
  type ProviderHealth,
  type RawAiProviderResult
} from '../provider';
import {
  AuthorizedSubscriptionAttemptIdSchema,
  type AuthorizedSubscriptionRawRequest,
  type SubscriptionResultEnvelope
} from './subscription-process';
import {
  CODEX_SUBSCRIPTION_IDENTITY,
  CodexSubscriptionError,
  type CodexExecutionProfile,
  type CodexSubscriptionTransport
} from './codex-subscription-contracts';

export {
  CODEX_SUBSCRIPTION_IDENTITY,
  CodexSubscriptionError
} from './codex-subscription-contracts';
export type {
  CodexAuthHomeIdentity,
  CodexBinaryIdentity,
  CodexExecutionProfile,
  CodexInvocation,
  CodexSandboxProfile,
  CodexSubscriptionTransport
} from './codex-subscription-contracts';

const CodexNormalizationOutputSchema = z.record(z.string(), z.unknown());

function deepFreezeProfile(profile: CodexExecutionProfile): CodexExecutionProfile {
  const fixedClientArguments = Object.freeze([...profile.fixedClientArguments]);
  const environment = Object.freeze({ ...profile.environment });
  const binary = Object.freeze({ ...profile.binary });
  const authHome = Object.freeze({ ...profile.authHome });
  const sandbox = Object.freeze({ ...profile.sandbox });
  return Object.freeze({
    ...profile,
    fixedClientArguments,
    environment,
    binary,
    authHome,
    sandbox
  });
}

function validateProfile(profile: CodexExecutionProfile): void {
  if (
    profile.adapter !== 'codex' ||
    profile.profileId !== CODEX_SUBSCRIPTION_IDENTITY.profileId ||
    profile.modelId !== CODEX_SUBSCRIPTION_IDENTITY.modelId ||
    profile.binary.path !== CODEX_SUBSCRIPTION_IDENTITY.binaryPath ||
    profile.authHome.path !== CODEX_SUBSCRIPTION_IDENTITY.authHomePath ||
    profile.sandbox.adapter !== 'codex' ||
    profile.sandbox.profileId !== profile.profileId ||
    profile.sandbox.unitTemplate !== CODEX_SUBSCRIPTION_IDENTITY.unitTemplate ||
    profile.sandbox.invocationRoot !== CODEX_SUBSCRIPTION_IDENTITY.invocationRoot ||
    profile.sandbox.policyDigest !== CODEX_SUBSCRIPTION_IDENTITY.policyDigest ||
    profile.fixedClientArguments.length !== 2 ||
    profile.fixedClientArguments[0] !== '--fixed-profile' ||
    profile.fixedClientArguments[1] !== profile.profileId ||
    Object.keys(profile.environment).length !== 0
  ) {
    throw new CodexSubscriptionError(
      'Codex execution profile does not match the app-owned identity.',
      'profile_mismatch',
      false
    );
  }
}

export function parseCodexNormalizationOutput(rawOutput: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (cause) {
    throw new CodexSubscriptionError(
      'Codex output is not one strict JSON value.',
      'schema_invalid_output',
      false,
      cause
    );
  }
  const result = CodexNormalizationOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CodexSubscriptionError(
      'Codex output is not a JSON object.',
      'schema_invalid_output',
      false,
      result.error
    );
  }
  return result.data;
}

export class CodexSubscriptionAdapter {
  readonly id: string;
  readonly billingType = 'subscription' as const;
  readonly profile: CodexExecutionProfile;
  private readonly transport: CodexSubscriptionTransport;

  constructor(options: {
    readonly profile: CodexExecutionProfile;
    readonly transport: CodexSubscriptionTransport;
  }) {
    validateProfile(options.profile);
    if (options.transport.isolation !== 'systemd-subscription-sandbox-v1') {
      throw new CodexSubscriptionError(
        'Codex transport does not provide the required systemd isolation.',
        'containment_failure',
        false
      );
    }
    this.profile = deepFreezeProfile(options.profile);
    this.transport = options.transport;
    this.id = this.profile.profileId;
  }

  async health(): Promise<ProviderHealth> {
    return {
      available: this.profile.activation === 'enabled',
      checkedAt: new Date().toISOString(),
      reason: this.profile.activation === 'enabled' ? null : 'Codex subscription profile is disabled.',
      retryAfterSeconds: null
    };
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    return [{
      providerId: this.id,
      id: this.profile.modelId,
      displayName: this.profile.modelId,
      capabilities: ['structured_json', 'health'],
      billingType: 'subscription',
      qualityRank: 100
    }];
  }

  async runAuthorizedRaw(
    request: AuthorizedSubscriptionRawRequest,
    signal: AbortSignal = new AbortController().signal
  ): Promise<RawAiProviderResult> {
    if (
      this.profile.activation !== 'enabled' ||
      request.role !== 'niche_normalization' ||
      request.modelId !== this.profile.modelId
    ) {
      throw new CodexSubscriptionError(
        'Codex subscription profile is not active for this request.',
        'profile_mismatch',
        false
      );
    }
    const attemptId = AuthorizedSubscriptionAttemptIdSchema.parse(request.attemptId);
    const startedAt = new Date().toISOString();
    let result: SubscriptionResultEnvelope;
    try {
      result = await this.transport.run(
        this.profile.sandbox,
        {
          attemptId,
          modelId: request.modelId,
          role: 'niche_normalization',
          locale: request.locale,
          prompt: request.prompt,
          inputHash: request.inputHash
        },
        signal
      );
    } catch (cause) {
      throw CodexSubscriptionError.fromCause(cause);
    }
    if (
      result.outcome !== 'success' ||
      result.adapter !== 'codex' ||
      result.attemptId !== attemptId ||
      result.clientExit.code !== 0 ||
      result.clientExit.signal !== null
    ) {
      throw CodexSubscriptionError.fromResult(result);
    }
    return {
      rawOutput: parseCodexNormalizationOutput(result.rawOutput),
      providerId: this.id,
      modelId: request.modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage: AiUsageSchema.parse({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }),
      costClass: 'subscription',
      startedAt,
      completedAt: new Date().toISOString()
    };
  }
}
