import { randomUUID } from 'node:crypto';
import {
  createProviderRepository,
  fingerprintFromProviderConfig,
  ProviderRepositoryError,
  secretCipherId,
  type Json,
  type ModelRow,
  type ProviderRow,
  type ProviderSecretRow
} from '@ara/db';
import {
  AiRoleSchema,
  assertPersistableModelId,
  BillingTypeSchema,
  ProviderCapabilitySchema,
  ProviderKindSchema,
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
const ProviderInputSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  kind: ProviderKindSchema,
  billingType: BillingTypeSchema,
  baseUrl: z
    .union([z.literal(''), z.url()])
    .optional()
    .transform((value) => value || undefined),
  networkScope: z.enum(['public', 'private', 'loopback']).default('public'),
  apiKey: z.string().optional(),
  modelId: z.string().trim().transform((value) => value || undefined).optional(),
  modelDiscovery: z.enum(['enabled', 'disabled']).optional(),
  modelEnabled: z.boolean().default(true),
  modelPriority: z.number().int().nonnegative().default(100),
  commandProfileId: z.string().trim().transform((value) => value || undefined).optional(),
  roles: z.array(AiRoleSchema).default([]),
  enabled: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(100),
  settingsRevision: z.number().int().nonnegative().optional(),
  models: z
    .array(
      z.object({
        modelId: z.string().trim().min(1),
        enabled: z.boolean(),
        priority: z.number().int().nonnegative()
      })
    )
    .optional()
});

type ProviderInput = z.infer<typeof ProviderInputSchema>;

const MODEL_CAPABILITIES = [
  'structured_json',
  'chat_completions',
  'health',
  'model_discovery'
] as const satisfies readonly z.infer<typeof ProviderCapabilitySchema>[];

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

interface PublicProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly billingType: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly secretLast4: string | null;
  readonly roles: readonly string[];
  readonly baseUrl: string | null;
  readonly networkScope: 'public' | 'private' | 'loopback' | null;
  readonly commandProfileId: string | null;
  readonly modelId: string | null;
  readonly modelDiscovery: 'enabled' | 'disabled';
  readonly settingsRevision: number;
  readonly models: readonly PublicModel[];
}

class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

function jsonStrings(value: Json): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
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

function publicProvider(
  provider: ProviderRow,
  secret: ProviderSecretRow | null,
  models: readonly ModelRow[]
): PublicProvider {
  const config =
    typeof provider.config === 'object' &&
    provider.config !== null &&
    !Array.isArray(provider.config)
      ? provider.config
      : {};
  const networkScope = jsonString(config.networkScope);
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    billingType: provider.billing_type,
    enabled: provider.enabled,
    priority: provider.priority,
    secretLast4: secret?.last4 ? secret.last4 : null,
    roles: jsonStrings(config.roles ?? null),
    baseUrl: jsonString(config.baseUrl),
    networkScope:
      networkScope === 'public' ||
      networkScope === 'private' ||
      networkScope === 'loopback'
        ? networkScope
        : null,
    commandProfileId: jsonString(config.commandProfileId),
    modelId: jsonString(config.manualModelId) ?? jsonString(config.modelId),
    modelDiscovery: jsonString(config.modelDiscovery) === 'disabled' ? 'disabled' : 'enabled',
    settingsRevision: provider.settings_revision,
    models: models.map(publicModel)
  };
}
function providerConfig(input: ProviderInput): Json {
  const modelDiscovery =
    input.modelDiscovery ?? (input.modelId ? 'disabled' : 'enabled');
  if (input.kind === 'openai_http') {
    if (!input.baseUrl) {
      throw new ProviderConfigurationError('Base URL is required for HTTP providers.');
    }
    return {
      baseUrl: input.baseUrl,
      networkScope: input.networkScope,
      modelDiscovery,
      ...(modelDiscovery === 'disabled' && input.modelId
        ? { manualModelId: input.modelId }
        : {}),
      roles: input.roles
    };
  }
  if (!input.commandProfileId || !input.modelId) {
    throw new ProviderConfigurationError(
      'Command profile and model ID are required for command providers.'
    );
  }
  return {
    commandProfileId: input.commandProfileId,
    modelId: input.modelId,
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
    const [providers, models, secrets] = await Promise.all([
      repository.listProviders(),
      repository.listModels(),
      repository.listSecrets()
    ]);
    const secretByProvider = new Map(secrets.map((secret) => [secret.provider_id, secret]));
    const modelsByProvider = new Map<string, ModelRow[]>();
    for (const model of models) {
      const providerModels = modelsByProvider.get(model.provider_id) ?? [];
      providerModels.push(model);
      modelsByProvider.set(model.provider_id, providerModels);
    }
    return NextResponse.json({
      providers: providers.map((provider) =>
        publicProvider(
          provider,
          secretByProvider.get(provider.id) ?? null,
          modelsByProvider.get(provider.id) ?? []
        )
      )
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (
      error instanceof ServerConfigurationError ||
      error instanceof ProviderRepositoryError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    requireAdminMutation(request);
    const parsed = ProviderInputSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    const input = parsed.data;
    const encryptionKey = getEncryptionKeyFromEnvironment();
    const encrypted: EncryptedSecret | null = input.apiKey?.trim()
      ? encryptSecret(input.apiKey.trim(), encryptionKey)
      : null;
    const { client } = getServerDatabaseContext();
    const repository = createProviderRepository(client);
    const providerId = input.id ?? `provider-${randomUUID()}`;
    let secretForComparison = input.apiKey?.trim();
    if (!secretForComparison && input.modelId && input.id) {
      const existingSecret = await repository.findSecret(input.id);
      if (existingSecret) {
        secretForComparison = decryptSecret(
          {
            ciphertext: existingSecret.ciphertext,
            iv: existingSecret.iv,
            authTag: existingSecret.auth_tag,
            last4: existingSecret.last4
          },
          encryptionKey
        );
      }
    }
    const modelId = input.modelId
      ? assertPersistableModelId(input.modelId, secretForComparison)
      : undefined;
    const existing = input.id ? await repository.findProvider(input.id) : null;
    const existingSecret = input.id ? await repository.findSecret(input.id) : null;
    const builtConfig = providerConfig({ ...input, modelId });
    const nextSecret = encrypted
      ? {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag
        }
      : existingSecret;
    const identity = fingerprintFromProviderConfig(
      input.kind,
      builtConfig,
      secretCipherId(nextSecret)
    );
    const previousIdentity = existing
      ? fingerprintFromProviderConfig(
          existing.kind,
          existing.config,
          secretCipherId(existingSecret)
        )
      : null;
    const previousConfig =
      existing &&
      typeof existing.config === 'object' &&
      existing.config !== null &&
      !Array.isArray(existing.config)
        ? existing.config
        : {};
    const previousProbe =
      previousIdentity === identity ? previousConfig.executionProbe : undefined;
    const provider = await repository.saveSettings({
      provider: {
        id: providerId,
        name: input.name,
        kind: input.kind,
        billing_type: input.billingType,
        enabled: input.enabled,
        priority: input.priority,
        config: {
          ...(typeof builtConfig === 'object' &&
          builtConfig !== null &&
          !Array.isArray(builtConfig)
            ? builtConfig
            : {}),
          executionIdentity: identity,
          ...(previousProbe !== undefined ? { executionProbe: previousProbe } : {})
        }
      },
      secret: encrypted
        ? {
            provider_id: providerId,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            auth_tag: encrypted.authTag,
            last4: encrypted.last4
          }
        : null,
      models: modelId
        ? [
            {
              provider_id: providerId,
              model_id: modelId,
              display_name: modelId,
              capabilities: [...MODEL_CAPABILITIES],
              billing_type: input.billingType,
              quality_rank: 100,
              enabled: input.modelEnabled,
              priority: input.modelPriority,
              origin: 'manual'
            }
          ]
        : [],
      reconcileMode: modelId ? 'manual' : 'none',
      modelStatus: input.models ?? [],
      expectedRevision: input.settingsRevision ?? null
    });


    const [secret, models] = await Promise.all([
      repository.findSecret(provider.id),
      repository.listModels(provider.id)
    ]);
    return NextResponse.json(
      { provider: publicProvider(provider, secret, models) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return adminAuthErrorResponse(error);
    }
    if (
      error instanceof ProviderConfigurationError ||
      error instanceof z.ZodError ||
      error instanceof UnsafeModelIdError
    ) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    if (error instanceof ProviderRepositoryError) {
      const detail =
        error.cause instanceof Error ? error.cause.message : error.message;
      if (detail.includes('settings_revision_conflict')) {
        return NextResponse.json({ error: 'settings_conflict' }, { status: 409 });
      }
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    if (
      error instanceof ServerConfigurationError ||
      error instanceof SecretStoreError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
