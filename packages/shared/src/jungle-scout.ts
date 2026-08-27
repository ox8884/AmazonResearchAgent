import { z } from 'zod';

export const JungleScoutEndpointSchema = z.enum([
  'product_database',
  'keywords_by_keyword',
  'historical_search_volume',
  'sales_estimates',
  'share_of_voice'
]);
export type JungleScoutEndpoint = z.infer<typeof JungleScoutEndpointSchema>;

export const ApiCallPurposeSchema = z.enum([
  'normal_validation',
  'manual_research',
  'strong_revalidation'
]);
export type ApiCallPurpose = z.infer<typeof ApiCallPurposeSchema>;

export const ApiCacheKeyInputSchema = z.object({
  endpoint: JungleScoutEndpointSchema,
  marketplace: z.string().trim().min(1).toLowerCase(),
  phrases: z.array(z.string()),
  filters: z.record(z.string(), z.unknown()).default({}),
  version: z.string().trim().min(1).default('v1')
});
export type ApiCacheKeyInput = z.input<typeof ApiCacheKeyInputSchema>;

function canonicalPhrases(phrases: readonly string[]): readonly string[] {
  return [...new Set(
    phrases
      .map((phrase) => phrase.trim().toLocaleLowerCase('en-US'))
      .filter((phrase) => phrase.length > 0)
  )].sort((left, right) => left.localeCompare(right, 'en'));
}

export function makeApiCacheKey(input: ApiCacheKeyInput): string {
  const parsed = ApiCacheKeyInputSchema.parse(input);
  return [
    parsed.endpoint,
    parsed.marketplace,
    canonicalPhrases(parsed.phrases).join('\u0001'),
    parsed.version,
    JSON.stringify(parsed.filters)
  ].join('\u0000');
}

export const MarketSnapshotSchema = z.object({
  observedSampleSales: z.number().nonnegative(),
  estimatedMarketSales: z.number().nonnegative().nullable(),
  sampleProductFamilyCount: z.number().int().nonnegative(),
  sourceEndpointSet: z.array(JungleScoutEndpointSchema).min(1),
  capturedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1)
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
