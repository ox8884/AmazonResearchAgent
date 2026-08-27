import {
  type AiModelDescriptor,
  type AiRequest,
  type AiRole,
  type BillingType,
  type ProviderCapability
} from '@ara/shared';
import type {
  AiProvider,
  ProviderHealth
} from './provider';

export interface ProviderCatalogEntry {
  readonly provider: AiProvider;
  readonly enabled: boolean;
  readonly priority: number;
  readonly roles?: readonly AiRole[];
  readonly rolePriority?: Partial<Record<AiRole, number>>;
  readonly health: ProviderHealth;
  readonly models: readonly AiModelDescriptor[];
}

export interface ProviderCatalog {
  readonly entries: readonly ProviderCatalogEntry[];
}

export interface RouteSelection {
  readonly kind: 'route';
  readonly provider: AiProvider;
  readonly providerId: string;
  readonly model: AiModelDescriptor;
  readonly reason: 'SELECTED_BY_POLICY';
}

export interface RouteDeferral {
  readonly kind: 'defer';
  readonly reason: 'WAITING_FOR_AI_CAPACITY';
  readonly checkedProviderIds: readonly string[];
}

export type RouteDecision = RouteSelection | RouteDeferral;

interface RouteCandidate {
  readonly entry: ProviderCatalogEntry;
  readonly model: AiModelDescriptor;
  readonly rolePriority: number;
  readonly billingRank: number;
}

function billingRank(billingType: BillingType): number {
  if (billingType === 'free') {
    return 0;
  }
  if (billingType === 'subscription') {
    return 1;
  }
  return 2;
}

function supportsCapabilities(
  model: AiModelDescriptor,
  required: readonly ProviderCapability[]
): boolean {
  return required.every((capability) => model.capabilities.includes(capability));
}

function compareCandidates(
  mode: AiRequest['routerMode'],
  left: RouteCandidate,
  right: RouteCandidate
): number {
  const byNumber = (a: number, b: number): number => a - b;
  if (mode === 'Saver') {
    return (
      byNumber(left.billingRank, right.billingRank) ||
      byNumber(left.rolePriority, right.rolePriority) ||
      byNumber(left.model.qualityRank, right.model.qualityRank)
    );
  }
  if (mode === 'Highest Quality') {
    return (
      byNumber(left.model.qualityRank, right.model.qualityRank) ||
      byNumber(left.rolePriority, right.rolePriority) ||
      byNumber(left.billingRank, right.billingRank)
    );
  }
  return (
    byNumber(left.rolePriority, right.rolePriority) ||
    byNumber(left.billingRank, right.billingRank) ||
    byNumber(left.model.qualityRank, right.model.qualityRank)
  );
}

export function routeAiRequest(
  request: AiRequest,
  catalog: ProviderCatalog
): RouteDecision {
  const candidates: RouteCandidate[] = [];
  const checkedProviderIds: string[] = [];
  const excludedProviderIds = new Set(request.excludeProviderIds);
  if (
    request.role === 'strong_cross_validation' &&
    request.primaryProviderId
  ) {
    excludedProviderIds.add(request.primaryProviderId);
  }
  for (const entry of catalog.entries) {
    if (excludedProviderIds.has(entry.provider.id)) {
      continue;
    }
    if (!entry.roles || !entry.roles.includes(request.role)) {
      continue;
    }
    checkedProviderIds.push(entry.provider.id);
    if (!entry.enabled || !entry.health.available) {
      continue;
    }
    for (const model of entry.models) {
      if (!supportsCapabilities(model, request.requiredCapabilities)) {
        continue;
      }
      if (model.billingType === 'payg' && !request.allowPaidFallback) {
        continue;
      }
      candidates.push({
        entry,
        model,
        rolePriority: entry.rolePriority?.[request.role] ?? entry.priority,
        billingRank: billingRank(model.billingType)
      });
    }
  }

  candidates.sort((left, right) => {
    const policyOrder = compareCandidates(request.routerMode, left, right);
    return (
      policyOrder ||
      left.entry.provider.id.localeCompare(right.entry.provider.id, 'en') ||
      left.model.id.localeCompare(right.model.id, 'en')
    );
  });
  const selected = candidates[0];
  if (!selected) {
    return {
      kind: 'defer',
      reason: 'WAITING_FOR_AI_CAPACITY',
      checkedProviderIds
    };
  }

  return {
    kind: 'route',
    provider: selected.entry.provider,
    providerId: selected.entry.provider.id,
    model: selected.model,
    reason: 'SELECTED_BY_POLICY'
  };
}
