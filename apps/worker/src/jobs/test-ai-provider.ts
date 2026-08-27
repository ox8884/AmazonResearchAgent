import { createProviderRepository } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  instantiatePersistedProvider,
  type PersistedProviderCatalogOptions
} from '../providers/provider-catalog';

export interface ProviderTestResult {
  readonly providerId: string;
  readonly available: boolean;
  readonly healthCategory: 'healthy' | 'unavailable';
  readonly models: readonly string[];
  readonly latencyMs: number;
  readonly errorCategory: string | null;
  readonly checkedAt: string;
}

function unavailableResult(
  providerId: string,
  started: number,
  errorCategory: string
): ProviderTestResult {
  return {
    providerId,
    available: false,
    healthCategory: 'unavailable',
    models: [],
    latencyMs: Date.now() - started,
    errorCategory,
    checkedAt: new Date().toISOString()
  };
}

export async function runProviderConnectionTest(
  providerId: string,
  client: QueueDatabaseClient,
  options: PersistedProviderCatalogOptions = {}
): Promise<ProviderTestResult> {
  const started = Date.now();
  let adapter;
  try {
    adapter = await instantiatePersistedProvider(client, providerId, options);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return unavailableResult(providerId, started, 'provider_misconfigured');
    }
    throw error;
  }
  if (!adapter) {
    return unavailableResult(providerId, started, 'provider_not_found');
  }

  const health = await adapter.health();
  if (!health.available) {
    return unavailableResult(providerId, started, 'provider_unavailable');
  }

  const discovered = await adapter.listModels();
  const repository = createProviderRepository(client);
  const existing = await repository.listModels(providerId);
  const enabledById = new Map(
    existing.map((model) => [model.model_id, model.enabled])
  );
  for (const model of discovered) {
    await repository.upsertModel({
      provider_id: providerId,
      model_id: model.id,
      display_name: model.displayName,
      capabilities: [...model.capabilities],
      billing_type: model.billingType,
      quality_rank: model.qualityRank,
      enabled: enabledById.get(model.id) ?? true
    });
  }

  return {
    providerId,
    available: true,
    healthCategory: 'healthy',
    models: discovered.map((model) => model.id),
    latencyMs: Date.now() - started,
    errorCategory: null,
    checkedAt: new Date().toISOString()
  };
}
