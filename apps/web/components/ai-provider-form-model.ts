import {
  BillingTypeSchema,
  type CopyKey
} from '@ara/shared';
import ky from 'ky';
import { z } from 'zod';

export const ProviderModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  billingType: BillingTypeSchema,
  capabilities: z.array(z.string()),
  qualityRank: z.number(),
  enabled: z.boolean().default(true),
  priority: z.number().default(100),
  origin: z.string().default('manual')
});

const HttpProviderSchema = z.object({
  id: z.string(),
  product: z.literal('openai_compatible_api'),
  productLabel: z.string(),
  name: z.string(),
  billingType: BillingTypeSchema,
  enabled: z.boolean(),
  priority: z.number().default(100),
  secretLast4: z.string().nullable(),
  roles: z.array(z.string()).default([]),
  baseUrl: z.string().nullable(),
  networkScope: z.enum(['public', 'private', 'loopback']).nullable(),
  modelId: z.string().nullable(),
  openRouterProvider: z.literal('z-ai').nullable().default(null),
  settingsRevision: z.number().default(1),
  models: z.array(ProviderModelSchema)
});

const SubscriptionStatusSchema = z.enum([
  'setup_required',
  'disabled',
  'ready',
  'expired',
  'needs_attention',
  'unavailable'
]);

const SubscriptionReasonSchema = z.enum([
  'setup_required',
  'authorization_expired',
  'probe_pending',
  'temporarily_unavailable',
  'disabled'
]);

const SubscriptionProviderSchema = z.object({
  id: z.string(),
  product: z.enum(['codex_subscription', 'grok_subscription']),
  productLabel: z.string(),
  name: z.string(),
  billingType: z.literal('subscription'),
  enabled: z.boolean(),
  priority: z.number().default(100),
  role: z.literal('niche_normalization'),
  modelLabel: z.string(),
  setupStatus: SubscriptionStatusSchema,
  statusReason: SubscriptionReasonSchema.nullable(),
  lastCheckedAt: z.string().nullable(),
  settingsRevision: z.number().default(1)
});

export const SavedProviderSchema = z.discriminatedUnion('product', [
  HttpProviderSchema,
  SubscriptionProviderSchema
]);
export const ProviderResponseSchema = z.object({ provider: SavedProviderSchema });
export const ProviderListSchema = z.object({ providers: z.array(SavedProviderSchema) });
export const ConnectionJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued')
});

const ConnectionResultSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  result: z.unknown(),
  errorCategory: z.string().nullable()
});

export type SavedProvider = z.infer<typeof SavedProviderSchema>;
export type HttpProvider = z.infer<typeof HttpProviderSchema>;
export type SubscriptionProvider = z.infer<typeof SubscriptionProviderSchema>;
export type CopyDictionary = Readonly<Record<CopyKey, string>>;

export type ProviderTestResult =
  | { readonly kind: 'completed'; readonly available: boolean; readonly models: readonly string[]; readonly errorCategory: string | null }
  | { readonly kind: 'failed'; readonly errorCategory: string | null }
  | { readonly kind: 'timed_out' }
  | { readonly kind: 'inconclusive' };

export function clearProviderTestResult(
  results: Readonly<Record<string, ProviderTestResult>>,
  providerId: string
): Readonly<Record<string, ProviderTestResult>> {
  return Object.fromEntries(
    Object.entries(results).filter(([id]) => id !== providerId)
  );
}

export interface ProviderTestPollOptions {
  readonly maxAttempts?: number;
  readonly getResult?: (jobId: string) => Promise<unknown>;
  readonly pause?: (milliseconds: number) => Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

async function getProviderTest(jobId: string): Promise<unknown> {
  return ky.get(`/api/ai-provider-tests/${encodeURIComponent(jobId)}`, {
    credentials: 'same-origin'
  }).json<unknown>();
}

function providerResult(value: unknown): {
  readonly available: boolean;
  readonly models: readonly string[];
  readonly errorCategory: string | null;
} | null {
  if (typeof value !== 'object' || value === null || !('providerTest' in value)) return null;
  const providerTest = value.providerTest;
  if (
    typeof providerTest !== 'object' ||
    providerTest === null ||
    !('available' in providerTest) ||
    !('models' in providerTest) ||
    typeof providerTest.available !== 'boolean' ||
    !Array.isArray(providerTest.models) ||
    ('errorCategory' in providerTest &&
      providerTest.errorCategory !== null &&
      typeof providerTest.errorCategory !== 'string') ||
    !providerTest.models.every((model) => typeof model === 'string')
  ) return null;
  return {
    available: providerTest.available,
    models: providerTest.models,
    errorCategory:
      'errorCategory' in providerTest && typeof providerTest.errorCategory === 'string'
        ? providerTest.errorCategory
        : null
  };
}

export async function waitForProviderTest(
  jobId: string,
  options: ProviderTestPollOptions = {}
): Promise<ProviderTestResult> {
  const maxAttempts = options.maxAttempts ?? 30;
  const readResult = options.getResult ?? getProviderTest;
  const pause = options.pause ?? delay;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = ConnectionResultSchema.parse(await readResult(jobId));
    if (response.jobId !== jobId) return { kind: 'inconclusive' };
    if (response.status === 'completed') {
      const result = providerResult(response.result);
      if (result?.errorCategory === 'provider_probe_requested') return { kind: 'inconclusive' };
      return result ? { kind: 'completed', ...result } : { kind: 'inconclusive' };
    }
    if (response.status === 'failed') {
      return { kind: 'failed', errorCategory: response.errorCategory };
    }
    await pause(500);
  }
  return { kind: 'timed_out' };
}
