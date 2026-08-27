import { z } from 'zod';

export const LocaleSchema = z.enum(['ko', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const CandidateStateSchema = z.enum([
  'Discovered',
  'Rule Filter',
  'AI Screening',
  'Ready for API Validation',
  'Waiting for API Budget',
  'API Validation Running',
  'Deep Research',
  'Strong',
  'Watch',
  'Reject',
  'Needs Review',
  'Waiting for AI Capacity',
  'Needs Attention'
]);
export type CandidateState = z.infer<typeof CandidateStateSchema>;

export const ImportRunStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed'
]);
export type ImportRunStatus = z.infer<typeof ImportRunStatusSchema>;

export const RuleCodeSchema = z.enum([
  'PRICE_OUT_OF_RANGE',
  'SEASONALITY_HIGH',
  'ELECTRIC_OR_BATTERY',
  'IRRELEVANT_SUBDOMAIN',
  'BRAND_OR_IP',
  'BROAD_SHOPPING_INTENT',
  'FRAGILE_OR_HEAVY_RISK'
]);
export type RuleCode = z.infer<typeof RuleCodeSchema>;

const SearchVolumeValueSchema = z.object({
  value: z.number().finite().nonnegative(),
  isUpperBound: z.boolean()
});

export const SearchVolumeSchema = z.preprocess(
  (input) =>
    typeof input === 'number'
      ? { value: input, isUpperBound: false }
      : input,
  SearchVolumeValueSchema
);
export type SearchVolume = z.infer<typeof SearchVolumeSchema>;

export const OpportunityCsvRowSchema = z.object({
  keyword: z.string().trim().min(1),
  nicheScore: z.number().finite().min(0).max(10),
  monthlyUnits: z.number().finite().int().nonnegative(),
  averagePrice: z.number().finite().nonnegative(),
  searchVolume: SearchVolumeSchema,
  trend30: z.number().finite(),
  trend90: z.number().finite(),
  competition: z.enum(['Very Low', 'Low', 'Medium', 'High', 'Very High']),
  seasonality: z.enum(['Very Low', 'Low', 'Medium', 'High', 'Very High']),
  lastUpdated: z.string().trim().min(1)
});
export type OpportunityCsvRow = z.infer<typeof OpportunityCsvRowSchema>;
export type OpportunityCsvRowInput = z.input<typeof OpportunityCsvRowSchema>;

export const ImportFileReferenceSchema = z.object({
  sourceFileName: z.string().trim().min(1),
  storagePath: z
    .string()
    .trim()
    .min(1)
    .refine(
      (path) => !path.startsWith('/') && !path.split('/').includes('..'),
      'storagePath must be a relative private object path'
    ),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/)
});
export type ImportFileReference = z.infer<typeof ImportFileReferenceSchema>;

export const ImportOpportunityCsvJobPayloadSchema = z.object({
  importRunId: z.uuid(),
  storageBucket: z.string().trim().min(1),
  files: z.array(ImportFileReferenceSchema).min(1).max(20)
});
export type ImportOpportunityCsvJobPayload = z.infer<
  typeof ImportOpportunityCsvJobPayloadSchema
>;

export const RuleReasonSchema = z.object({
  code: RuleCodeSchema,
  detail: z.string().min(1)
});
export type RuleReason = z.infer<typeof RuleReasonSchema>;

export const PreliminaryCandidateSchema = z.object({
  keyword: z.string().min(1),
  state: CandidateStateSchema,
  preliminaryScore: z.number().finite().min(0).max(100),
  eligibleForAiNormalization: z.boolean(),
  ruleReasons: z.array(RuleReasonSchema),
  flags: z.array(z.string().min(1))
});
export type PreliminaryCandidate = z.infer<typeof PreliminaryCandidateSchema>;
