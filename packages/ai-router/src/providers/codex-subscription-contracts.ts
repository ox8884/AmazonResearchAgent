import type { SubscriptionFailureClass } from '@ara/shared';
import { SubscriptionSandboxError } from './subscription-errors';
import type {
  SubscriptionProcessTransport,
  SubscriptionResultEnvelope
} from './subscription-process';

export const CODEX_SUBSCRIPTION_IDENTITY = Object.freeze({
  profileId: 'codex-subscription-v1' as const,
  modelId: 'gpt-5.6',
  binaryPath: '/usr/local/libexec/amazon-research/codex-subscription-client',
  authHomePath: '/var/lib/amazon-research/subscription/codex',
  invocationRoot: '/run/amazon-research/subscription/codex',
  unitTemplate: 'amazon-research-codex@.service' as const,
  policyDigest: '4006a1b3a1cf484d328be15825778f38a608a5e16637a8bed87b2a8f9683708a'
});

export interface CodexBinaryIdentity {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
  readonly version: string;
  readonly sha256: string;
}

export interface CodexAuthHomeIdentity {
  readonly path: string;
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly mode: number;
}

export interface CodexSandboxProfile {
  readonly adapter: 'codex';
  readonly profileId: string;
  readonly unitTemplate: 'amazon-research-codex@.service';
  readonly invocationRoot: string;
  readonly workerUid?: number | undefined;
  readonly adapterUid?: number | undefined;
  readonly ipcGid?: number | undefined;
}

export interface CodexExecutionProfile {
  readonly adapter: 'codex';
  readonly profileId: 'codex-subscription-v1';
  readonly activation: 'disabled' | 'enabled';
  readonly modelId: string;
  readonly fixedClientArguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly binary: CodexBinaryIdentity;
  readonly authHome: CodexAuthHomeIdentity;
  readonly sandbox: CodexSandboxProfile & { readonly policyDigest: string };
}

export interface CodexInvocation {
  readonly attemptId: string;
  readonly modelId: string;
  readonly role: 'niche_normalization';
  readonly locale: string;
  readonly prompt: string;
  readonly inputHash: string;
}

export type CodexSubscriptionTransport = SubscriptionProcessTransport<
  CodexSandboxProfile,
  CodexInvocation,
  SubscriptionResultEnvelope
>;

const RESULT_FAILURES = new Map<string, SubscriptionFailureClass>([
  ['AUTH_EXPIRED', 'auth_expired'],
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

function isRetryable(failureClass: SubscriptionFailureClass): boolean {
  return failureClass === 'capacity_exhausted' ||
    failureClass === 'rate_limited' ||
    failureClass === 'transient_network' ||
    failureClass === 'client_transient' ||
    failureClass === 'timeout';
}

export class CodexSubscriptionError extends Error {
  readonly failureClass: SubscriptionFailureClass;
  readonly retryable: boolean;

  constructor(
    message: string,
    failureClass: SubscriptionFailureClass,
    retryable: boolean,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'CodexSubscriptionError';
    this.failureClass = failureClass;
    this.retryable = retryable;
  }

  static fromResult(result: SubscriptionResultEnvelope): CodexSubscriptionError {
    const failureClass = RESULT_FAILURES.get(result.rawOutput.trim()) ?? 'unsafe_unknown';
    return new CodexSubscriptionError(
      'Codex subscription invocation failed.',
      failureClass,
      isRetryable(failureClass)
    );
  }

  static fromCause(cause: unknown): CodexSubscriptionError {
    if (cause instanceof CodexSubscriptionError) return cause;
    if (cause instanceof DOMException) {
      if (cause.name === 'AbortError') {
        return new CodexSubscriptionError(
          'Codex subscription invocation was cancelled.',
          'cancelled_by_caller',
          false,
          cause
        );
      }
      if (cause.name === 'TimeoutError') {
        return new CodexSubscriptionError(
          'Codex subscription invocation timed out.',
          'timeout',
          true,
          cause
        );
      }
    }
    if (cause instanceof SubscriptionSandboxError) {
      const failureClass: SubscriptionFailureClass =
        cause.kind === 'cancelled'
          ? 'cancelled_by_caller'
          : cause.kind === 'timeout'
            ? 'timeout'
            : cause.kind === 'cleanup'
              ? 'containment_failure'
              : cause.kind === 'start' && (cause.phase === 'S0' || cause.phase === 'S1')
                ? 'process_spawn_failure_pre_consumption'
                : 'unsafe_unknown';
      return new CodexSubscriptionError(
        'Codex subscription sandbox failed.',
        failureClass,
        isRetryable(failureClass),
        cause
      );
    }
    return new CodexSubscriptionError(
      'Codex subscription invocation failed unsafely.',
      'unsafe_unknown',
      false,
      cause
    );
  }
}
