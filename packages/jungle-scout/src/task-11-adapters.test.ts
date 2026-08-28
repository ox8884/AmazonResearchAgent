import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import {
  buildHistoricalSearchVolumeRequest,
  queryHistoricalSearchVolume
} from './historical-search-volume';
import { buildSalesEstimatesRequest, querySalesEstimates } from './sales-estimates';
import { buildShareOfVoiceRequest, queryShareOfVoice } from './share-of-voice';


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

  it('parses Sales Estimates daily sales and price series', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [
            {
              id: 'B0ASINTEST',
              attributes: {
                estimated_monthly_sales: 400,
                daily_sales: [10, 12, 9, 11],
                prices: [19.99, 19.5, 20]
              }
            }
          ]
        })
      );
    });
    const result = await querySalesEstimates(client, {
      marketplace: 'us',
      asins: ['B0ASINTEST']
    });
    expect(result.data.estimates[0]?.dailySales).toEqual([10, 12, 9, 11]);
    expect(result.data.estimates[0]?.prices).toEqual([19.99, 19.5, 20]);
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

  it('builds approved Task 11 request shapes', () => {
    expect(buildHistoricalSearchVolumeRequest({ marketplace: 'us', keyword: 'faucet mat' })).toEqual({
      path: '/api/keywords/historical_search_volume?marketplace=us&keyword=faucet+mat',
      method: 'GET'
    });
    expect(buildSalesEstimatesRequest({ marketplace: 'us', asins: ['B0ASINTEST'] })).toMatchObject({
      path: '/api/sales_estimates_query',
      method: 'POST'
    });
    expect(buildShareOfVoiceRequest({ marketplace: 'us', keyword: 'faucet mat' })).toEqual({
      path: '/api/share_of_voice?marketplace=us&keyword=faucet+mat',
      method: 'GET'
    });
  });

  it('returns empty parsed data for malformed Task 11 bodies', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ not: 'jsonapi' }));
    });
    const historical = await queryHistoricalSearchVolume(client, {
      marketplace: 'us',
      keyword: 'faucet mat'
    });
    expect(historical.data.points).toEqual([]);
    expect(historical.status).toBe(200);
  });
});
