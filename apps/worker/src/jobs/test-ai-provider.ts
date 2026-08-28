import { createProviderRepository } from '@ara/db';
import type { QueueDatabaseClient } from '@ara/queue';
import { assertPersistableModelId, UnsafeModelIdError } from '@ara/shared';
import { KeywordNormalizationSchema } from '@ara/research-engine';
import {
  OpenAiHttpError,
  TEST_CONNECTION_REQUIRED,
  type AiProvider
} from '@ara/ai-router';
import {
  instantiatePersistedProvider,
  type PersistedProviderCatalogOptions
} from '../providers/provider-catalog';
import { decryptSecret, getEncryptionKeyFromEnvironment } from '@ara/secret-store';

export interface ProviderTestResult {
  readonly providerId: string;
  readonly available: boolean;
  readonly healthCategory: 'healthy' | 'unavailable';
  readonly models: readonly string[];
  readonly latencyMs: number;
  readonly errorCategory: string | null;
  readonly checkedAt: string;
}

async function probeExecution(adapter: AiProvider, modelId: string): Promise<void> {
  await adapter.runStructured({
    role: 'niche_normalization',
    modelId,
    locale: 'en',
    prompt: 'Return a valid niche normalization JSON object.',
    inputHash: 'e'.repeat(64),
    schema: KeywordNormalizationSchema
  });
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

function executionErrorCategory(error: unknown): string {
  if (error instanceof OpenAiHttpError) {
    if (error.status === 401 || error.status === 403) {
      return 'provider_unauthorized';
    }
    if (error.retryable) {
      return 'provider_unavailable';
    }
  }
  if (error instanceof Error) {
    return 'provider_unavailable';
  }
  throw error;
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

  const repository = createProviderRepository(client);
  const provider = await repository.findProvider(providerId);
  if (!provider) {
    return unavailableResult(providerId, started, 'provider_not_found');
  }
  const existing = await repository.listModels(providerId);
  const secretRow = await repository.findSecret(providerId);
  let secretPlaintext: string | undefined;
  if (secretRow) {
    secretPlaintext = decryptSecret(
      {
        ciphertext: secretRow.ciphertext,
        iv: secretRow.iv,
        authTag: secretRow.auth_tag,
        last4: secretRow.last4
      },
      options.encryptionKey ?? getEncryptionKeyFromEnvironment()
    );
  }

  const health = await adapter.health();
  const needsExecutionProbe = health.reason === TEST_CONNECTION_REQUIRED;
  if (!health.available && !needsExecutionProbe) {
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

  const probeModelId = discovered[0]?.id;
  if (needsExecutionProbe) {
    if (!probeModelId) {
      return unavailableResult(providerId, started, 'provider_misconfigured');
    }
    try {
      await probeExecution(adapter, probeModelId);
    } catch (error: unknown) {
      return unavailableResult(providerId, started, executionErrorCategory(error));
    }
  }

  const enabledById = new Map(existing.map((model) => [model.model_id, model.enabled]));
  const priorityById = new Map(existing.map((model) => [model.model_id, model.priority]));
  const originById = new Map(existing.map((model) => [model.model_id, model.origin]));
  const reconcileMode = needsExecutionProbe ? 'manual' : 'discovery';
  const checkedAt = new Date().toISOString();
  const config =
    typeof provider.config === 'object' &&
    provider.config !== null &&
    !Array.isArray(provider.config)
      ? provider.config
      : {};

  try {
    await repository.saveSettings({
      provider: {
        ...provider,
        config: {
          ...config,
          executionProbe: {
            available: true,
            checkedAt,
            errorCategory: null
          }
        }
      },
      secret: null,
      models: discovered.map((model) => {
        const modelId = assertPersistableModelId(model.id, secretPlaintext);
        return {
          provider_id: providerId,
          model_id: modelId,
          display_name: model.displayName,
          capabilities: [...model.capabilities],
          billing_type: model.billingType,
          quality_rank: model.qualityRank,
          enabled: enabledById.get(modelId) ?? true,
          priority: priorityById.get(modelId) ?? 100,
          origin: originById.get(modelId) === 'manual' ? 'manual' : reconcileMode === 'manual' ? 'manual' : 'discovered'
        };
      }),
      reconcileMode
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
    checkedAt
  };
}
