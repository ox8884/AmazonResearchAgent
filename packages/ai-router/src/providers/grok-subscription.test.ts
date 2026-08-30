import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGrokSubscriptionFixtureProfile,
  GrokSubscriptionAdapter,
  GrokSubscriptionError,
  parseGrokNormalizationOutput,
  type GrokExecutionProfile
} from './grok-subscription';
import type {
  SubscriptionProcessTransport,
  SubscriptionResultEnvelope
} from './subscription-process';

class FakeTransport implements SubscriptionProcessTransport<
  GrokExecutionProfile['sandbox'],
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
  readonly attemptIds: string[] = [];

  constructor(
    private readonly result: SubscriptionResultEnvelope,
    private readonly preserveAttemptId = false
  ) {}

  async run(
    _profile: GrokExecutionProfile['sandbox'],
    invocation: { readonly attemptId: string },
    signal: AbortSignal
  ): Promise<SubscriptionResultEnvelope> {
    this.calls += 1;
    this.attemptIds.push(invocation.attemptId);
    signal.throwIfAborted();
    return this.preserveAttemptId
      ? this.result
      : { ...this.result, attemptId: invocation.attemptId };
  }
}

function result(overrides: Partial<SubscriptionResultEnvelope> = {}): SubscriptionResultEnvelope {
  return {
    version: 1,
    adapter: 'grok',
    attemptId: randomUUID(),
    outcome: 'success',
    rawOutput: '{"classification":"product_niche","confidence":0.8}',
    clientExit: { code: 0, signal: null },
    ...overrides
  };
}

const request = {
  attemptId: '00000000-0000-4000-8000-000000000401',
  role: 'niche_normalization' as const,
  modelId: 'grok-fixture-model',
  locale: 'en' as const,
  prompt: 'normalize',
  inputHash: 'b'.repeat(64),
  schema: {},
  isRepair: false
};

describe('GrokSubscriptionAdapter', () => {
  // Break: Task-8 tests accidentally exercise a guessed production client identity.
  it('uses an explicit immutable fixture profile without accepting it for production', () => {
    const profile = createGrokSubscriptionFixtureProfile('grok-fixture-model');
    expect(profile.activation).toBe('enabled');
    expect(profile.fixedClientArguments).toEqual([
      '--fixed-profile',
      'grok-subscription-v1'
    ]);
    expect(profile.environment).toEqual({});
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.binary)).toBe(true);
  });

  // Break: Grok reuses Codex adapter identity or accepts another attempt's result.
  it('executes only the Grok fixture identity and rejects attempt mismatch', async () => {
    const profile = createGrokSubscriptionFixtureProfile('grok-fixture-model');
    const adapter = new GrokSubscriptionAdapter({
      profile,
      transport: new FakeTransport(result())
    });
    await expect(adapter.runAuthorizedRaw(request)).resolves.toMatchObject({
      providerId: 'grok-subscription-v1',
      modelId: 'grok-fixture-model',
      rawOutput: { classification: 'product_niche', confidence: 0.8 },
      costClass: 'subscription'
    });
    const mismatched = new GrokSubscriptionAdapter({
      profile,
      transport: new FakeTransport(result(), true)
    });
    await expect(mismatched.runAuthorizedRaw(request)).rejects.toMatchObject({
      failureClass: 'unsafe_unknown'
    });
  });

  // Break: Grok execution replaces the DB-authorized identity with an adapter UUID.
  it('uses the caller-authorized attempt UUID as the exact transport identity', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000456';
    const transport = new FakeTransport(result());
    const adapter = new GrokSubscriptionAdapter({
      profile: createGrokSubscriptionFixtureProfile('grok-fixture-model'),
      transport
    });
    await expect(adapter.runAuthorizedRaw({
      ...request,
      attemptId
    })).resolves.toMatchObject({ providerId: 'grok-subscription-v1' });
    expect(transport.attemptIds).toEqual([attemptId]);
  });

  // Break: Grok framing accepts arrays, trailing prose, or multiple JSON values.
  it('strictly parses one Grok normalization object', () => {
    expect(parseGrokNormalizationOutput('{"classification":"product_niche"}')).toEqual({
      classification: 'product_niche'
    });
    expect(() => parseGrokNormalizationOutput('[]')).toThrow();
    expect(() => parseGrokNormalizationOutput('{}\nextra')).toThrow();
    expect(() => parseGrokNormalizationOutput('{}{}')).toThrow();
  });

  // Break: Grok-specific client failures collapse into Codex semantics.
  it.each([
    ['OAUTH_EXPIRED', 'auth_expired'],
    ['CREDENTIAL_SOURCE_MISMATCH', 'credential_source_mismatch'],
    ['CAPACITY_EXHAUSTED', 'capacity_exhausted'],
    ['RATE_LIMITED', 'rate_limited'],
    ['TRANSIENT_NETWORK', 'transient_network'],
    ['CLIENT_TRANSIENT', 'client_transient'],
    ['SCHEMA_INVALID_OUTPUT', 'schema_invalid_output'],
    ['BUSINESS_VALIDATION_FAILURE', 'business_validation_failure'],
    ['unknown', 'unsafe_unknown']
  ] as const)('classifies %s as %s', (rawOutput, failureClass) => {
    const error = GrokSubscriptionError.fromResult(result({
      outcome: 'failure',
      rawOutput,
      clientExit: { code: 1, signal: null }
    }));
    expect(error.failureClass).toBe(failureClass);
  });

  // Break: cancellation and timeout are not carried across the sandbox boundary.
  it.each([
    [new DOMException('cancelled', 'AbortError'), 'cancelled_by_caller'],
    [new DOMException('timed out', 'TimeoutError'), 'timeout']
  ] as const)('propagates %s through the transport', async (reason, failureClass) => {
    const controller = new AbortController();
    controller.abort(reason);
    const adapter = new GrokSubscriptionAdapter({
      profile: createGrokSubscriptionFixtureProfile('grok-fixture-model'),
      transport: new FakeTransport(result())
    });
    await expect(adapter.runAuthorizedRaw(request, controller.signal)).rejects.toMatchObject({
      failureClass
    });
  });
  it('rejects a malformed authorized attempt UUID before transport', async () => {
    const transport = new FakeTransport(result());
    const adapter = new GrokSubscriptionAdapter({
      profile: createGrokSubscriptionFixtureProfile('grok-fixture-model'),
      transport
    });
    await expect(adapter.runAuthorizedRaw({
      ...request,
      attemptId: 'not-an-attempt-uuid'
    })).rejects.toBeDefined();
    expect(transport.calls).toBe(0);
  });
});
