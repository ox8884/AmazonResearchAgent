import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProductDatabasePageSchema,
  buildProductDatabaseRequest
} from './product-database';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/jungle-scout/product-database-sink.json'
);
const SINK_FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

describe('Jungle Scout Product Database adapter', () => {
  // Break: missing price/rating/weight become zero.
  it('preserves missing fields instead of substituting zero', () => {
    const page = ProductDatabasePageSchema.parse(SINK_FIXTURE);
    const missingPrice = page.data.find((product) =>
      product.attributes.title.includes('NiuYichee')
    );

    expect(missingPrice?.attributes.price).toBeNull();
    expect(missingPrice?.attributes.rating).toBeNull();
    expect(missingPrice?.attributes.weight).toBeNull();
    expect(missingPrice?.id).toBe('B0MISSING1');
    expect(missingPrice?.attributes.parent_asin).toBeNull();
  });

  // Break: catalog phrases are sent as customer keyword search instead of an OR query.
  it('builds a US Product Database catalog-phrase OR query', () => {
    const request = buildProductDatabaseRequest({
      marketplace: 'us',
      phrases: ['faucet mat', 'sink splash guard'],
      pageSize: 100
    });

    expect(request.path).toBe('/api/product_database_query');
    expect(request.method).toBe('POST');
    expect(request.json).toMatchObject({
      data: {
        type: 'product_database_query',
        attributes: {
          marketplace: 'us',
          include_keywords: ['faucet mat', 'sink splash guard'],
          page_size: 100
        }
      }
    });
  });
});
