import {
  CommandProvider,
  CommandProviderError,
  OpenAiHttpError,
  OpenAiHttpProvider,
  type AiProvider
} from '@ara/ai-router';
import {
  createProviderRepository,
  ProviderRepositoryError,
  type Json,
  type ProviderRow,
  type ProviderSecretRow
} from '@ara/db';
import {
  BillingTypeSchema,
  ProviderKindSchema
} from '@ara/shared';
import {
  decryptSecret,
  getEncryptionKeyFromEnvironment,
  SecretStoreError
} from '@ara/secret-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerDatabaseContext, ServerConfigurationError } from '../../../../lib/server/database';

export const runtime = 'nodejs';

const TestRequestSchema = z.object({
  providerId: z.string().trim().min(1)
});

class StoredProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredProviderConfigurationError';
  }
}

function configObject(value: Json): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoredProviderConfigurationError('Stored provider configuration is invalid.');
  }
  return value;
}

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function configStrings(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return [];
  }
  return value;
}

function providerFromStoredConfig(
  provider: ProviderRow,
  secret: ProviderSecretRow | null
): AiProvider {
  const config = configObject(provider.config);
  const billingType = BillingTypeSchema.parse(provider.billing_type);
  const kind = ProviderKindSchema.parse(provider.kind);
  const apiKey = secret
    ? decryptSecret(
        {
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.auth_tag,
          last4: secret.last4
        },
        getEncryptionKeyFromEnvironment()
      )
    : undefined;

  if (kind === 'openai_http') {
    const baseUrl = configString(config, 'baseUrl');
    if (!baseUrl) {
      throw new StoredProviderConfigurationError('Stored HTTP provider has no base URL.');
    }
    const manualModelId = configString(config, 'manualModelId');
    return new OpenAiHttpProvider({
      id: provider.id,
      baseUrl,
      billingType,
      ...(apiKey ? { apiKey } : {}),
      ...(manualModelId ? { manualModelId } : {})
    });
  }

  const executable = configString(config, 'executable');
  const modelId = configString(config, 'modelId');
  if (!executable || !modelId) {
    throw new StoredProviderConfigurationError(
      'Stored command provider has no executable or model ID.'
    );
  }
  const promptMode = configString(config, 'promptMode');
  const outputMode = configString(config, 'outputMode');
  return new CommandProvider({
    id: provider.id,
    billingType,
    executable,
    fixedArgs: configStrings(config, 'fixedArgs'),
    modelId,
    promptMode: promptMode === 'final_arg' ? 'final_arg' : 'stdin',
    outputMode: outputMode === 'text_to_json' ? 'text_to_json' : 'json',
    environmentAllowlist: configStrings(config, 'environmentAllowlist')
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new StoredProviderConfigurationError('Connection test request JSON is invalid.');
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = TestRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    const { client } = getServerDatabaseContext();
    const repository = createProviderRepository(client);
    const provider = await repository.findProvider(parsed.data.providerId);
    if (!provider) {
      return NextResponse.json({ error: 'provider_not_found' }, { status: 404 });
    }
    const secret = await repository.findSecret(provider.id);
    const adapter = providerFromStoredConfig(provider, secret);
    const health = await adapter.health();
    const models = health.available ? await adapter.listModels() : [];
    return NextResponse.json({
      available: health.available,
      providerId: provider.id,
      models: models.map((model) => model.id),
      reason: health.reason
    });
  } catch (error) {
    if (error instanceof StoredProviderConfigurationError || error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
    }
    if (
      error instanceof ServerConfigurationError ||
      error instanceof ProviderRepositoryError ||
      error instanceof SecretStoreError
    ) {
      return NextResponse.json({ error: 'provider_store_unavailable' }, { status: 503 });
    }
    if (error instanceof OpenAiHttpError || error instanceof CommandProviderError) {
      return NextResponse.json({
        available: false,
        providerId: null,
        models: [],
        reason: 'Provider connection failed.'
      });
    }
    throw error;
  }
}
