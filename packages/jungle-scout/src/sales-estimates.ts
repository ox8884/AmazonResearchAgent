import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const SalesEstimatesInputSchema = z.object({
  marketplace: z.literal('us'),
  asins: z.array(z.string().trim().min(1)).min(1)
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

function readNumberSeries(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const series: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      series.push(item);
      continue;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const units =
        typeof record.units === 'number'
          ? record.units
          : typeof record.sales === 'number'
            ? record.sales
            : typeof record.price === 'number'
              ? record.price
              : null;
      if (units !== null && Number.isFinite(units)) {
        series.push(units);
      }
    }
  }
  return series.length > 0 ? series : undefined;
}

export interface SalesEstimatesQueryResult {
  readonly data: SalesEstimates;
  readonly httpAttempts: number;
  readonly status: number;
}

export function buildSalesEstimatesRequest(input: SalesEstimatesInput): {
  readonly path: string;
  readonly method: 'POST';
  readonly json: unknown;
} {
  const parsed = SalesEstimatesInputSchema.parse(input);
  return {
    path: '/api/sales_estimates_query',
    method: 'POST',
    json: {
      data: {
        type: 'sales_estimates_query',
        attributes: {
          marketplace: parsed.marketplace,
          asins: parsed.asins
        }
      }
    }
  };
}

export async function querySalesEstimates(
  client: JungleScoutClient,
  input: SalesEstimatesInput
): Promise<SalesEstimatesQueryResult> {
  const request = buildSalesEstimatesRequest(input);
  const result = await client.request(request.path, {
    method: request.method,
    json: request.json
  });
  const body = result.body;
  const estimates: Array<{
    asin: string;
    estimatedMonthlySales: number | null;
    dailySales?: number[];
    prices?: number[];
  }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== 'object' || row === null || !('id' in row)) {
        continue;
      }
      const asin = typeof row.id === 'string' ? row.id : null;
      const attributes =
        'attributes' in row && row.attributes && typeof row.attributes === 'object'
          ? row.attributes
          : {};
      const estimatedMonthlySales =
        'estimated_monthly_sales' in attributes &&
        typeof attributes.estimated_monthly_sales === 'number'
          ? attributes.estimated_monthly_sales
          : null;
      const dailySales = readNumberSeries(
        'daily_sales' in attributes ? attributes.daily_sales : undefined
      );
      const prices = readNumberSeries('prices' in attributes ? attributes.prices : undefined);
      if (asin) {
        estimates.push({
          asin,
          estimatedMonthlySales,
          ...(dailySales ? { dailySales } : {}),
          ...(prices ? { prices } : {})
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
