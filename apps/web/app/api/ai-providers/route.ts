import { randomUUID } from 'node:crypto';
import {
  createProviderRepository,
  createProviderRuntimeRepository,
  fingerprintFromProviderConfig,
  ProviderRepositoryError,
  ProviderRuntimeRepositoryError,
  secretCipherId,
  type Json,
  type ModelRow,
  type ProviderRow,
  type ProviderRuntimeStateRow,
  type ProviderSecretRow
} from '@ara/db';
import {
  AiRoleSchema,
  assertPersistableModelId,
  BillingTypeSchema,
  ProviderCapabilitySchema,
  UnsafeModelIdError
} from '@ara/shared';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKeyFromEnvironment,
  SecretStoreError,
  type EncryptedSecret
} from '@ara/secret-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerDatabaseContext, ServerConfigurationError } from '../../../lib/server/database';
import {
  adminAuthErrorResponse,
  requireAdminMutation,
  requireAdminRead
} from '../../../lib/server/api-auth';
import { AdminAuthError } from '../../../lib/server/admin-session';

export const runtime = 'nodejs';

const ProductChoiceSchema = z.enum([
  'codex_subscription',
  'grok_subscription',
  'openai_compatible_api'
]);

const ModelStatusSchema = z.object({
  modelId: z.string().trim().min(1),
  enabled: z.boolean(),
  priority: z.number().int().nonnegative()
}).strict();

const HttpProviderInputSchema = z.object({
  product: z.literal('openai_compatible_api'),
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  billingType: BillingTypeSchema,
  baseUrl: z.union([z.literal(''), z.url()]).transform((value) => value || undefined),
  networkScope: z.enum(['public', 'private', 'loopback']).default('public'),
  apiKey: z.string().optional(),
  modelId: z.string().trim().transform((value) => value || undefined).optional(),
  modelDiscovery: z.enum(['enabled', 'disabled']).optional(),
  modelEnabled: z.boolean().default(true),
  modelPriority: z.number().int().nonnegative().default(100),
  roles: z.array(AiRoleSchema).default([]),
  enabled: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(100),
  settingsRevision: z.number().int().nonnegative().optional(),
  models: z.array(ModelStatusSchema).optional()
}).strict();

const SubscriptionProviderInputSchema = z.object({
  product: z.enum(['codex_subscription', 'grok_subscription']),
  priority: z.number().int().nonnegative().default(100)
}).strict();

const DisableSubscriptionInputSchema = z.object({
  action: z.literal('disable'),
  providerId: z.string().trim().min(1).max(120)
}).strict();

const ProviderMutationSchema = z.union([
  HttpProviderInputSchema,
  SubscriptionProviderInputSchema,
  DisableSubscriptionInputSchema
]);

type HttpProviderInput = z.infer<typeof HttpProviderInputSchema>;
type SubscriptionProduct = 'codex_subscription' | 'grok_subscription';
type SetupStatus =
  | 'setup_required'
  | 'disabled'
  | 'ready'
  | 'expired'
  | 'needs_attention'
  | 'unavailable';

const MODEL_CAPABILITIES = [
  'structured_json',
  'chat_completions',
  'health',
  'model_discovery'
] as const satisfies readonly z.infer<typeof ProviderCapabilitySchema>[];

const SUBSCRIPTION_PRODUCTS = {
  codex_subscription: {
    product: 'codex_subscription',
    providerId: 'codex-subscription-v1',
    productLabel: 'OpenAI Codex Subscription',
    adapter: 'codex',
    modelId: 'gpt-5.6',
    modelLabel: 'GPT-5.6'
  },
  grok_subscription: {
    product: 'grok_subscription',
    providerId: 'grok-subscription-v1',
    productLabel: 'Grok Subscription',
    adapter: 'grok',
    modelId: null,
    modelLabel: 'Setup required'
  }
} as const;

interface PublicModel {
  readonly id: string;
  readonly displayName: string;
  readonly billingType: string;
  readonly capabilities: readonly string[];
  readonly qualityRank: number;
  readonly enabled: boolean;
  readonly priority: number;
  readonly origin: string;
}

interface PublicHttpProvider {
  readonly id: string;
  readonly product: 'openai_compatible_api';
  readonly productLabel: 'OpenAI-Compatible API';
  readonly name: string;
  readonly billingType: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly secretLast4: string | null;
  readonly roles: readonly string[];
  readonly baseUrl: string | null;
  readonly networkScope: 'public' | 'private' | 'loopback' | null;
  readonly modelId: string | null;
  readonly modelDiscovery: 'enabled' | 'disabled';
  readonly settingsRevision: number;
  readonly models: readonly PublicModel[];
}

interface PublicSubscriptionProvider {
  readonly id: string;
  readonly product: SubscriptionProduct;
  readonly productLabel: string;
  readonly name: string;
  readonly billingType: 'subscription';
  readonly enabled: boolean;
  readonly priority: number;
  readonly role: 'niche_normalization';
  readonly modelLabel: string;
  readonly setupStatus: SetupStatus;
  readonly statusReason: 'setup_required' | 'authorization_expired' | 'probe_pending' | 'temporarily_unavailable' | 'disabled' | null;
  readonly lastCheckedAt: string | null;
  readonly settingsRevision: number;
}

class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

class ProviderFamilyConflictError extends Error {
  constructor() {
    super('The provider product family conflicts with the persisted row.');
    this.name = 'ProviderFamilyConflictError';
  }
}

function jsonStrings(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function jsonString(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function publicModel(model: ModelRow): PublicModel {
  return {
    id: model.model_id,
    displayName: model.display_name,
    billingType: model.billing_type,
    capabilities: jsonStrings(model.capabilities),
    qualityRank: model.quality_rank,
    enabled: model.enabled,
    priority: model.priority,
    origin: model.origin
  };
}

function setupStatus(
  provider: ProviderRow,
  state: ProviderRuntimeStateRow | null
): SetupStatus {
  if (!state || state.state === 'authorization_required') return 'setup_required';
  if (state.state === 'expired') return 'expired';
  if (state.state === 'needs_attention') return 'needs_attention';
  if (!provider.enabled) return 'disabled';
  const leaseIsCurrent = state.ready_valid_until !== null && Date.parse(state.ready_valid_until) > Date.now();
  return state.available && state.retry_not_before === null && leaseIsCurrent
    ? 'ready'
    : 'unavailable';
}

function sanitizedReason(
  provider: ProviderRow,
  state: ProviderRuntimeStateRow | null
): PublicSubscriptionProvider['statusReason'] {
  if (!state || state.state === 'authorization_required') return 'setup_required';
  if (state.state === 'expired') return 'authorization_expired';
  if (!provider.enabled) return 'disabled';
  if (state.reason === 'readiness_stale') return 'probe_pending';
  if (
    state.reason === 'temporary_capacity' ||
    state.reason === 'transient_client_failure'
  ) return 'temporarily_unavailable';
  return null;
}

function subscriptionProductFromRow(provider: ProviderRow) {
  if (provider.kind !== 'subscription_command') {
    throw new ProviderConfigurationError('Stored provider is not a subscription product.');
  }
  if (provider.adapter === 'codex') return SUBSCRIPTION_PRODUCTS.codex_subscription;
  if (provider.adapter === 'grok') return SUBSCRIPTION_PRODUCTS.grok_subscription;
  throw new ProviderConfigurationError('Stored subscription provider identity is invalid.');
}

function publicSubscriptionProvider(
  provider: ProviderRow,
  state: ProviderRuntimeStateRow | null
): PublicSubscriptionProvider {
  const product = subscriptionProductFromRow(provider);
  return {
    id: provider.id,
    product: product.product,
    productLabel: product.productLabel,
    name: product.productLabel,
    billingType: 'subscription',
    enabled: provider.enabled,
    priority: provider.priority,
    role: 'niche_normalization',
    modelLabel: product.modelLabel,
    setupStatus: setupStatus(provider, state),
    statusReason: sanitizedReason(provider, state),
    lastCheckedAt: state?.checked_at ?? null,
    settingsRevision: provider.settings_revision
  };
}

function publicHttpProvider(
  provider: ProviderRow,
  secret: ProviderSecretRow | null,
  models: readonly ModelRow[]
): PublicHttpProvider {
  const config = typeof provider.config === 'object' && provider.config !== null && !Array.isArray(provider.config)
    ? provider.config
    : {};
  const networkScope = jsonString(config.networkScope);
  return {
    id: provider.id,
    product: 'openai_compatible_api',
    productLabel: 'OpenAI-Compatible API',
    name: provider.name,
    billingType: provider.billing_type,
    enabled: provider.enabled,
    priority: provider.priority,
    secretLast4: secret?.last4 ? secret.last4 : null,
    roles: jsonStrings(config.roles ?? null),
    baseUrl: jsonString(config.baseUrl),
    networkScope:
      networkScope === 'public' || networkScope === 'private' || networkScope === 'loopback'
        ? networkScope
        : null,
    modelId: jsonString(config.manualModelId),
    modelDiscovery: jsonString(config.modelDiscovery) === 'disabled' ? 'disabled' : 'enabled',
    settingsRevision: provider.settings_revision,
    models: models.map(publicModel)
  };
}

function httpProviderConfig(input: HttpProviderInput, modelId: string | undefined): Json {
  if (!input.baseUrl) {
    throw new ProviderConfigurationError('Base URL is required for HTTP providers.');
  }
  const modelDiscovery = input.modelDiscovery ?? (modelId ? 'disabled' : 'enabled');
  return {
    baseUrl: input.baseUrl,
    networkScope: input.networkScope,
    modelDiscovery,
    ...(modelDiscovery === 'disabled' && modelId ? { manualModelId: modelId } : {}),
    roles: input.roles
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProviderConfigurationError('Provider request JSON is invalid.');
    }
    throw error;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    requireAdminRead(request);
    const { client } = getServerDatabaseContext();
    const repository = createProviderRepository(client);
    const [providers, models, secrets, runtimeStates] = await Promise.all([
      repository.listProviders(),
      repository.listModels(),
      repository.listSecrets(),
      repository.listRuntimeStates()
    ]);
    const secretByProvider = new Map(secrets.map((secret) => [secret.provider_id, secret]));
    const runtimeByProvider = new Map(runtimeStates.map((state) => [state.provider_id, state]));
    const modelsByProvider = new Map<string, ModelRow[]>();
    for (const model of models) {
      const providerModels = modelsByProvider.get(model.provider_id) ?? [];
      providerModels.push(model);
      modelsByProvider.set(model.provider_id, providerModels);
    }
    const publicProviders: Array<PublicHttpProvider | PublicSubscriptionProvider> = [];
    for (const provider of providers) {
      if (provider.kind === 'openai_http') {
        publicProviders.push(publicHttpProvider(
          provider,
          secretByProvider.get(provider.id) ?? null,
          modelsByProvider.get(provider.id) ?? []
        ));
      } else if (provider.kind === 'subscription_command') {
        publicProviders.push(publicSubscriptionProvider(
          provider,
          runtimeByProvider.get(provider.id) ?? null
        ));
      }
    }
    return NextResponse.json({ providers: publicProviders });
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    if (
      error instanceof ServerConfigurationError ||
      error instanceof ProviderRepositoryError ||
      error instanceof ProviderConfigurationError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}

async function saveHttpProvider(input: HttpProviderInput): Promise<PublicHttpProvider> {
  const encryptionKey = getEncryptionKeyFromEnvironment();
  const encrypted: EncryptedSecret | null = input.apiKey?.trim()
    ? encryptSecret(input.apiKey.trim(), encryptionKey)
    : null;
  const { client } = getServerDatabaseContext();
  const repository = createProviderRepository(client);
  const providerId = input.id ?? `provider-${randomUUID()}`;
  let secretForComparison = input.apiKey?.trim();
  if (!secretForComparison && input.modelId && input.id) {
    const storedSecret = await repository.findSecret(input.id);
    if (storedSecret) {
      secretForComparison = decryptSecret({
        ciphertext: storedSecret.ciphertext,
        iv: storedSecret.iv,
        authTag: storedSecret.auth_tag,
        last4: storedSecret.last4
      }, encryptionKey);
    }
  }
  const modelId = input.modelId
    ? assertPersistableModelId(input.modelId, secretForComparison)
    : undefined;
  const existingSecret = input.id ? await repository.findSecret(input.id) : null;
  const builtConfig = httpProviderConfig(input, modelId);
  const nextSecret = encrypted
    ? { ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag }
    : existingSecret;
  const identity = fingerprintFromProviderConfig(
    'openai_http',
    builtConfig,
    secretCipherId(nextSecret)
  );
  const provider = await repository.saveSettings({
    provider: {
      id: providerId,
      name: input.name,
      kind: 'openai_http',
      adapter: null,
      billing_type: input.billingType,
      enabled: input.enabled,
      priority: input.priority,
      config: {
        ...(typeof builtConfig === 'object' && builtConfig !== null && !Array.isArray(builtConfig)
          ? builtConfig
          : {}),
        executionIdentity: identity
      }
    },
    secret: encrypted ? {
      provider_id: providerId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last4: encrypted.last4
    } : null,
    models: modelId ? [{
      provider_id: providerId,
      model_id: modelId,
      display_name: modelId,
      capabilities: [...MODEL_CAPABILITIES],
      billing_type: input.billingType,
      quality_rank: 100,
      enabled: input.modelEnabled,
      priority: input.modelPriority,
      origin: 'manual'
    }] : [],
    reconcileMode: modelId ? 'manual' : 'none',
    modelStatus: input.models ?? [],
    expectedRevision: input.settingsRevision ?? null
  });
  const [secret, models] = await Promise.all([
    repository.findSecret(provider.id),
    repository.listModels(provider.id)
  ]);
  return publicHttpProvider(provider, secret, models);
}

async function saveSubscriptionProvider(
  productChoice: SubscriptionProduct,
  priority: number
): Promise<PublicSubscriptionProvider> {
  const product = SUBSCRIPTION_PRODUCTS[productChoice];
  const { client } = getServerDatabaseContext();
  const repository = createProviderRepository(client);
  const [existing, providers] = await Promise.all([
    repository.findProvider(product.providerId),
    repository.listProviders()
  ]);
  if (
    existing &&
    (existing.kind !== 'subscription_command' || existing.adapter !== product.adapter)
  ) {
    throw new ProviderFamilyConflictError();
  }
  if (
    providers.some((provider) =>
      provider.kind === 'subscription_command' &&
      provider.adapter === product.adapter &&
      provider.id !== product.providerId
    )
  ) {
    throw new ProviderFamilyConflictError();
  }
  if (existing?.enabled) {
    throw new ProviderFamilyConflictError();
  }
  const providerInput = {
    id: product.providerId,
    name: product.productLabel,
    kind: 'subscription_command' as const,
    adapter: product.adapter,
    billing_type: 'subscription' as const,
    enabled: false,
    priority,
    config: { roles: ['niche_normalization'] }
  };
  const modelInput = product.modelId === null ? [] : [{
    provider_id: product.providerId,
    model_id: product.modelId,
    display_name: product.modelLabel,
    capabilities: ['structured_json'],
    billing_type: 'subscription',
    quality_rank: 100,
    enabled: false,
    priority,
    origin: 'manual'
  }];
  let provider: ProviderRow;
  if (existing) {
    provider = await repository.saveSettings({
      provider: providerInput,
      secret: null,
      models: modelInput,
      reconcileMode: modelInput.length === 0 ? 'none' : 'manual',
      expectedRevision: existing.settings_revision
    });
  } else {
    provider = await repository.upsertProvider(providerInput);
    if (modelInput[0]) await repository.upsertModel(modelInput[0]);
  }
  const state = await repository.findRuntimeState(provider.id);
  return publicSubscriptionProvider(provider, state);
}

async function disableSubscriptionProvider(providerId: string): Promise<NextResponse> {
  const { client } = getServerDatabaseContext();
  const repository = createProviderRepository(client);
  const provider = await repository.findProvider(providerId);
  if (!provider || provider.kind !== 'subscription_command') {
    return NextResponse.json({ error: 'provider_not_found' }, { status: 404 });
  }
  const state = await repository.findRuntimeState(providerId);
  if (state) {
    await createProviderRuntimeRepository(client).deactivate({ providerId });
  } else if (provider.enabled) {
    throw new ProviderConfigurationError('Enabled subscription provider has no runtime authority.');
  }
  return NextResponse.json({ providerId, setupStatus: 'disabled' });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireAdminMutation(request);
    const parsed = ProviderMutationSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    const input = parsed.data;
    if ('action' in input) return disableSubscriptionProvider(input.providerId);
    const provider = input.product === 'openai_compatible_api'
      ? await saveHttpProvider(input)
      : await saveSubscriptionProvider(input.product, input.priority);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    if (error instanceof ProviderFamilyConflictError) {
      return NextResponse.json({ error: 'provider_family_conflict' }, { status: 409 });
    }
    if (
      error instanceof ProviderConfigurationError ||
      error instanceof z.ZodError ||
      error instanceof UnsafeModelIdError
    ) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    if (error instanceof ProviderRepositoryError) {
      const detail = error.cause instanceof Error ? error.cause.message : error.message;
      if (detail.includes('settings_revision_conflict')) {
        return NextResponse.json({ error: 'settings_conflict' }, { status: 409 });
      }
      if (detail.includes('provider_family_immutable') || detail.includes('duplicate key')) {
        return NextResponse.json({ error: 'provider_family_conflict' }, { status: 409 });
      }
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    if (
      error instanceof ProviderRuntimeRepositoryError ||
      error instanceof ServerConfigurationError ||
      error instanceof SecretStoreError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}

export { ProductChoiceSchema };
