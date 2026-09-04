import { z } from 'zod';
import {
  JungleScoutClientError,
  type JungleScoutClient,
  type JungleScoutRequestResult
} from './client';

const NullableNumberSchema = z.number().nullable();

export const ProductDatabaseAttributesSchema = z.object({
  title: z.string(),
  brand: z.string().nullable().optional(),
  price: NullableNumberSchema,
  reviews: z.number().int().nullable().optional(),
  rating: NullableNumberSchema,
  parent_asin: z.string().nullable(),
  seller_type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  rank: z.number().int().nullable().optional(),
  weight: NullableNumberSchema.optional(),
  listing_date: z.string().nullable().optional(),
  units_sold_30: z.number().nullable().optional(),
  revenue_30: z.number().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  dimensions: z.unknown().nullable().optional(),
  sellers: z.unknown().nullable().optional(),
  buy_box: z.unknown().nullable().optional(),
  fee_breakdown: z.unknown().nullable().optional()
});
export type ProductDatabaseAttributes = z.infer<typeof ProductDatabaseAttributesSchema>;

export const ProductDatabaseProductSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  attributes: ProductDatabaseAttributesSchema
});
export type ProductDatabaseProduct = z.infer<typeof ProductDatabaseProductSchema>;

export const ProductDatabasePageSchema = z.object({
  data: z.array(ProductDatabaseProductSchema),
  meta: z
    .object({
      result_count: z.number().optional()
    })
    .optional()
});
export type ProductDatabasePage = z.infer<typeof ProductDatabasePageSchema>;

export const ProductDatabaseQueryInputSchema = z.object({
  marketplace: z.literal('us'),
  phrases: z.array(z.string().trim().min(1)).min(1),
  pageSize: z.number().int().min(1).max(100).default(100),
  filters: z.record(z.string(), z.unknown()).optional(),
  sort: z.string().trim().min(1).optional()
});
export type ProductDatabaseQueryInput = z.input<typeof ProductDatabaseQueryInputSchema>;

export function buildProductDatabaseRequest(input: ProductDatabaseQueryInput): {
  readonly path: string;
  readonly method: 'POST';
  readonly json: unknown;
} {
  const parsed = ProductDatabaseQueryInputSchema.parse(input);
  const query = new URLSearchParams({
    marketplace: parsed.marketplace,
    'page[size]': String(parsed.pageSize)
  });
  return {
    path: `/api/product_database_query?${query.toString()}`,
    method: 'POST',
    json: {
      data: {
        type: 'product_database_query',
        attributes: {
          include_keywords: parsed.phrases,
          ...(parsed.filters ? { filters: parsed.filters } : {}),
          ...(parsed.sort ? { sort: parsed.sort } : {})
        }
      }
    }
  };
}

export interface ProductDatabaseQueryResult {
  readonly page: ProductDatabasePage;
  readonly httpAttempts: number;
  readonly status: number;
}

export async function queryProductDatabase(
  client: JungleScoutClient,
  input: ProductDatabaseQueryInput
): Promise<ProductDatabaseQueryResult> {
  const request = buildProductDatabaseRequest(input);
  const result: JungleScoutRequestResult = await client.request(request.path, {
    method: request.method,
    json: request.json
  });
  const parsed = ProductDatabasePageSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new JungleScoutClientError(
      'Jungle Scout response did not match the Product Database schema.',
      result.status,
      false,
      result.httpAttempts,
      parsed.error
    );
  }
  return {
    page: parsed.data,
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}

