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
    requiredCapabilities: ['structured_json'],
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

  it('selects the configured role priority before a lower-cost later provider', () => {
    const preferred = provider('preferred', 'subscription');
    const cheaper = provider('cheaper', 'free');
    const decision = routeAiRequest(
      request(),
      catalog([
        {
          provider: preferred,
          enabled: true,
          priority: 1,
          rolePriority: { niche_normalization: 1 },
          health: healthy,
          models: [model('preferred', 'preferred-model', 'subscription', 10)]
        },
        {
          provider: cheaper,
          enabled: true,
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
      expect(decision.model.id).toBe('preferred-model');
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
          priority: 1,
          health: healthy,
          models: [model('subscription', 'subscription-model', 'subscription', 1)]
        },
        {
          provider: free,
          enabled: true,
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
          priority: 1,
          health: { ...healthy, available: false, reason: 'outage' },
          models: [model('unavailable', 'wrong-capability', 'free', 1)]
        },
        {
          provider: healthyProvider,
          enabled: true,
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
          priority: 1,
          roles: ['bulk_classification'],
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
});
