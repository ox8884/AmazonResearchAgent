import { z } from 'zod';
import type { JungleScoutClient } from './client';

export const SalesEstimatesInputSchema = z.object({
  marketplace: z.literal('us'),
  asins: z.array(z.string().trim().min(1)).min(1)
});
export type SalesEstimatesInput = z.infer<typeof SalesEstimatesInputSchema>;

const SalesEstimateSchema = z.object({
  asin: z.string(),
  estimatedMonthlySales: z.number().nullable()
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
  const estimates: Array<{ asin: string; estimatedMonthlySales: number | null }> = [];
  if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
    for (const row of body.data) {
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const record = row as { id?: unknown; attributes?: Record<string, unknown> };
      const asin = typeof record.id === 'string' ? record.id : null;
      const estimatedMonthlySales =
        typeof record.attributes?.estimated_monthly_sales === 'number'
          ? record.attributes.estimated_monthly_sales
          : null;
      if (asin) {
        estimates.push({ asin, estimatedMonthlySales });
      }
    }
  }
  return {
    data: SalesEstimatesSchema.parse({ estimates }),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}
