import { describe, expect, it } from 'vitest';
import type {
  AiModelDescriptor,
  AiRequest,
  BillingType,
  ProviderCapability
} from '@ara/shared';
import type { AiProvider, ProviderHealth } from './provider';
import {
  routeAiRequest,
  type ProviderCatalog,
  type ProviderCatalogEntry
} from './router';

const healthy: ProviderHealth = {
  available: true,
  checkedAt: new Date(0).toISOString(),
  reason: null,
  retryAfterSeconds: null
};

function provider(id: string, billingType: BillingType): AiProvider {
  return {
    id,
    billingType,
    health: async () => healthy,
    listModels: async () => [],
    runStructured: async () => {
      throw new Error('router test provider must not execute requests');
    }
  };
}

function model(
  providerId: string,
  id: string,
  billingType: BillingType,
  qualityRank: number,
  capabilities: readonly ProviderCapability[] = ['structured_json']
): AiModelDescriptor {
  return {
    providerId,
    id,
    displayName: id,
    capabilities: [...capabilities],
    billingType,
    qualityRank
  };
}

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    role: 'niche_normalization',
    routerMode: 'Balanced',
    locale: 'ko',
    allowPaidFallback: false,
    paidPrimaryProviderIds: [],
    requiredCapabilities: ['structured_json'],
    excludeProviderIds: [],
    payload: { keyword: 'batter squeeze bottle' },
    ...overrides
  };
}

function catalog(entries: readonly ProviderCatalogEntry[]): ProviderCatalog {
  return { entries };
}

describe('AI routing policy', () => {
  it('defers instead of selecting pay-as-you-go when fallback is disabled', () => {
    const payg = provider('payg', 'payg');
    const decision = routeAiRequest(
      request(),
      catalog([
        {
          provider: payg,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: healthy,
          models: [model('payg', 'paid-model', 'payg', 1)]
        }
      ])
    );

    expect(decision.kind).toBe('defer');
    if (decision.kind === 'defer') {
      expect(decision.reason).toBe('WAITING_FOR_AI_CAPACITY');
    }
  });

  // Break: changing the provider to payg leaves subscription models routable.
  it('does not route a payg provider whose stored models still say subscription', () => {
    const converted = provider('converted', 'payg');
    const blocked = routeAiRequest(
      request({ allowPaidFallback: false }),
      catalog([
        {
          provider: converted,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: healthy,
          models: [model('converted', 'kept-model', 'subscription', 1)]
        }
      ])
    );
    const allowed = routeAiRequest(
      request({ allowPaidFallback: true }),
      catalog([
        {
          provider: converted,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: healthy,
          models: [model('converted', 'kept-model', 'subscription', 1)]
        }
      ])
    );

    expect(blocked.kind).toBe('defer');
    expect(allowed.kind).toBe('route');
    if (allowed.kind === 'route') {
      expect(allowed.providerId).toBe('converted');
    }
  });

  it('routes an explicitly nominated payg primary without enabling fallback', () => {
    const payg = provider('custom-openai', 'payg');
    const subscription = provider('subscription', 'subscription');
    const decision = routeAiRequest(
      request({ paidPrimaryProviderIds: ['custom-openai'] }),
      catalog([
        {
          provider: subscription,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 0,
          health: healthy,
          models: [model('subscription', 'subscription-model', 'subscription', 0)]
        },
        {
          provider: payg,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 100,
          health: healthy,
          models: [model('custom-openai', 'custom-model', 'payg', 100)]
        }
      ])
    );

    expect(decision).toMatchObject({ kind: 'route', providerId: 'custom-openai' });
  });

  // Break: routing returns a model or billing identity owned by a different provider entry.
  it('preserves provider, model, and billing ownership while applying role priority', () => {
    const preferred = provider('preferred', 'subscription');
    const cheaper = provider('cheaper', 'free');
    const decision = routeAiRequest(
      request(),
      catalog([
        {
          provider: preferred,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          rolePriority: { niche_normalization: 1 },
          health: healthy,
          models: [model('preferred', 'preferred-model', 'subscription', 10)]
        },
        {
          provider: cheaper,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 2,
          rolePriority: { niche_normalization: 2 },
          health: healthy,
          models: [model('cheaper', 'free-model', 'free', 10)]
        }
      ])
    );

    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.providerId).toBe('preferred');
      expect(decision.provider.billingType).toBe('subscription');
      expect(decision.model).toMatchObject({
        providerId: 'preferred',
        id: 'preferred-model',
        billingType: 'subscription'
      });
    }
  });

  it('uses Saver mode to choose the lowest-cost capable healthy model', () => {
    const subscription = provider('subscription', 'subscription');
    const free = provider('free', 'free');
    const decision = routeAiRequest(
      request({ routerMode: 'Saver' }),
      catalog([
        {
          provider: subscription,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: healthy,
          models: [model('subscription', 'subscription-model', 'subscription', 1)]
        },
        {
          provider: free,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 2,
          health: healthy,
          models: [model('free', 'free-model', 'free', 200)]
        }
      ])
    );

    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.providerId).toBe('free');
    }
  });

  it('filters unavailable and incapable models before applying cost policy', () => {
    const unavailable = provider('unavailable', 'free');
    const healthyProvider = provider('healthy', 'subscription');
    const decision = routeAiRequest(
      request({ requiredCapabilities: ['responses'] }),
      catalog([
        {
          provider: unavailable,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: { ...healthy, available: false, reason: 'outage' },
          models: [model('unavailable', 'wrong-capability', 'free', 1)]
        },
        {
          provider: healthyProvider,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 2,
          health: healthy,
          models: [model('healthy', 'responses-model', 'subscription', 1, ['responses'])]
        }
      ])
    );

    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.model.id).toBe('responses-model');
    }
  });

  it('does not route a provider outside its assigned roles', () => {
    const providerInstance = provider('classification-only', 'free');
    const decision = routeAiRequest(
      request(),
      catalog([
        {
          provider: providerInstance,
          enabled: true,
          roles: ['bulk_classification'],
          priority: 1,
          health: healthy,
          models: [model('classification-only', 'model', 'free', 1)]
        }
      ])
    );

    expect(decision).toMatchObject({
      kind: 'defer',
      reason: 'WAITING_FOR_AI_CAPACITY'
    });
  });

  it('treats an empty role assignment as ineligible', () => {
    const unassigned = provider('unassigned', 'free');
    const decision = routeAiRequest(
      request(),
      catalog([
        {
          provider: unassigned,
          enabled: true,
          roles: [],
          priority: 1,
          health: healthy,
          models: [model('unassigned', 'model', 'free', 1)]
        }
      ])
    );

    expect(decision).toMatchObject({ kind: 'defer', checkedProviderIds: [] });
  });

  it('excludes explicitly blocked providers from routing', () => {
    const blocked = provider('blocked', 'free');
    const decision = routeAiRequest(
      request({ excludeProviderIds: ['blocked'] }),
      catalog([
        {
          provider: blocked,
          enabled: true,
          roles: ['niche_normalization'],
          priority: 1,
          health: healthy,
          models: [model('blocked', 'model', 'free', 1)]
        }
      ])
    );

    expect(decision).toMatchObject({ kind: 'defer', checkedProviderIds: [] });
  });

  it('requires strong cross-validation to use another provider', () => {
    const primary = provider('primary', 'subscription');
    const independent = provider('independent', 'subscription');
    const decision = routeAiRequest(
      request({
        role: 'strong_cross_validation',
        primaryProviderId: 'primary'
      }),
      catalog([
        {
          provider: primary,
          enabled: true,
          roles: ['strong_cross_validation'],
          priority: 1,
          health: healthy,
          models: [model('primary', 'primary-model', 'subscription', 1)]
        },
        {
          provider: independent,
          enabled: true,
          roles: ['strong_cross_validation'],
          priority: 2,
          health: healthy,
          models: [model('independent', 'independent-model', 'subscription', 2)]
        }
      ])
    );

    expect(decision).toMatchObject({
      kind: 'route',
      providerId: 'independent'
    });
  });

  // Break: Highest Quality accidentally applies billing or provider priority before quality.
  it('uses exact Highest Quality ordering before priority and billing', () => {
    const lowerPriority = provider('lower-priority', 'free');
    const higherQuality = provider('higher-quality', 'subscription');
    const decision = routeAiRequest(
      request({ routerMode: 'Highest Quality' }),
      catalog([
        {
          provider: lowerPriority,
          enabled: true,
          priority: 1,
          roles: ['niche_normalization'],
          health: healthy,
          models: [model(lowerPriority.id, 'lower-priority-model', 'free', 20)]
        },
        {
          provider: higherQuality,
          enabled: true,
          priority: 100,
          roles: ['niche_normalization'],
          health: healthy,
          models: [model(higherQuality.id, 'higher-quality-model', 'subscription', 1)]
        }
      ])
    );
    expect(decision).toMatchObject({
      kind: 'route',
      providerId: 'higher-quality',
      model: { id: 'higher-quality-model' }
    });
  });
});
