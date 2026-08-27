import {
  AiUsageSchema,
  type AiModelDescriptor,
  type AiRole,
  type AiUsage,
  type BillingType,
  type Locale
} from '@ara/shared';
import { z } from 'zod';

export type JsonObject = Record<string, unknown>;

export interface ProviderHealth {
  readonly available: boolean;
  readonly checkedAt: string;
  readonly reason: string | null;
  readonly retryAfterSeconds: number | null;
}

export interface RawStructuredAiRequest {
  readonly role: AiRole;
  readonly modelId: string;
  readonly locale: Locale;
  readonly prompt: string;
  readonly inputHash: string;
  readonly schema: JsonObject;
  readonly isRepair: boolean;
}

export interface RawAiProviderResult {
  readonly rawOutput: unknown;
  readonly providerId: string;
  readonly modelId: string;
  readonly role: AiRole;
  readonly inputHash: string;
  readonly usage: AiUsage;
  readonly costClass: BillingType;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface RawAiProvider {
  readonly id: string;
  readonly billingType: BillingType;
  health(): Promise<ProviderHealth>;
  listModels(): Promise<readonly AiModelDescriptor[]>;
  runRaw(request: RawStructuredAiRequest): Promise<RawAiProviderResult>;
}

export interface StructuredAiRequest<T> {
  readonly role: AiRole;
  readonly modelId: string;
  readonly locale: Locale;
  readonly prompt: string;
  readonly inputHash: string;
  readonly schema: z.ZodType<T>;
}

export interface AiProviderResult<T> extends Omit<RawAiProviderResult, 'rawOutput'> {
  readonly output: T;
}

export class InvalidStructuredOutputError extends Error {
  readonly code = 'INVALID_STRUCTURED_OUTPUT' as const;

  constructor() {
    super('Provider returned invalid structured output.');
    this.name = 'InvalidStructuredOutputError';
  }
}

function parseRawOutput(rawOutput: unknown): unknown {
  if (typeof rawOutput !== 'string') {
    return rawOutput;
  }

  try {
    const parsed: unknown = JSON.parse(rawOutput);
    return parsed;
  } catch {
    return undefined;
  }
}

function repairPrompt(rawOutput: unknown, schema: JsonObject): string {
  const invalid =
    typeof rawOutput === 'string'
      ? rawOutput
      : JSON.stringify(rawOutput) ?? '[unserializable output]';
  return [
    'Return only one JSON object that matches the target schema.',
    'Invalid output:',
    invalid,
    'Target schema:',
    JSON.stringify(schema)
  ].join('\n');
}

function combineUsage(first: AiUsage, second: AiUsage): AiUsage {
  const inputTokens =
    first.inputTokens === null || second.inputTokens === null
      ? null
      : first.inputTokens + second.inputTokens;
  const outputTokens =
    first.outputTokens === null || second.outputTokens === null
      ? null
      : first.outputTokens + second.outputTokens;
  const totalTokens =
    first.totalTokens === null || second.totalTokens === null
      ? null
      : first.totalTokens + second.totalTokens;
  return AiUsageSchema.parse({
    inputTokens,
    outputTokens,
    totalTokens,
    requestCount: first.requestCount + second.requestCount
  });
}

export async function runWithSchema<T>(
  provider: RawAiProvider,
  schema: z.ZodType<T>,
  request: Omit<StructuredAiRequest<T>, 'schema'>
): Promise<AiProviderResult<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const first = await provider.runRaw({
    ...request,
    schema: jsonSchema,
    isRepair: false
  });
  const firstParsed = schema.safeParse(parseRawOutput(first.rawOutput));
  if (firstParsed.success) {
    return { ...first, output: firstParsed.data };
  }

  const repaired = await provider.runRaw({
    ...request,
    prompt: repairPrompt(first.rawOutput, jsonSchema),
    schema: jsonSchema,
    isRepair: true
  });
  const repairedParsed = schema.safeParse(parseRawOutput(repaired.rawOutput));
  if (!repairedParsed.success) {
    throw new InvalidStructuredOutputError();
  }

  return {
    ...repaired,
    usage: combineUsage(first.usage, repaired.usage),
    output: repairedParsed.data
  };
}
