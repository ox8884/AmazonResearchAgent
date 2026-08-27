import ky, { HTTPError } from 'ky';
import {
  AiUsageSchema,
  type AiModelDescriptor,
  type AiUsage,
  type BillingType,
  type ProviderCapability
} from '@ara/shared';
import { z } from 'zod';
import {
  runWithSchema,
  type AiProviderResult,
  type ProviderHealth,
  type RawAiProvider,
  type RawAiProviderResult,
  type RawStructuredAiRequest,
  type StructuredAiRequest
} from '../provider';
import type { JsonObject } from '../structured';

const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1) }))
});

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() })
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional()
    })
    .optional()
});

const DEFAULT_CAPABILITIES = [
  'structured_json',
  'chat_completions',
  'model_discovery',
  'health'
] as const satisfies readonly ProviderCapability[];

const RETRY_STATUS_CODES = [
  408,
  429,
  ...Array.from({ length: 100 }, (_, index) => 500 + index)
];

export interface OpenAiHttpProviderConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly billingType: BillingType;
  readonly apiKey?: string;
  readonly manualModelId?: string;
  readonly qualityRank?: number;
  readonly modelDiscovery?: 'enabled' | 'disabled';
  readonly timeoutMs?: number;
}

export class OpenAiHttpError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number | null,
    retryable: boolean,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'OpenAiHttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '');
  if (normalized.length === 0) {
    throw new OpenAiHttpError('Provider base URL is required.', null, false);
  }
  return normalized;
}

function mapError(error: unknown): OpenAiHttpError {
  if (error instanceof OpenAiHttpError) {
    return error;
  }
  if (error instanceof HTTPError) {
    const status = error.response.status;
    return new OpenAiHttpError(
      `OpenAI-compatible provider request failed (${status}).`,
      status,
      status === 408 || status === 429 || status >= 500,
      error
    );
  }
  if (error instanceof z.ZodError) {
    return new OpenAiHttpError(
      'OpenAI-compatible provider returned malformed data.',
      null,
      false,
      error
    );
  }
  return new OpenAiHttpError(
    'OpenAI-compatible provider request failed.',
    null,
    true,
    error
  );
}

function descriptor(
  provider: OpenAiHttpProviderConfig,
  modelId: string,
  discovered: boolean
): AiModelDescriptor {
  return {
    providerId: provider.id,
    id: modelId,
    displayName: modelId,
    capabilities: [...DEFAULT_CAPABILITIES],
    billingType: provider.billingType,
    qualityRank: provider.qualityRank ?? (discovered ? 100 : 200)
  };
}

function usageFromResponse(
  usage: z.infer<typeof ChatResponseSchema>['usage']
): AiUsage {
  return AiUsageSchema.parse({
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    requestCount: 1
  });
}

export class OpenAiHttpProvider implements RawAiProvider {
  readonly id: string;
  readonly billingType: BillingType;
  private readonly config: Omit<OpenAiHttpProviderConfig, 'apiKey'>;
  private readonly http: typeof ky;

  constructor(config: OpenAiHttpProviderConfig) {
    const { apiKey, ...safeConfig } = config;
    this.config = { ...safeConfig, baseUrl: normalizeBaseUrl(config.baseUrl) };
    this.id = config.id;
    this.billingType = config.billingType;
    this.http = ky.create({
      prefixUrl: this.config.baseUrl,
      timeout: config.timeoutMs ?? 60_000,
      redirect: 'manual',
      retry: {
        limit: 2,
        methods: ['get', 'post'],
        statusCodes: RETRY_STATUS_CODES
      },
      hooks: {
        beforeRequest: [
          (request) => {
            if (apiKey) {
              request.headers.set('authorization', `Bearer ${apiKey}`);
            }
          }
        ]
      }
    });
  }

  async health(): Promise<ProviderHealth> {
    try {
      const models = await this.listModels();
      return {
        available: models.length > 0,
        checkedAt: new Date().toISOString(),
        reason: models.length > 0 ? null : 'No provider models are available.',
        retryAfterSeconds: null
      };
    } catch (error) {
      const mapped = mapError(error);
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        reason: mapped.message,
        retryAfterSeconds: mapped.retryable ? 60 : null
      };
    }
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    if (this.config.modelDiscovery === 'disabled') {
      if (!this.config.manualModelId) {
        throw new OpenAiHttpError(
          'Manual model ID is required when discovery is disabled.',
          null,
          false
        );
      }
      return [descriptor(this.config, this.config.manualModelId, false)];
    }
    try {
      const response = ModelsResponseSchema.parse(
        await this.http.get('models').json<unknown>()
      );
      return response.data.map((model) => descriptor(this.config, model.id, true));
    } catch (error) {
      if (
        error instanceof HTTPError &&
        [404, 405].includes(error.response.status) &&
        this.config.manualModelId
      ) {
        return [descriptor(this.config, this.config.manualModelId, false)];
      }
      throw mapError(error);
    }
  }

  async runStructured<T>(
    request: StructuredAiRequest<T>
  ): Promise<AiProviderResult<T>> {
    return runWithSchema(this, request.schema, request);
  }

  async runRaw(request: RawStructuredAiRequest): Promise<RawAiProviderResult> {
    const startedAt = new Date().toISOString();
    const body: JsonObject = {
      model: request.modelId,
      messages: [
        {
          role: 'system',
          content: 'Return only JSON matching the requested schema.'
        },
        { role: 'user', content: request.prompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          strict: true,
          schema: request.schema
        }
      }
    };

    try {
      const response = ChatResponseSchema.parse(
        await this.http.post('chat/completions', { json: body }).json<unknown>()
      );
      const choice = response.choices[0];
      if (!choice) {
        throw new OpenAiHttpError('Provider returned no completion.', null, false);
      }
      return {
        rawOutput: choice.message.content ?? '',
        providerId: this.id,
        modelId: request.modelId,
        role: request.role,
        inputHash: request.inputHash,
        usage: usageFromResponse(response.usage),
        costClass: this.billingType,
        startedAt,
        completedAt: new Date().toISOString()
      };
    } catch (error) {
      throw mapError(error);
    }
  }
}
