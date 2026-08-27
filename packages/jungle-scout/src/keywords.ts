import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const KeywordQueryInputSchema = z.object({
  marketplace: z.literal('us'),
  keyword: z.string().trim().min(1)
});
export type KeywordQueryInput = z.infer<typeof KeywordQueryInputSchema>;

export function buildKeywordRequest(input: KeywordQueryInput): {
  readonly path: string;
  readonly method: 'GET';
} {
  const parsed = KeywordQueryInputSchema.parse(input);
  const params = new URLSearchParams({
    marketplace: parsed.marketplace,
    keyword: parsed.keyword
  });
  return {
    path: `/api/keywords/by_keyword?${params.toString()}`,
    method: 'GET'
  };
}

export const KeywordMetricsSchema = z.object({
  keyword: z.string(),
  monthlySearchVolume: z.number().nullable(),
  isUpperBound: z.boolean().default(false)
});
export type KeywordMetrics = z.infer<typeof KeywordMetricsSchema>;

export async function queryKeywordMetrics(
  client: JungleScoutClient,
  input: KeywordQueryInput
): Promise<KeywordMetrics> {
  const request = buildKeywordRequest(input);
  const result = await client.request(request.path, { method: request.method });
  const body = result.body;
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return {
      keyword: input.keyword,
      monthlySearchVolume: null,
      isUpperBound: false
    };
  }
  return KeywordMetricsSchema.parse({
    keyword: input.keyword,
    monthlySearchVolume: null,
    isUpperBound: false
  });
}
