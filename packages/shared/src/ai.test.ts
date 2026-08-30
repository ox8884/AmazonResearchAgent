import { describe, expect, it } from 'vitest';
import {
  AiProviderConfigSchema,
  AiRequestSchema,
  AiRoleSchema,
  assertPersistableModelId,
  BillingTypeSchema,
  ModelIdSchema,
  NormalizeOpportunitiesJobPayloadSchema,
  ProviderAttemptEventTypeSchema,
  ProviderCapabilitySchema,
  ProviderConsumptionStatusSchema,
  ProviderKindSchema,
  ProviderRuntimeStateSchema,
  RouterModeSchema,
  SubscriptionAdapterSchema,
  SubscriptionFailureClassSchema,
  UnsafeModelIdError
} from './ai';


describe('AI provider schemas', () => {
  it('accepts every configured AI role and routing mode', () => {
    expect(AiRoleSchema.parse('niche_normalization')).toBe('niche_normalization');
    expect(RouterModeSchema.parse('Balanced')).toBe('Balanced');
    expect(BillingTypeSchema.parse('subscription')).toBe('subscription');
    expect(ProviderKindSchema.parse('openai_http')).toBe('openai_http');
    expect(ProviderCapabilitySchema.parse('structured_json')).toBe('structured_json');
  });

  it('preserves an explicit paid-fallback decision', () => {
    const request = AiRequestSchema.parse({
      role: 'niche_normalization',
      routerMode: 'Balanced',
      locale: 'ko',
      allowPaidFallback: false,
      payload: { keyword: 'batter squeeze bottle' }
    });

    expect(request.allowPaidFallback).toBe(false);
    expect(request.payload).toEqual({ keyword: 'batter squeeze bottle' });
  });

  it('defaults structured output and rejects unsupported provider values', () => {
    const request = AiRequestSchema.parse({
      role: 'bulk_classification',
      routerMode: 'Saver',
      locale: 'en',
      payload: { keyword: 'pancake dispenser bottle' }
    });

    expect(request.requiredCapabilities).toEqual(['structured_json']);
    expect(() => AiRoleSchema.parse('unknown_role')).toThrow();
    expect(() => ProviderKindSchema.parse('shell')).toThrow();
  });
  // Break: new or misspelled subscription failures become routable defaults.
  it('parses only canonical subscription failure classes', () => {
    expect(SubscriptionFailureClassSchema.parse('auth_expired')).toBe('auth_expired');
    expect(SubscriptionFailureClassSchema.parse('process_spawn_failure_pre_consumption')).toBe(
      'process_spawn_failure_pre_consumption'
    );
    expect(() => SubscriptionFailureClassSchema.parse('unknown')).toThrow();
    expect(() => SubscriptionFailureClassSchema.parse('auth_error')).toThrow();
  });

  // Break: arbitrary adapter names reach worker-owned subscription dispatch.
  it('parses only codex and grok subscription adapters', () => {
    expect(SubscriptionAdapterSchema.options).toEqual(['codex', 'grok']);
    expect(() => SubscriptionAdapterSchema.parse('claude')).toThrow();
  });

  // Break: subscription rows omit their adapter, use PAYG, or persist execution controls.
  it('requires subscription kind adapter and subscription billing', () => {
    expect(
      AiProviderConfigSchema.parse({
        id: 'provider-codex',
        name: 'Codex Subscription',
        kind: 'subscription_command',
        adapter: 'codex',
        billingType: 'subscription',
        enabled: false,
        priority: 10,
        config: {
          role: 'niche_normalization',
          modelId: 'codex-subscription',
          modelEnabled: false,
          modelPriority: 10
        }
      }).adapter
    ).toBe('codex');
    for (const invalid of [
      { adapter: undefined, billingType: 'subscription' },
      { adapter: 'codex', billingType: 'payg' },
      { adapter: 'grok', billingType: 'free' }
    ]) {
      expect(() =>
        AiProviderConfigSchema.parse({
          id: 'provider-invalid',
          name: 'Invalid Subscription',
          kind: 'subscription_command',
          enabled: false,
          priority: 10,
          config: {
            role: 'niche_normalization',
            modelId: 'subscription-model',
            modelEnabled: false,
            modelPriority: 10
          },
          ...invalid
        })
      ).toThrow();
    }
    expect(() =>
      AiProviderConfigSchema.parse({
        id: 'provider-unsafe',
        name: 'Unsafe Subscription',
        kind: 'subscription_command',
        adapter: 'grok',
        billingType: 'subscription',
        enabled: false,
        priority: 10,
        config: {
          role: 'niche_normalization',
          modelId: 'grok-subscription',
          modelEnabled: false,
          modelPriority: 10,
          executable: '/usr/bin/grok'
        }
      })
    ).toThrow();
  });

  it('exports the canonical runtime and attempt state sets', () => {
    expect(ProviderRuntimeStateSchema.options).toEqual([
      'authorization_required',
      'ready',
      'expired',
      'needs_attention'
    ]);
    expect(ProviderAttemptEventTypeSchema.parse('attempt_unknown_after_crash')).toBe(
      'attempt_unknown_after_crash'
    );
    expect(ProviderConsumptionStatusSchema.options).toEqual([
      'consumed',
      'not_consumed',
      'unknown'
    ]);
  });

  it('rejects control characters, overlong IDs, and secret reflection', () => {
    expect(ModelIdSchema.parse('gpt-4.1-mini')).toBe('gpt-4.1-mini');
    expect(() => ModelIdSchema.parse('a'.repeat(201))).toThrow();
    expect(() => ModelIdSchema.parse('bad\nid')).toThrow();
    expect(() => assertPersistableModelId('super-secret', 'super-secret')).toThrow(
      UnsafeModelIdError
    );
    expect(() =>
      assertPersistableModelId(
        'model-settings-api-secret-value',
        'settings-api-secret-value'
      )
    ).toThrow(UnsafeModelIdError);
    expect(assertPersistableModelId('model-ab', 'ab')).toBe('model-ab');
  });

  // Break: a legacy or multi-candidate payload reaches the canonical writer.
  it('requires one candidate and a canonical normalization generation', () => {
    expect(NormalizeOpportunitiesJobPayloadSchema.parse({
      candidateIds: ['00000000-0000-4000-8000-000000000001'],
      locale: 'ko',
      normalizationGeneration: 0
    })).toMatchObject({ normalizationGeneration: 0 });
    expect(() => NormalizeOpportunitiesJobPayloadSchema.parse({
      candidateIds: ['00000000-0000-4000-8000-000000000001'],
      locale: 'ko'
    })).toThrow();
    expect(() => NormalizeOpportunitiesJobPayloadSchema.parse({
      candidateIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'
      ],
      locale: 'ko',
      normalizationGeneration: 0
    })).toThrow();
  });

});
