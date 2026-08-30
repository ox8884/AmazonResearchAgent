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
  loadPersistedProviderSnapshot,
  type PersistedProviderCatalogOptions
} from '../providers/provider-catalog';
import { decryptSecret, getEncryptionKeyFromEnvironment } from '@ara/secret-store';



export interface ProviderTestOptions extends PersistedProviderCatalogOptions {
  afterSnapshot?(): Promise<void>;
  beforePersist?(): Promise<void>;
}



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
  options: ProviderTestOptions = {}
): Promise<ProviderTestResult> {
  const started = Date.now();
  let snapshot;
  try {
    snapshot = await loadPersistedProviderSnapshot(client, providerId, options);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return unavailableResult(providerId, started, 'provider_misconfigured');
    }
    throw error;
  }
  if (!snapshot) {
    return unavailableResult(providerId, started, 'provider_not_found');
  }
  await options.afterSnapshot?.();

  const repository = createProviderRepository(client);
  const adapter = snapshot.adapter;
  const provider = snapshot.provider;
  const existing = snapshot.models;
  const secretRow = snapshot.secret;
  const fingerprint = snapshot.fingerprint;
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



  async function persistProbe(
    available: boolean,
    errorCategory: string | null
  ): Promise<void> {
    await options.beforePersist?.();
    const checkedAt = new Date().toISOString();
    await repository.recordHttpExecutionProbe({
      providerId,
      expectedFingerprint: fingerprint,
      probe: {
        available,
        checkedAt,
        errorCategory,
        fingerprint
      }
    });
  }

  const health = await adapter.health();
  const needsExecutionProbe = health.reason === TEST_CONNECTION_REQUIRED;
  if (!health.available && !needsExecutionProbe) {
    await persistProbe(false, 'provider_unavailable');
    return unavailableResult(providerId, started, 'provider_unavailable');
  }

  let discovered;
  try {
    discovered = await adapter.listModels();
  } catch (error: unknown) {
    if (error instanceof Error) {
      await persistProbe(false, 'provider_unavailable');
      return unavailableResult(providerId, started, 'provider_unavailable');
    }
    throw error;
  }

  const probeModelId = discovered[0]?.id;
  if (needsExecutionProbe) {
    if (!probeModelId) {
      await persistProbe(false, 'provider_misconfigured');
      return unavailableResult(providerId, started, 'provider_misconfigured');
    }
    try {
      await probeExecution(adapter, probeModelId);
    } catch (error: unknown) {
      const category = executionErrorCategory(error);
      await persistProbe(false, category);
      return unavailableResult(providerId, started, category);
    }
  }

  const enabledById = new Map(existing.map((model) => [model.model_id, model.enabled]));
  const priorityById = new Map(existing.map((model) => [model.model_id, model.priority]));
  const originById = new Map(existing.map((model) => [model.model_id, model.origin]));
  const reconcileMode = needsExecutionProbe ? 'manual' : 'discovery';
  const checkedAt = new Date().toISOString();

  try {
    await repository.saveSettings({
      provider,
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
      reconcileMode,
      expectedRevision: provider.settings_revision
    });
    await persistProbe(true, null);
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

