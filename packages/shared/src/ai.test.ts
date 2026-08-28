import { describe, expect, it } from 'vitest';
import {
  AiRequestSchema,
  AiRoleSchema,
  assertPersistableModelId,
  BillingTypeSchema,
  ModelIdSchema,
  ProviderCapabilitySchema,
  ProviderKindSchema,
  RouterModeSchema,
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

});
