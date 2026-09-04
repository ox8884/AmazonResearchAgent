import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const KeywordQueryInputSchema = z.object({
  marketplace: z.literal('us'),
  keyword: z.string().trim().min(1)
});
export type KeywordQueryInput = z.infer<typeof KeywordQueryInputSchema>;

export function buildKeywordRequest(input: KeywordQueryInput): {
  readonly path: string;
  readonly method: 'POST';
  readonly json: unknown;
} {
  const parsed = KeywordQueryInputSchema.parse(input);
  const params = new URLSearchParams({
    marketplace: parsed.marketplace
  });
  return {
    path: `/api/keywords/keywords_by_keyword_query?${params.toString()}`,
    method: 'POST',
    json: {
      data: {
        type: 'keywords_by_keyword_query',
        attributes: {
          search_terms: parsed.keyword
        }
      }
    }
  };
}

export const KeywordMetricsSchema = z.object({
  keyword: z.string(),
  monthlySearchVolume: z.number().nullable(),
  isUpperBound: z.boolean()
});
export type KeywordMetrics = z.infer<typeof KeywordMetricsSchema>;

export interface KeywordQueryResult {
  readonly metrics: KeywordMetrics;
  readonly httpAttempts: number;
  readonly status: number;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseKeywordAttributes(attributes: Record<string, unknown>): {
  readonly monthlySearchVolume: number | null;
  readonly isUpperBound: boolean;
} {
  const volume =
    readNumber(attributes.monthly_search_volume_exact) ??
    readNumber(attributes.monthly_search_volume) ??
    readNumber(attributes.search_volume) ??
    readNumber(attributes.exact_monthly_search_volume);
  const isUpperBound =
    attributes.is_upper_bound === true ||
    attributes.upper_bound === true ||
    attributes.is_estimated === true;
  return { monthlySearchVolume: volume, isUpperBound };
}

export async function queryKeywordMetrics(
  client: JungleScoutClient,
  input: KeywordQueryInput
): Promise<KeywordQueryResult> {
  const request = buildKeywordRequest(input);
  const result = await client.request(request.path, {
    method: request.method,
    json: request.json
  });
  const body = result.body;
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    throw new Error('Keyword metrics response was malformed.');
  }
  const first = body.data[0];
  if (first === undefined) {
    return {
      metrics: {
        keyword: input.keyword,
        monthlySearchVolume: null,
        isUpperBound: false
      },
      httpAttempts: result.httpAttempts,
      status: result.status
    };
  }
  if (typeof first !== 'object' || first === null || !('attributes' in first)) {
    throw new Error('Keyword metrics response was malformed.');
  }
  const attributes = first.attributes;
  if (typeof attributes !== 'object' || attributes === null) {
    throw new Error('Keyword metrics response was malformed.');
  }
  const parsed = parseKeywordAttributes(attributes as Record<string, unknown>);
  return {
    metrics: KeywordMetricsSchema.parse({
      keyword: input.keyword,
      monthlySearchVolume: parsed.monthlySearchVolume,
      isUpperBound: parsed.isUpperBound
    }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
