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

export const ProviderKindSchema = z.enum(['openai_http', 'command']);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

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
  requiredCapabilities: z
    .array(ProviderCapabilitySchema)
    .min(1)
    .default(['structured_json']),
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

export const AiProviderConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: ProviderKindSchema,
  billingType: BillingTypeSchema,
  enabled: z.boolean().default(false),
  priority: z.number().int().nonnegative().default(100),
  config: JsonObjectSchema.default({})
});
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

export const AiModelDescriptorSchema = z.object({
  providerId: z.string().trim().min(1),
  id: z.string().trim().min(1),
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
