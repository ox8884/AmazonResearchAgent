import {
  CommandProvider,
  OpenAiHttpProvider,
  type AiProvider,
  type ProviderCatalog,
  type ProviderCatalogEntry
} from '@ara/ai-router';
import {
  createProviderRepository,
  type Json,
  type ModelRow,
  type ProviderRow,
  type ProviderSecretRow
} from '@ara/db';
import {
  decryptSecret,
  getEncryptionKeyFromEnvironment
} from '@ara/secret-store';
import type { QueueDatabaseClient } from '@ara/queue';
import {
  AiRoleSchema,
  BillingTypeSchema,
  ProviderCapabilitySchema,
  ProviderKindSchema,
  type AiModelDescriptor,
  type AiRole,
  type ProviderCapability
} from '@ara/shared';

export interface PersistedProviderCatalogOptions {
  readonly encryptionKey?: Buffer;
}

export class ProviderCatalogError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ProviderCatalogError';
  }
}

type ConfigRecord = { [key: string]: Json | undefined };
type ProviderModels = Map<string, readonly ModelRow[]>;
type ProviderSecrets = Map<string, ProviderSecretRow>;

function configRecord(value: Json): ConfigRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderCatalogError('Stored provider configuration is invalid.');
  }
  return value;
}

function configString(config: ConfigRecord, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function configStrings(config: ConfigRecord, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) {
    return [];
  }
  if (!value.every((item) => typeof item === 'string')) {
    throw new ProviderCatalogError('Stored provider list configuration is invalid.');
  }
  return value;
}

function configRoles(config: ConfigRecord): AiRole[] {
  return configStrings(config, 'roles').map((role) => {
    const parsed = AiRoleSchema.safeParse(role);
    if (!parsed.success) {
      throw new ProviderCatalogError('Stored provider role configuration is invalid.');
    }
    return parsed.data;
  });
}

function configCapabilities(value: Json): ProviderCapability[] {
  const values = Array.isArray(value) ? value : [];
  return values.flatMap((item) => {
    if (typeof item !== 'string') {
      return [];
    }
    const parsed = ProviderCapabilitySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function decryptProviderKey(
  secret: ProviderSecretRow | undefined,
  options: PersistedProviderCatalogOptions
): string | undefined {
  if (!secret) {
    return undefined;
  }
  const key = options.encryptionKey ?? getEncryptionKeyFromEnvironment();
  return decryptSecret(
    {
      ciphertext: secret.ciphertext,
      iv: secret.iv,
      authTag: secret.auth_tag,
      last4: secret.last4
    },
    key
  );
}

function providerFromRow(
  row: ProviderRow,
  secret: ProviderSecretRow | undefined,
  options: PersistedProviderCatalogOptions
): AiProvider {
  const config = configRecord(row.config);
  const kind = ProviderKindSchema.safeParse(row.kind);
  const billingType = BillingTypeSchema.safeParse(row.billing_type);
  if (!kind.success || !billingType.success) {
    throw new ProviderCatalogError('Stored provider type configuration is invalid.');
  }

  if (kind.data === 'openai_http') {
    const baseUrl = configString(config, 'baseUrl');
    if (!baseUrl) {
      throw new ProviderCatalogError('Stored HTTP provider has no base URL.');
    }
    const manualModelId = configString(config, 'manualModelId');
    const apiKey = decryptProviderKey(secret, options);
    return new OpenAiHttpProvider({
      id: row.id,
      baseUrl,
      billingType: billingType.data,
      ...(apiKey ? { apiKey } : {}),
      ...(manualModelId ? { manualModelId } : {})
    });
  }

  const executable = configString(config, 'executable');
  const modelId = configString(config, 'modelId');
  if (!executable || !modelId) {
    throw new ProviderCatalogError('Stored command provider is incomplete.');
  }
  const promptMode = configString(config, 'promptMode');
  const outputMode = configString(config, 'outputMode');
  return new CommandProvider({
    id: row.id,
    billingType: billingType.data,
    executable,
    fixedArgs: configStrings(config, 'fixedArgs'),
    modelId,
    promptMode: promptMode === 'final_arg' ? 'final_arg' : 'stdin',
    outputMode: outputMode === 'text_to_json' ? 'text_to_json' : 'json',
    environmentAllowlist: configStrings(config, 'environmentAllowlist')
  });
}

function modelFromRow(model: ModelRow): AiModelDescriptor {
  const capabilities = configCapabilities(model.capabilities);
  const billingType = BillingTypeSchema.safeParse(model.billing_type);
  if (capabilities.length === 0 || !billingType.success) {
    throw new ProviderCatalogError('Stored AI model metadata is invalid.');
  }
  return {
    providerId: model.provider_id,
    id: model.model_id,
    displayName: model.display_name,
    capabilities,
    billingType: billingType.data,
    qualityRank: model.quality_rank
  };
}

function indexModels(models: readonly ModelRow[]): ProviderModels {
  const indexed = new Map<string, readonly ModelRow[]>();
  for (const model of models) {
    const previous = indexed.get(model.provider_id) ?? [];
    indexed.set(model.provider_id, [...previous, model]);
  }
  return indexed;
}

function indexSecrets(secrets: readonly ProviderSecretRow[]): ProviderSecrets {
  return new Map(secrets.map((secret) => [secret.provider_id, secret]));
}

function rolePriority(
  roles: readonly AiRole[],
  priority: number
): Partial<Record<AiRole, number>> {
  const result: Partial<Record<AiRole, number>> = {};
  for (const role of roles) {
    result[role] = priority;
  }
  return result;
}

async function catalogEntry(
  provider: ProviderRow,
  models: readonly ModelRow[],
  secrets: ProviderSecrets,
  options: PersistedProviderCatalogOptions
): Promise<ProviderCatalogEntry> {
  const adapter = providerFromRow(provider, secrets.get(provider.id), options);
  const health = await adapter.health();
  const persistedModels = models.map(modelFromRow);
  const liveModels =
    persistedModels.length > 0 || !health.available
      ? persistedModels
      : await adapter.listModels();
  const roles = configRoles(configRecord(provider.config));
  return {
    provider: adapter,
    enabled: provider.enabled,
    priority: provider.priority,
    health,
    models: liveModels,
    ...(roles.length > 0
      ? { roles, rolePriority: rolePriority(roles, provider.priority) }
      : {})
  };
}

export async function resolvePersistedProviderCatalog(
  client: QueueDatabaseClient,
  options: PersistedProviderCatalogOptions = {}
): Promise<ProviderCatalog> {
  const repository = createProviderRepository(client);
  const [providers, models, secrets] = await Promise.all([
    repository.listProviders(),
    repository.listModels(),
    repository.listSecrets()
  ]);
  const modelsByProvider = indexModels(models);
  const secretsByProvider = indexSecrets(secrets);
  const entries: ProviderCatalogEntry[] = [];
  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }
    entries.push(
      await catalogEntry(
        provider,
        modelsByProvider.get(provider.id) ?? [],
        secretsByProvider,
        options
      )
    );
  }
  return { entries };
}
