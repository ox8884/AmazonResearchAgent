import { z } from 'zod';
import type { JungleScoutClient, JungleScoutRequestResult } from './client';

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
  weight: NullableNumberSchema,
  listing_date: z.string().nullable().optional(),
  units_sold_30: z.number().nullable().optional(),
  revenue_30: z.number().nullable().optional(),
  updated_at: z.string().nullable().optional()
});
export type ProductDatabaseAttributes = z.infer<typeof ProductDatabaseAttributesSchema>;

export const ProductDatabaseProductSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  attributes: ProductDatabaseAttributesSchema
});
export type ProductDatabaseProduct = z.infer<typeof ProductDatabaseProductSchema>;

export const ProductDatabasePageSchema = z.object({
  data: z.array(ProductDatabaseProductSchema)
});
export type ProductDatabasePage = z.infer<typeof ProductDatabasePageSchema>;

export const ProductDatabaseQueryInputSchema = z.object({
  marketplace: z.literal('us'),
  phrases: z.array(z.string().trim().min(1)).min(1),
  pageSize: z.number().int().min(1).max(100).default(100)
});
export type ProductDatabaseQueryInput = z.input<typeof ProductDatabaseQueryInputSchema>;

export function buildProductDatabaseRequest(input: ProductDatabaseQueryInput): {
  readonly path: string;
  readonly method: 'POST';
  readonly json: unknown;
} {
  const parsed = ProductDatabaseQueryInputSchema.parse(input);
  return {
    path: '/api/product_database_query',
    method: 'POST',
    json: {
      data: {
        type: 'product_database_query',
        attributes: {
          marketplace: parsed.marketplace,
          include_keywords: parsed.phrases,
          page_size: parsed.pageSize
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
  return {
    page: ProductDatabasePageSchema.parse(result.body),
    httpAttempts: result.httpAttempts,
    status: result.status
  };
}

