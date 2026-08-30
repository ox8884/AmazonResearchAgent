import {
  CommandProvider,
  OpenAiHttpProvider,
  TEST_CONNECTION_REQUIRED,
  type AiProvider,
  type ProviderCatalog,
  type ProviderCatalogEntry
} from '@ara/ai-router';
import {
  createProviderRepository,
  fingerprintFromProviderConfig,
  secretCipherId,
  type Json,
  type ModelRow,
  type ProviderRow,
  type ProviderRuntimeStateRow,
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
  type BillingType,
  type ProviderCapability
} from '@ara/shared';

import { resolveApprovedCommandProfile } from './command-profiles';
import {
  createPinnedProviderFetch,
  validateProviderBaseUrl
} from './provider-url-policy';

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
type ProviderRuntimeStates = Map<string, ProviderRuntimeStateRow>;
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

function configModelDiscovery(
  config: ConfigRecord
): 'enabled' | 'disabled' | undefined {
  const value = configString(config, 'modelDiscovery');
  if (value === undefined || value === 'enabled' || value === 'disabled') {
    return value;
  }
  throw new ProviderCatalogError('Stored model discovery policy is invalid.');
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

async function providerFromRow(
  row: ProviderRow,
  secret: ProviderSecretRow | undefined,
  options: PersistedProviderCatalogOptions
): Promise<AiProvider> {
  const config = configRecord(row.config);
  const kind = ProviderKindSchema.safeParse(row.kind);
  const billingType = BillingTypeSchema.safeParse(row.billing_type);
  if (!kind.success || !billingType.success) {
    throw new ProviderCatalogError('Stored provider type configuration is invalid.');
  }

  if (kind.data === 'openai_http') {
    const baseUrl = configString(config, 'baseUrl');
    const networkScope = configString(config, 'networkScope');
    if (
      !baseUrl ||
      (networkScope !== 'public' &&
        networkScope !== 'private' &&
        networkScope !== 'loopback')
    ) {
      throw new ProviderCatalogError('Stored HTTP provider URL policy is incomplete.');
    }
    const validatedUrl = await validateProviderBaseUrl(baseUrl, networkScope);
    const manualModelId = configString(config, 'manualModelId');
    const modelDiscovery = configModelDiscovery(config);
    const apiKey = decryptProviderKey(secret, options);
    return new OpenAiHttpProvider({
      id: row.id,
      baseUrl: validatedUrl.toString(),
      billingType: billingType.data,
      requiresSecret: true,
      fetch: createPinnedProviderFetch(networkScope),
      ...(apiKey ? { apiKey } : {}),
      ...(manualModelId ? { manualModelId } : {}),
      ...(modelDiscovery ? { modelDiscovery } : {})
    });
  }

  if (kind.data === 'subscription_command') {
    if (
      (row.adapter !== 'codex' && row.adapter !== 'grok') ||
      billingType.data !== 'subscription'
    ) {
      throw new ProviderCatalogError('Stored subscription provider identity is invalid.');
    }
    throw new ProviderCatalogError(
      'Subscription provider execution is unavailable until sandbox activation.'
    );
  }

  const profileId = configString(config, 'commandProfileId');
  const modelId = configString(config, 'modelId');
  if (!profileId || !modelId) {
    throw new ProviderCatalogError('Stored command provider profile is incomplete.');
  }
  return new CommandProvider(
    resolveApprovedCommandProfile(
      profileId,
      row.id,
      modelId,
      billingType.data
    )
  );
}



export interface PersistedProviderSnapshot {
  readonly adapter: AiProvider;
  readonly provider: ProviderRow;
  readonly runtimeState: ProviderRuntimeStateRow | null;
  readonly secret: ProviderSecretRow | null;
  readonly models: readonly ModelRow[];
  readonly fingerprint: string;
}


export async function loadPersistedProviderSnapshot(
  client: QueueDatabaseClient,
  providerId: string,
  options: PersistedProviderCatalogOptions = {}
): Promise<PersistedProviderSnapshot | null> {
  const repository = createProviderRepository(client);
  const provider = await repository.findProvider(providerId);
  if (!provider) {
    return null;
  }
  const [runtimeState, secret, models] = await Promise.all([
    repository.findRuntimeState(providerId),
    repository.findSecret(providerId),
    repository.listModels(providerId)
  ]);
  return {
    adapter: await providerFromRow(provider, secret ?? undefined, options),
    provider,
    runtimeState,
    secret,
    models,
    fingerprint: fingerprintFromProviderConfig(

      provider.kind,
      provider.config,
      secretCipherId(secret)
    )
  };
}

export async function instantiatePersistedProvider(
  client: QueueDatabaseClient,
  providerId: string,
  options: PersistedProviderCatalogOptions = {}
): Promise<AiProvider | null> {
  const snapshot = await loadPersistedProviderSnapshot(client, providerId, options);
  return snapshot?.adapter ?? null;
}


function modelFromRow(
  model: ModelRow,
  providerBilling: BillingType
): AiModelDescriptor {
  const capabilities = configCapabilities(model.capabilities);
  const billingType = BillingTypeSchema.safeParse(providerBilling);
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
function indexRuntimeStates(
  states: readonly ProviderRuntimeStateRow[]
): ProviderRuntimeStates {
  return new Map(states.map((state) => [state.provider_id, state]));
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
  runtimeState: ProviderRuntimeStateRow | undefined,
  secrets: ProviderSecrets,
  options: PersistedProviderCatalogOptions
): Promise<ProviderCatalogEntry> {
  if (provider.kind === 'subscription_command' && !runtimeState) {
    throw new ProviderCatalogError('Subscription provider runtime state is missing.');
  }

  const adapter = await providerFromRow(provider, secrets.get(provider.id), options);
  const liveHealth = await adapter.health();
  const config = configRecord(provider.config);
  const probe = config.executionProbe;
  const currentFingerprint = fingerprintFromProviderConfig(
    provider.kind,
    provider.config,
    secretCipherId(secrets.get(provider.id) ?? null)
  );
  const probeRecord =
    typeof probe === 'object' && probe !== null && !Array.isArray(probe)
      ? probe
      : null;
  const probeAvailable =
    probeRecord?.['available'] === true &&
    probeRecord['fingerprint'] === currentFingerprint;
  const health =
    liveHealth.reason === TEST_CONNECTION_REQUIRED && probeAvailable
      ? {
          available: true as const,
          checkedAt:
            typeof probeRecord?.['checkedAt'] === 'string'
              ? probeRecord['checkedAt']
              : liveHealth.checkedAt,
          reason: null,
          retryAfterSeconds: null
        }
      : liveHealth;
  const persistedModels = models
    .filter((model) => model.enabled)
    .map((model) => modelFromRow(model, adapter.billingType));

  const roles = configRoles(config);
  return {
    provider: adapter,
    enabled: provider.enabled,
    priority: provider.priority,
    health,
    models: persistedModels,
    roles,
    rolePriority: rolePriority(roles, provider.priority)
  };
}

export async function resolvePersistedProviderCatalog(
  client: QueueDatabaseClient,
  options: PersistedProviderCatalogOptions = {}
): Promise<ProviderCatalog> {
  const repository = createProviderRepository(client);
  const [providers, models, runtimeStates, secrets] = await Promise.all([
    repository.listProviders(),
    repository.listModels(),
    repository.listRuntimeStates(),
    repository.listSecrets()
  ]);
  const modelsByProvider = indexModels(models.filter((model) => model.enabled));
  const runtimeByProvider = indexRuntimeStates(runtimeStates);
  const secretsByProvider = indexSecrets(secrets);

  const entries: ProviderCatalogEntry[] = [];
  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }
    try {
      entries.push(
        await catalogEntry(
          provider,
          modelsByProvider.get(provider.id) ?? [],
          runtimeByProvider.get(provider.id),
          secretsByProvider,
          options
        )
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        continue;
      }
      throw error;
    }
  }
  return { entries };
}

export class ProviderCatalogCache {
  private value: ProviderCatalog | null = null;
  private expiresAt = 0;

  constructor(
    private readonly load: () => Promise<ProviderCatalog>,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  invalidate(): void {
    this.expiresAt = 0;
  }

  async resolve(forceRefresh = false): Promise<ProviderCatalog> {
    const currentTime = this.now();
    if (!forceRefresh && this.value && currentTime < this.expiresAt) {
      return this.value;
    }
    const resolved = await this.load();
    this.value = resolved;
    this.expiresAt = currentTime + this.ttlMs;
    return resolved;
  }
}
