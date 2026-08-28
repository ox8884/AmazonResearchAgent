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

export const MODEL_LIST_MAX_BYTES = 256_000;
export const COMPLETION_MAX_BYTES = 1_048_576;
export const TEST_CONNECTION_REQUIRED = 'Explicit Test Connection is required.';

export interface OpenAiHttpProviderConfig {
  readonly id: string;
  readonly baseUrl: string;
  readonly billingType: BillingType;
  readonly apiKey?: string;
  readonly manualModelId?: string;
  readonly qualityRank?: number;
  readonly modelDiscovery?: 'enabled' | 'disabled';
  readonly timeoutMs?: number;
  readonly requiresSecret?: boolean;
  readonly fetch?: typeof fetch;
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
  private readonly config: Omit<OpenAiHttpProviderConfig, 'apiKey' | 'fetch'>;
  private readonly hasApiKey: boolean;
  private readonly requiresSecret: boolean;
  private readonly http: typeof ky;

  constructor(config: OpenAiHttpProviderConfig) {
    const { apiKey, fetch: customFetch, ...safeConfig } = config;
    this.config = { ...safeConfig, baseUrl: normalizeBaseUrl(config.baseUrl) };
    this.id = config.id;
    this.billingType = config.billingType;
    this.hasApiKey = Boolean(apiKey);
    this.requiresSecret = config.requiresSecret ?? true;
    this.http = ky.create({
      prefixUrl: this.config.baseUrl,
      timeout: config.timeoutMs ?? 60_000,
      redirect: 'manual',
      ...(customFetch ? { fetch: customFetch } : {}),
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
    if (this.requiresSecret && !this.hasApiKey) {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        reason: 'Provider secret is missing.',
        retryAfterSeconds: null
      };
    }
    if (this.config.modelDiscovery === 'disabled') {
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        reason: TEST_CONNECTION_REQUIRED,
        retryAfterSeconds: null
      };
    }
    try {
      const response = await this.http.get('models');
      await readJsonBounded(response, MODEL_LIST_MAX_BYTES);
      return {
        available: true,
        checkedAt: new Date().toISOString(),
        reason: null,
        retryAfterSeconds: null
      };
    } catch (error) {
      const mapped = mapError(error);
      if (
        (mapped.status === 404 || mapped.status === 405) &&
        this.config.manualModelId
      ) {
        return {
          available: false,
          checkedAt: new Date().toISOString(),
          reason: TEST_CONNECTION_REQUIRED,
          retryAfterSeconds: null
        };
      }
      const unauthorized = mapped.status === 401 || mapped.status === 403;
      return {
        available: false,
        checkedAt: new Date().toISOString(),
        reason: mapped.message,
        retryAfterSeconds: mapped.retryable && !unauthorized ? 60 : null
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
      const response = await this.http.get('models');
      const parsed = ModelsResponseSchema.parse(
        await readJsonBounded(response, MODEL_LIST_MAX_BYTES)
      );
      return parsed.data.map((model) => descriptor(this.config, model.id, true));
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
      const response = await this.http.post('chat/completions', { json: body });
      const parsed = ChatResponseSchema.parse(
        await readJsonBounded(response, COMPLETION_MAX_BYTES)
      );
      const choice = parsed.choices[0];
      if (!choice) {
        throw new OpenAiHttpError('Provider returned no completion.', null, false);
      }
      return {
        rawOutput: choice.message.content ?? '',
        providerId: this.id,
        modelId: request.modelId,
        role: request.role,
        inputHash: request.inputHash,
        usage: usageFromResponse(parsed.usage),
        costClass: this.billingType,
        startedAt,
        completedAt: new Date().toISOString()
      };
    } catch (error) {
      throw mapError(error);
    }
  }
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new OpenAiHttpError(
        'Provider response exceeded the size limit.',
        response.status,
        false
      );
    }
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new OpenAiHttpError('Provider response body was empty.', response.status, false);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OpenAiHttpError(
        'Provider response exceeded the size limit.',
        response.status,
        false
      );
    }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  try {
    return z.unknown().parse(JSON.parse(buffer.toString('utf8')));
  } catch (error) {
    throw new OpenAiHttpError(
      'OpenAI-compatible provider returned malformed data.',
      response.status,
      false,
      error
    );
  }
 }
