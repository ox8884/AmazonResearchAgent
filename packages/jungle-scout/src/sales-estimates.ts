import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const SalesEstimatesInputSchema = z.object({
  marketplace: z.literal('us'),
  asin: z.string().trim().min(1),
  startDate: z.iso.date(),
  endDate: z.iso.date()
});
export type SalesEstimatesInput = z.infer<typeof SalesEstimatesInputSchema>;

const SalesEstimateSchema = z.object({
  asin: z.string(),
  estimatedMonthlySales: z.number().nullable(),
  prices: z.array(z.number()).optional(),
  dailySales: z.array(z.number()).optional()
});

export const SalesEstimatesSchema = z.object({
  estimates: z.array(SalesEstimateSchema)
});
export type SalesEstimates = z.infer<typeof SalesEstimatesSchema>;

export interface SalesEstimatesQueryResult {
  readonly data: SalesEstimates;
  readonly httpAttempts: number;
  readonly status: number;
}

export function buildSalesEstimatesRequest(input: SalesEstimatesInput): {
  readonly path: string;
  readonly method: 'GET';
} {
  const parsed = SalesEstimatesInputSchema.parse(input);
  const params = new URLSearchParams({
    marketplace: parsed.marketplace,
    asin: parsed.asin,
    start_date: parsed.startDate,
    end_date: parsed.endDate
  });
  return {
    path: `/api/sales_estimates_query?${params.toString()}`,
    method: 'GET'
  };
}

export async function querySalesEstimates(
  client: JungleScoutClient,
  input: SalesEstimatesInput
): Promise<SalesEstimatesQueryResult> {
  const request = buildSalesEstimatesRequest(input);
  const result = await client.request(request.path, { method: request.method });
  const body = result.body;
  const estimates: Array<{
    asin: string;
    estimatedMonthlySales: number | null;
    dailySales?: number[];
    prices?: number[];
  }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== 'object' || row === null || !('attributes' in row)) {
        continue;
      }
      const attributes =
        'attributes' in row && row.attributes && typeof row.attributes === 'object'
          ? row.attributes
          : {};
      const asin = typeof attributes.asin === 'string' ? attributes.asin : null;
      const series = Array.isArray(attributes.data) ? attributes.data : [];
      const dailySales: number[] = [];
      const prices: number[] = [];
      for (const point of series) {
        if (!point || typeof point !== 'object') {
          continue;
        }
        const record = point as Record<string, unknown>;
        if (typeof record.estimated_units_sold === 'number') {
          dailySales.push(record.estimated_units_sold);
        }
        if (typeof record.last_known_price === 'number') {
          prices.push(record.last_known_price);
        }
      }
      if (asin) {
        estimates.push({
          asin,
          estimatedMonthlySales:
            dailySales.length > 0
              ? dailySales.reduce((total, value) => total + value, 0)
              : null,
          ...(dailySales.length > 0 ? { dailySales } : {}),
          ...(prices.length > 0 ? { prices } : {})
        });
      }
    }
  }
  return {
    data: SalesEstimatesSchema.parse({ estimates }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
