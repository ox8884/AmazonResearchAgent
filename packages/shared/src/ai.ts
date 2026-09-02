import { z } from 'zod';
import { LocaleSchema } from './domain';

export const AiRoleSchema = z.enum([
  'bulk_classification',
  'niche_normalization',
  'deep_market_analysis',
  'strong_cross_validation',
  'review_mining',
  'supplier_negotiation',
  'daily_digest'
]);
export type AiRole = z.infer<typeof AiRoleSchema>;

export const BillingTypeSchema = z.enum(['free', 'subscription', 'payg']);
export type BillingType = z.infer<typeof BillingTypeSchema>;

export const RouterModeSchema = z.enum(['Saver', 'Balanced', 'Highest Quality']);
export type RouterMode = z.infer<typeof RouterModeSchema>;

export const ProviderKindSchema = z.enum([
  'openai_http',
  'command',
  'subscription_command'
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const SubscriptionAdapterSchema = z.enum(['codex', 'grok']);
export type SubscriptionAdapter = z.infer<typeof SubscriptionAdapterSchema>;

export const ProviderRuntimeStateSchema = z.enum([
  'authorization_required',
  'ready',
  'expired',
  'needs_attention'
]);
export type ProviderRuntimeState = z.infer<typeof ProviderRuntimeStateSchema>;

export const ProviderAttemptEventTypeSchema = z.enum([
  'attempt_started',
  'attempt_succeeded',
  'attempt_failed',
  'attempt_cancelled',
  'attempt_not_consumed',
  'attempt_unknown_after_crash'
]);
export type ProviderAttemptEventType = z.infer<typeof ProviderAttemptEventTypeSchema>;

export const ProviderConsumptionStatusSchema = z.enum([
  'consumed',
  'not_consumed',
  'unknown'
]);
export type ProviderConsumptionStatus = z.infer<
  typeof ProviderConsumptionStatusSchema
>;

export const SubscriptionFailureClassSchema = z.enum([
  'auth_expired',
  'credential_source_mismatch',
  'binary_identity_mismatch',
  'profile_mismatch',
  'containment_failure',
  'capability_failure',
  'capacity_exhausted',
  'rate_limited',
  'transient_network',
  'client_transient',
  'timeout',
  'cancelled_by_caller',
  'cancelled_by_job_lease_loss',
  'cancelled_by_shutdown',
  'unsafe_unknown',
  'schema_invalid_output',
  'business_validation_failure',
  'process_spawn_failure_pre_consumption'
]);
export type SubscriptionFailureClass = z.infer<
  typeof SubscriptionFailureClassSchema
>;

export const JobLeaseIdentitySchema = z.object({
  jobId: z.string().trim().min(1),
  jobLeaseOwner: z.string().trim().min(1),
  jobLeaseEpoch: z.number().int().positive()
});
export type JobLeaseIdentity = z.infer<typeof JobLeaseIdentitySchema>;

export const AnalysisLeaseIdentitySchema = z.object({
  analysisId: z.string().trim().min(1),
  analysisLeaseOwner: z.string().trim().min(1),
  analysisLeaseEpoch: z.number().int().positive()
});
export type AnalysisLeaseIdentity = z.infer<typeof AnalysisLeaseIdentitySchema>;

export const ProbeGenerationSchema = z.number().int().nonnegative();
export type ProbeGeneration = z.infer<typeof ProbeGenerationSchema>;


export const ProviderCapabilitySchema = z.enum([
  'structured_json',
  'chat_completions',
  'responses',
  'model_discovery',
  'health'
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

const JsonObjectSchema = z.record(z.string(), z.unknown());

export const AiRequestSchema = z.object({
  role: AiRoleSchema,
  routerMode: RouterModeSchema,
  locale: LocaleSchema,
  allowPaidFallback: z.boolean().default(false),
  paidPrimaryProviderIds: z.array(z.string().trim().min(1)).default([]),
  requiredCapabilities: z
    .array(ProviderCapabilitySchema)
    .min(1)
    .default(['structured_json']),
  primaryProviderId: z.string().trim().min(1).optional(),
  excludeProviderIds: z.array(z.string().trim().min(1)).default([]),
  payload: JsonObjectSchema
});
export type AiRequest = z.infer<typeof AiRequestSchema>;

export const AiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  requestCount: z.number().int().positive().default(1)
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

const CommonProviderConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(false),
  priority: z.number().int().nonnegative().default(100)
});

const HttpProviderConfigSchema = CommonProviderConfigSchema.extend({
  kind: z.literal('openai_http'),
  adapter: z.null().optional(),
  billingType: BillingTypeSchema,
  config: JsonObjectSchema.default({})
});

const CommandProviderConfigSchema = CommonProviderConfigSchema.extend({
  kind: z.literal('command'),
  adapter: z.null().optional(),
  billingType: z.enum(['free', 'subscription']),
  config: JsonObjectSchema.default({})
});

const SubscriptionProductConfigSchema = z
  .object({
    role: z.literal('niche_normalization'),
    modelId: z.string().trim().min(1).max(200).regex(/^[\w.:/=+-]+$/u),
    modelEnabled: z.boolean(),
    modelPriority: z.number().int().nonnegative()
  })
  .strict();

const SubscriptionProviderConfigSchema = CommonProviderConfigSchema.extend({
  kind: z.literal('subscription_command'),
  adapter: SubscriptionAdapterSchema,
  billingType: z.literal('subscription'),
  config: SubscriptionProductConfigSchema
});

export const AiProviderConfigSchema = z.discriminatedUnion('kind', [
  HttpProviderConfigSchema,
  CommandProviderConfigSchema,
  SubscriptionProviderConfigSchema
]);
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

export const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w.:/=+-]+$/u, 'Model ID contains unsupported characters.');

export class UnsafeModelIdError extends Error {
  constructor(message = 'Model ID is not persistable.') {
    super(message);
    this.name = 'UnsafeModelIdError';
  }
}

export function assertPersistableModelId(
  modelId: string,
  secretPlaintext?: string
): string {
  const parsed = ModelIdSchema.parse(modelId);
  if (secretPlaintext && parsed === secretPlaintext) {
    throw new UnsafeModelIdError('Model ID must not equal provider secret material.');
  }
  if (
    secretPlaintext &&
    secretPlaintext.length >= 16 &&
    parsed.includes(secretPlaintext)
  ) {
    throw new UnsafeModelIdError('Model ID must not contain provider secret material.');
  }
  return parsed;
}


export const AiModelDescriptorSchema = z.object({
  providerId: z.string().trim().min(1),
  id: ModelIdSchema,
  displayName: z.string().trim().min(1),
  capabilities: z.array(ProviderCapabilitySchema).min(1),
  billingType: BillingTypeSchema,
  qualityRank: z.number().int().nonnegative().default(100)
});
export type AiModelDescriptor = z.infer<typeof AiModelDescriptorSchema>;

export interface AiResult<T> {
  readonly output: T;
  readonly providerId: string;
  readonly modelId: string;
  readonly role: AiRole;
  readonly inputHash: string;
  readonly usage: AiUsage;
  readonly costClass: BillingType;
  readonly startedAt: string;
  readonly completedAt: string;
}


export const NormalizeOpportunitiesJobPayloadSchema = z.object({
  candidateIds: z.tuple([z.uuid()]),
  locale: LocaleSchema,
  normalizationGeneration: z.number().int().nonnegative().safe(),
  promptVersion: z.string().trim().min(1).default('niche-normalization-v1')
}).strict();
export type NormalizeOpportunitiesJobPayload = z.infer<
  typeof NormalizeOpportunitiesJobPayloadSchema
>;

export const TestAiProviderConnectionJobPayloadSchema = z.object({
  providerId: z.string().trim().min(1)
});
export type TestAiProviderConnectionJobPayload = z.infer<
  typeof TestAiProviderConnectionJobPayloadSchema
>;
