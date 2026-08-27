import { randomUUID } from 'node:crypto';
import {
  createProviderRepository,
  ProviderRepositoryError,
  type Json,
  type ModelRow,
  type ProviderRow,
  type ProviderSecretRow
} from '@ara/db';
import {
  AiRoleSchema,
  BillingTypeSchema,
  ProviderCapabilitySchema,
  ProviderKindSchema
} from '@ara/shared';
import {
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
  baseUrl: z.union([z.literal(''), z.url()]).transform((value) => value || undefined),
  apiKey: z.string().optional(),
  modelId: z.string().trim().transform((value) => value || undefined).optional(),
  executable: z.string().trim().transform((value) => value || undefined).optional(),
  fixedArgs: z.array(z.string()).max(64).default([]),
  promptMode: z.enum(['stdin', 'final_arg']).default('stdin'),
  outputMode: z.enum(['json', 'text_to_json']).default('json'),
  environmentAllowlist: z.array(z.string().trim().min(1)).max(32).default([]),
  roles: z.array(AiRoleSchema).default([]),
  enabled: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(100)
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
}

interface PublicProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly billingType: string;
  readonly enabled: boolean;
  readonly secretLast4: string | null;
  readonly roles: readonly string[];
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

function publicModel(model: ModelRow): PublicModel {
  return {
    id: model.model_id,
    displayName: model.display_name,
    billingType: model.billing_type,
    capabilities: jsonStrings(model.capabilities),
    qualityRank: model.quality_rank
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
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    billingType: provider.billing_type,
    enabled: provider.enabled,
    secretLast4: secret?.last4 ?? null,
    roles: jsonStrings(config.roles ?? null),
    models: models.map(publicModel)
  };
}

function providerConfig(input: ProviderInput): Json {
  if (input.kind === 'openai_http') {
    if (!input.baseUrl) {
      throw new ProviderConfigurationError('Base URL is required for HTTP providers.');
    }
    return {
      baseUrl: input.baseUrl,
      ...(input.modelId ? { manualModelId: input.modelId } : {}),
      roles: input.roles
    };
  }
  if (!input.executable || !input.modelId) {
    throw new ProviderConfigurationError(
      'Executable and model ID are required for command providers.'
    );
  }
  return {
    executable: input.executable,
    fixedArgs: input.fixedArgs,
    modelId: input.modelId,
    promptMode: input.promptMode,
    outputMode: input.outputMode,
    environmentAllowlist: input.environmentAllowlist,
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
    const encrypted: EncryptedSecret | null = input.apiKey?.trim()
      ? encryptSecret(input.apiKey.trim(), getEncryptionKeyFromEnvironment())
      : null;
    const { client } = getServerDatabaseContext();
    const repository = createProviderRepository(client);
    const providerId = input.id ?? `provider-${randomUUID()}`;
    const provider = await repository.upsertProvider({
      id: providerId,
      name: input.name,
      kind: input.kind,
      billing_type: input.billingType,
      enabled: input.enabled,
      priority: input.priority,
      config: providerConfig(input)
    });

    if (encrypted) {
      await repository.upsertSecret({
        provider_id: provider.id,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        last4: encrypted.last4
      });
    }
    if (input.modelId) {
      await repository.upsertModel({
        provider_id: provider.id,
        model_id: input.modelId,
        display_name: input.modelId,
        capabilities: [...MODEL_CAPABILITIES],
        billing_type: input.billingType,
        quality_rank: 100,
        enabled: true
      });
    }

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
    if (error instanceof ProviderConfigurationError || error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    if (
      error instanceof ServerConfigurationError ||
      error instanceof ProviderRepositoryError ||
      error instanceof SecretStoreError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    throw error;
  }
}
