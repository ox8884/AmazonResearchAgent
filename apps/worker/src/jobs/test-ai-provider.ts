import { createProviderRepository } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import { assertPersistableModelId, UnsafeModelIdError } from '@ara/shared';
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

  let discovered;
  try {
    discovered = await adapter.listModels();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return unavailableResult(providerId, started, 'provider_unavailable');
    }
    throw error;
  }

  const repository = createProviderRepository(client);
  const provider = await repository.findProvider(providerId);
  if (!provider) {
    return unavailableResult(providerId, started, 'provider_not_found');
  }
  const existing = await repository.listModels(providerId);
  const enabledById = new Map(
    existing.map((model) => [model.model_id, model.enabled])
  );
  try {
    await repository.saveSettings({
      provider,
      secret: null,
      models: discovered.map((model) => {
        const modelId = assertPersistableModelId(model.id);
        return {
          provider_id: providerId,
          model_id: modelId,
          display_name: model.displayName,
          capabilities: [...model.capabilities],
          billing_type: model.billingType,
          quality_rank: model.qualityRank,
          enabled: enabledById.get(modelId) ?? true,
          origin: 'discovered'
        };
      }),
      reconcileMode: 'discovery'
    });
  } catch (error: unknown) {
    if (error instanceof UnsafeModelIdError || error instanceof Error) {
      return unavailableResult(providerId, started, 'provider_misconfigured');
    }
    throw error;
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
