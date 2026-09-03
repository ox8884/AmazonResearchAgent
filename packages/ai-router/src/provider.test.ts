import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  InvalidStructuredOutputError,
  runWithSchema,
  type RawAiProvider,
  type RawAiProviderResult,
  type StructuredAiRequest
} from './provider';

const ClassificationSchema = z.object({
  classification: z.enum(['product_niche', 'brand_ip'])
});

type Classification = z.infer<typeof ClassificationSchema>;

function result(rawOutput: unknown): RawAiProviderResult {
  return {
    rawOutput,
    providerId: 'fake-provider',
    modelId: 'fake-model',
    role: 'niche_normalization',
    inputHash: 'a'.repeat(64),
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      requestCount: 1
    },
    costClass: 'free',
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString()
  };
}

function request(): Omit<StructuredAiRequest<Classification>, 'schema'> {
  return {
    role: 'niche_normalization',
    modelId: 'fake-model',
    locale: 'ko',
    prompt: 'Classify batter squeeze bottle.',
    inputHash: 'a'.repeat(64)
  };
}

function fakeProvider(outputs: readonly unknown[]): RawAiProvider {
  let index = 0;
  return {
    id: 'fake-provider',
    billingType: 'free',
    health: async () => ({
      available: true,
      checkedAt: new Date().toISOString(),
      reason: null,
      retryAfterSeconds: null
    }),
    listModels: async () => [],
    runRaw: async () => {
      const rawOutput = outputs[index] ?? outputs.at(-1);
      index += 1;
      return result(rawOutput);
    }
  };
}

describe('structured AI provider guard', () => {
  it('rejects invalid provider JSON instead of coercing it', async () => {
    const error = await runWithSchema(
      fakeProvider(['{"classification":"maybe"}', '{"classification":"maybe"}']),
      ClassificationSchema,
      request()
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidStructuredOutputError);
    if (error instanceof InvalidStructuredOutputError) {
      expect(error.usage.requestCount).toBe(2);
      expect(error.attempts).toHaveLength(2);
    }
  });

  it('uses at most one repair request for malformed output', async () => {
    const provider = fakeProvider([
      '{"classification":"maybe"}',
      '{"classification":"product_niche"}'
    ]);

    const parsed = await runWithSchema(provider, ClassificationSchema, request());

    expect(parsed.output.classification).toBe('product_niche');
  });

  it('never sends a paid repair request after invalid PAYG output', async () => {
    const runRaw = vi.fn(async () => result('{"classification":"maybe"}'));
    const provider: RawAiProvider = {
      ...fakeProvider([]),
      billingType: 'payg',
      runRaw,
    };

    await expect(runWithSchema(provider, ClassificationSchema, request())).rejects.toBeInstanceOf(
      InvalidStructuredOutputError,
    );
    expect(runRaw).toHaveBeenCalledOnce();
  });

  it('accepts an already parsed object without changing its type', async () => {
    const parsed = await runWithSchema(
      fakeProvider([{ classification: 'brand_ip' }]),
      ClassificationSchema,
      request()
    );

    expect(parsed.output).toEqual({ classification: 'brand_ip' });
  });
});
