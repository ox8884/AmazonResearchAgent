import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import { queryHistoricalSearchVolume } from './historical-search-volume';
import { querySalesEstimates } from './sales-estimates';
import { queryShareOfVoice } from './share-of-voice';

describe('Jungle Scout Task 11 adapters', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function listen(
    handler: (request: IncomingMessage, response: ServerResponse) => void
  ): Promise<JungleScoutClient> {
    const http = createServer(handler);
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    server = http;
    const address = http.address() as AddressInfo;
    return new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: `http://127.0.0.1:${address.port}`
    });
  }

  // Break: Historical Search Volume fabricates monthly volume.
  it('parses Historical Search Volume nulls from the provider body', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [{ attributes: { month: '2026-01', search_volume: null } }]
        })
      );
    });
    const result = await queryHistoricalSearchVolume(client, {
      marketplace: 'us',
      keyword: 'faucet mat'
    });
    expect(result.status).toBe(200);
    expect(result.httpAttempts).toBe(1);
    expect(result.data.points).toEqual([{ month: '2026-01', searchVolume: null }]);
  });

  // Break: Sales Estimates invent 29.99 economics.
  it('parses Sales Estimates without substituting a fabricated number', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [{ id: 'B0ASINTEST', attributes: { estimated_monthly_sales: null } }]
        })
      );
    });
    const result = await querySalesEstimates(client, {
      marketplace: 'us',
      asins: ['B0ASINTEST']
    });
    expect(result.data.estimates).toEqual([
      { asin: 'B0ASINTEST', estimatedMonthlySales: null }
    ]);
  });

  // Break: Share of Voice invents listing_proxy share.
  it('parses Share of Voice rows from the provider body', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [{ id: 'B0ASINTEST', attributes: { share: 0.12 } }]
        })
      );
    });
    const result = await queryShareOfVoice(client, {
      marketplace: 'us',
      keyword: 'faucet mat'
    });
    expect(result.data.rows).toEqual([{ asin: 'B0ASINTEST', share: 0.12 }]);
  });
});
