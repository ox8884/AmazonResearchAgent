import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CodexSubscriptionAdapter,
  CodexSubscriptionError,
  parseCodexNormalizationOutput,
  type CodexExecutionProfile
} from './codex-subscription';
import type {
  SubscriptionProcessTransport,
  SubscriptionResultEnvelope
} from './subscription-process';

const profile: CodexExecutionProfile = {
  adapter: 'codex',
  profileId: 'codex-subscription-v1',
  activation: 'disabled',
  modelId: 'gpt-5.6',
  fixedClientArguments: ['--fixed-profile', 'codex-subscription-v1'],
  environment: {},
  binary: {
    path: '/usr/local/libexec/amazon-research/codex-subscription-client',
    ownerUid: 501,
    ownerGid: 501,
    mode: 0o500,
    version: '1.2.3',
    sha256: 'a'.repeat(64)
  },
  authHome: {
    path: '/var/lib/amazon-research/subscription/codex',
    ownerUid: 501,
    ownerGid: 501,
    mode: 0o700
  },
  sandbox: {
    adapter: 'codex',
    profileId: 'codex-subscription-v1',
    unitTemplate: 'amazon-research-codex@.service',
    invocationRoot: '/run/amazon-research/subscription/codex',
    policyDigest: '7b0782727c8faf441f813e8d8a1263074394cc8cb06a55cbc7d3a9783475b18d'
  }
};

class FakeTransport implements SubscriptionProcessTransport<
  CodexExecutionProfile['sandbox'],
  {
    readonly attemptId: string;
    readonly modelId: string;
    readonly role: 'niche_normalization';
    readonly locale: string;
    readonly prompt: string;
    readonly inputHash: string;
  },
  SubscriptionResultEnvelope
> {
  readonly isolation = 'systemd-subscription-sandbox-v1' as const;
  calls = 0;

  constructor(
    private readonly result: SubscriptionResultEnvelope,
    private readonly preserveAttemptId = false
  ) {}

  async run(
    _profile: CodexExecutionProfile['sandbox'],
    invocation: { readonly attemptId: string },
    signal: AbortSignal
  ): Promise<SubscriptionResultEnvelope> {
    this.calls += 1;
    signal.throwIfAborted();
    return this.preserveAttemptId
      ? this.result
      : { ...this.result, attemptId: invocation.attemptId };
  }
}

function result(overrides: Partial<SubscriptionResultEnvelope> = {}): SubscriptionResultEnvelope {
  return {
    version: 1,
    adapter: 'codex',
    attemptId: randomUUID(),
    outcome: 'success',
    rawOutput: '{"classification":"product_niche","confidence":0.9}',
    clientExit: { code: 0, signal: null },
    ...overrides
  };
}

describe('CodexSubscriptionAdapter', () => {
  // Break: caller-provided model/args/environment alter the app-owned profile.
  it('uses one immutable fixed model args and empty environment', () => {
    const transport = new FakeTransport(result());
    const adapter = new CodexSubscriptionAdapter({ profile, transport });
    expect(adapter.profile.modelId).toBe('gpt-5.6');
    expect(adapter.profile.fixedClientArguments).toEqual([
      '--fixed-profile',
      'codex-subscription-v1'
    ]);
    expect(adapter.profile.environment).toEqual({});
    expect(Object.isFrozen(adapter.profile)).toBe(true);
    expect(Object.isFrozen(adapter.profile.binary)).toBe(true);
    expect(Object.isFrozen(adapter.profile.fixedClientArguments)).toBe(true);
  });

  // Break: disabled or mismatched profiles can execute the fake sandbox.
  it('fails closed until the exact profile is activated', async () => {
    const transport = new FakeTransport(result());
    const adapter = new CodexSubscriptionAdapter({ profile, transport });
    await expect(adapter.runRaw({
      role: 'niche_normalization',
      modelId: 'gpt-5.6',
      locale: 'en',
      prompt: 'normalize',
      inputHash: 'a'.repeat(64),
      schema: {},
      isRepair: false
    })).rejects.toMatchObject({ failureClass: 'profile_mismatch' });
    expect(transport.calls).toBe(0);
  });

  // Break: enabled execution bypasses transport framing or accepts another attempt's result.
  it('executes the enabled fixed profile and rejects an attempt-id mismatch', async () => {
    const enabledProfile = { ...profile, activation: 'enabled' as const };
    const request = {
      role: 'niche_normalization' as const,
      modelId: 'gpt-5.6',
      locale: 'en' as const,
      prompt: 'normalize',
      inputHash: 'a'.repeat(64),
      schema: {},
      isRepair: false
    };
    const transport = new FakeTransport(result());
    const adapter = new CodexSubscriptionAdapter({ profile: enabledProfile, transport });
    await expect(adapter.runRaw(request)).resolves.toMatchObject({
      providerId: 'codex-subscription-v1',
      modelId: 'gpt-5.6',
      rawOutput: { classification: 'product_niche', confidence: 0.9 },
      costClass: 'subscription'
    });
    const mismatched = new CodexSubscriptionAdapter({
      profile: enabledProfile,
      transport: new FakeTransport(result(), true)
    });
    await expect(mismatched.runRaw(request)).rejects.toMatchObject({
      failureClass: 'unsafe_unknown'
    });
  });

  // Break: runRaw drops cancellation or timeout before the sandbox transport boundary.
  it.each([
    [new DOMException('cancelled', 'AbortError'), 'cancelled_by_caller'],
    [new DOMException('timed out', 'TimeoutError'), 'timeout']
  ] as const)('propagates %s through the transport', async (reason, failureClass) => {
    const controller = new AbortController();
    controller.abort(reason);
    const adapter = new CodexSubscriptionAdapter({
      profile: { ...profile, activation: 'enabled' },
      transport: new FakeTransport(result())
    });
    await expect(adapter.runRaw({
      role: 'niche_normalization',
      modelId: 'gpt-5.6',
      locale: 'en',
      prompt: 'normalize',
      inputHash: 'a'.repeat(64),
      schema: {},
      isRepair: false
    }, controller.signal)).rejects.toMatchObject({ failureClass });
  });

  // Break: framing accepts trailing prose or multiple unrelated JSON values.
  it('strictly parses one normalization JSON object without trailing data', () => {
    expect(parseCodexNormalizationOutput('{"classification":"product_niche"}')).toEqual({
      classification: 'product_niche'
    });
    expect(() => parseCodexNormalizationOutput('{"classification":"product_niche"}\nextra')).toThrow();
    expect(() => parseCodexNormalizationOutput('{}{}')).toThrow();
  });

  // Break: sandbox failures collapse into an unclassified retry.
  it.each([
    ['AUTH_EXPIRED', 'auth_expired'],
    ['CREDENTIAL_SOURCE_MISMATCH', 'credential_source_mismatch'],
    ['CAPACITY_EXHAUSTED', 'capacity_exhausted'],
    ['RATE_LIMITED', 'rate_limited'],
    ['TRANSIENT_NETWORK', 'transient_network'],
    ['CLIENT_TRANSIENT', 'client_transient'],
    ['SCHEMA_INVALID_OUTPUT', 'schema_invalid_output'],
    ['BUSINESS_VALIDATION_FAILURE', 'business_validation_failure'],
    ['unknown', 'unsafe_unknown']
  ] as const)('classifies %s as %s', (rawOutput, failureClass) => {
    const error = CodexSubscriptionError.fromResult(result({
      outcome: 'failure',
      rawOutput,
      clientExit: { code: 1, signal: null }
    }));
    expect(error.failureClass).toBe(failureClass);
  });

  // Break: timeout and caller cancellation lose canonical failure identity.
  it.each([
    [new DOMException('timed out', 'TimeoutError'), 'timeout'],
    [new DOMException('cancelled', 'AbortError'), 'cancelled_by_caller']
  ] as const)('classifies transport %s', (cause, failureClass) => {
    expect(CodexSubscriptionError.fromCause(cause).failureClass).toBe(failureClass);
  });
});
