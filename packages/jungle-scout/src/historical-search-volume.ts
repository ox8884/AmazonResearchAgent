import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const HistoricalSearchVolumeInputSchema = z.object({
  marketplace: z.literal('us'),
  keyword: z.string().trim().min(1)
});
export type HistoricalSearchVolumeInput = z.infer<typeof HistoricalSearchVolumeInputSchema>;

const HistoricalPointSchema = z.object({
  month: z.string(),
  searchVolume: z.number().nullable()
});

export const HistoricalSearchVolumeSchema = z.object({
  keyword: z.string(),
  points: z.array(HistoricalPointSchema)
});
export type HistoricalSearchVolume = z.infer<typeof HistoricalSearchVolumeSchema>;

export interface HistoricalSearchVolumeQueryResult {
  readonly data: HistoricalSearchVolume;
  readonly httpAttempts: number;
  readonly status: number;
}

export function buildHistoricalSearchVolumeRequest(input: HistoricalSearchVolumeInput): {
  readonly path: string;
  readonly method: 'GET';
} {
  const parsed = HistoricalSearchVolumeInputSchema.parse(input);
  const params = new URLSearchParams({
    marketplace: parsed.marketplace,
    keyword: parsed.keyword
  });
  return {
    path: `/api/keywords/historical_search_volume?${params.toString()}`,
    method: 'GET'
  };
}

export async function queryHistoricalSearchVolume(
  client: JungleScoutClient,
  input: HistoricalSearchVolumeInput
): Promise<HistoricalSearchVolumeQueryResult> {
  const request = buildHistoricalSearchVolumeRequest(input);
  const result = await client.request(request.path, { method: request.method });
  const body = result.body;
  const points: Array<{ month: string; searchVolume: number | null }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== 'object' || row === null || !('attributes' in row)) {
        continue;
      }
      const attributes = (row as { attributes?: Record<string, unknown> }).attributes ?? {};
      const month = typeof attributes.month === 'string' ? attributes.month : null;
      const searchVolume =
        typeof attributes.search_volume === 'number' ? attributes.search_volume : null;
      if (month) {
        points.push({ month, searchVolume });
      }
    }
  }
  return {
    data: HistoricalSearchVolumeSchema.parse({ keyword: input.keyword, points }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
