import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import {
  ProductDatabasePageSchema,
  buildProductDatabaseRequest,
  queryProductDatabase
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

  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  // Break: a successful 500-500-200 Product Database call discards HTTP attempt metadata.
  it('returns actual attempt count after retrying to HTTP 200', async () => {
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
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    server = http;
    const address = http.address() as AddressInfo;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: `http://127.0.0.1:${address.port}`
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


  it('exposes actual attempt count on terminal HTTP 500', async () => {
    let hits = 0;
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      hits += 1;
      response.statusCode = 500;
      response.end(JSON.stringify({ errors: [{ status: '500' }] }));
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    server = http;
    const address = http.address() as AddressInfo;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: `http://127.0.0.1:${address.port}`
    });
    await expect(
      queryProductDatabase(client, { marketplace: 'us', phrases: ['faucet mat'] })
    ).rejects.toMatchObject({
      status: 500,
      httpAttempts: 3
    });
    expect(hits).toBe(3);
  });
});


