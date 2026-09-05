import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient, JungleScoutClientError } from './client';
import {
  ProductDatabasePageSchema,
  buildProductDatabaseRequest,
  queryProductDatabase
} from './product-database';
import { listenOnFetchSafeLoopback } from '../../../test-harness/safe-loopback-server.mjs';

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

  it('accepts a Product Database row when weight is omitted', () => {
    const page = ProductDatabasePageSchema.parse({
      data: [
        {
          id: 'B0LIVE1',
          type: 'product_database_result',
          attributes: {
            title: 'Drawer organizer',
            price: 19.99,
            rating: 4.5,
            parent_asin: null
          }
        }
      ]
    });

    expect(page.data[0]?.attributes.weight).toBeUndefined();
  });

  it('normalizes the JSON API marketplace prefix out of product ASINs', () => {
    const page = ProductDatabasePageSchema.parse({
      data: [
        {
          id: 'us/B0LIVE1',
          type: 'product_database_result',
          attributes: {
            title: 'Drawer organizer',
            price: 19.99,
            rating: 4.5,
            parent_asin: 'us/B0PARENT1'
          }
        }
      ]
    });

    expect(page.data[0]?.id).toBe('B0LIVE1');
    expect(page.data[0]?.attributes.parent_asin).toBe('B0PARENT1');
  });

  it('keeps dimensions, sellers, buy box, and fee breakdown from the fixture', () => {
    const page = ProductDatabasePageSchema.parse(SINK_FIXTURE);
    const mat = page.data.find((product) => product.id === 'B0SINKMAT1');
    expect(mat?.attributes.seller_type).toBe('FBA');
    expect(mat?.attributes.listing_date).toBe('2024-03-01');
    expect(mat?.attributes.dimensions).toEqual({ length: 5.5, width: 5.5, height: 0.2 });
    expect(mat?.attributes.sellers).toBe(12);
    expect(mat?.attributes.buy_box).toEqual({ price: 12.99, seller_type: 'FBA' });
    expect(mat?.attributes.fee_breakdown).toEqual({ referral: 1.95, fba: 3.22 });
  });


  // Break: catalog phrases are sent as customer keyword search instead of an OR query.
  it('builds a US Product Database catalog-phrase OR query', () => {
    const request = buildProductDatabaseRequest({
      marketplace: 'us',
      phrases: ['faucet mat', 'sink splash guard'],
      pageSize: 100
    });

    expect(request.path).toBe(
      '/api/product_database_query?marketplace=us&page%5Bsize%5D=100'
    );
    expect(request.method).toBe('POST');
    expect(request.json).toMatchObject({
      data: {
        type: 'product_database_query',
        attributes: {
          include_keywords: ['faucet mat', 'sink splash guard'],
        }
      }
    });
  });

  it('includes optional filters and sort when provided', () => {
    const request = buildProductDatabaseRequest({
      marketplace: 'us',
      phrases: ['faucet mat'],
      pageSize: 50,
      filters: { min_price: 10 },
      sort: 'units_sold_30_desc'
    });
    expect(request.path).toBe(
      '/api/product_database_query?marketplace=us&page%5Bsize%5D=50'
    );
    expect(request.json).toMatchObject({
      data: {
        attributes: {
          include_keywords: ['faucet mat'],
          filters: { min_price: 10 },
          sort: 'units_sold_30_desc'
        }
      }
    });
  });


  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  // Break: a successful 500-500-200 Product Database call discards HTTP attempt metadata.
  it('returns actual attempt count after explicitly enabled retries reach HTTP 200', async () => {
    let hits = 0;
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      hits += 1;
      if (hits < 3) {
        response.statusCode = 500;
        response.end(JSON.stringify({ errors: [{ status: '500' }] }));
        return;
      }
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ data: [] }));
    });
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url,
      retryLimit: 2
    });
    const result = await queryProductDatabase(client, {
      marketplace: 'us',
      phrases: ['faucet mat']
    });
    expect(hits).toBe(3);
    expect(result.httpAttempts).toBe(3);
    expect(result.status).toBe(200);
    expect(result.page.data).toEqual([]);
  });

  it('keeps HTTP metadata when a successful response has an invalid schema', async () => {
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ data: [{ type: 'product_database_result' }] }));
    });
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url
    });

    await expect(
      queryProductDatabase(client, { marketplace: 'us', phrases: ['faucet mat'] })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof JungleScoutClientError &&
        error.status === 200 &&
        error.httpAttempts === 1 &&
        error.retryable === false
    );
  });


  it('exposes one actual attempt on terminal HTTP 500 by default', async () => {
    let hits = 0;
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      hits += 1;
      response.statusCode = 500;
      response.end(JSON.stringify({ errors: [{ status: '500' }] }));
    });
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url
    });
    await expect(
      queryProductDatabase(client, { marketplace: 'us', phrases: ['faucet mat'] })
    ).rejects.toMatchObject({
      status: 500,
      httpAttempts: 1
    });
    expect(hits).toBe(1);
  });
});

