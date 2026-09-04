import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import {
  buildHistoricalSearchVolumeRequest,
  queryHistoricalSearchVolume
} from './historical-search-volume';
import { buildSalesEstimatesRequest, querySalesEstimates } from './sales-estimates';
import { buildShareOfVoiceRequest, queryShareOfVoice } from './share-of-voice';
import { listenOnFetchSafeLoopback } from '../../../test-harness/safe-loopback-server.mjs';


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
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    return new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url
    });
  }

  it('parses official weekly Historical Search Volume fields', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [
            {
              attributes: {
                estimate_start_date: '2026-01-04',
                estimate_end_date: '2026-01-10',
                estimated_exact_search_volume: 123
              }
            }
          ]
        })
      );
    });
    const result = await queryHistoricalSearchVolume(client, {
      marketplace: 'us',
      keyword: 'faucet mat',
      startDate: '2025-09-02',
      endDate: '2026-09-01'
    });
    expect(result.status).toBe(200);
    expect(result.httpAttempts).toBe(1);
    expect(result.data.points).toEqual([
      { periodStart: '2026-01-04', periodEnd: '2026-01-10', searchVolume: 123 }
    ]);
  });

  // Break: Sales Estimates invent 29.99 economics.
  it('parses Sales Estimates without substituting a fabricated number', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [
            {
              id: 'us/B0ASINTEST',
              attributes: { asin: 'B0ASINTEST', data: [] }
            }
          ]
        })
      );
    });
    const result = await querySalesEstimates(client, {
      marketplace: 'us',
      asin: 'B0ASINTEST',
      startDate: '2026-08-03',
      endDate: '2026-09-01'
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
                asin: 'B0ASINTEST',
                data: [
                  { date: '2026-08-30', estimated_units_sold: 10, last_known_price: 19.99 },
                  { date: '2026-08-31', estimated_units_sold: 12, last_known_price: 19.5 },
                  { date: '2026-09-01', estimated_units_sold: 9, last_known_price: 20 }
                ]
              }
            }
          ]
        })
      );
    });
    const result = await querySalesEstimates(client, {
      marketplace: 'us',
      asin: 'B0ASINTEST',
      startDate: '2026-08-03',
      endDate: '2026-09-01'
    });
    expect(result.data.estimates[0]?.estimatedMonthlySales).toBe(31);
    expect(result.data.estimates[0]?.dailySales).toEqual([10, 12, 9]);
    expect(result.data.estimates[0]?.prices).toEqual([19.99, 19.5, 20]);
  });


  // Break: Share of Voice invents listing_proxy share.
  it('parses Share of Voice rows from the provider body', async () => {
    const client = await listen((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: {
            id: 'us/faucet mat',
            attributes: {
              brands: [
                { brand: 'Zulay', combined_weighted_sov: 0.7 },
                { brand: 'Other', combined_weighted_sov: 0.3 }
              ]
            }
          }
        })
      );
    });
    const result = await queryShareOfVoice(client, {
      marketplace: 'us',
      keyword: 'faucet mat'
    });
    expect(result.data.brands).toEqual([
      { brand: 'Zulay', share: 0.7 },
      { brand: 'Other', share: 0.3 }
    ]);
  });

  it('builds approved Task 11 request shapes', () => {
    expect(buildHistoricalSearchVolumeRequest({
      marketplace: 'us',
      keyword: 'faucet mat',
      startDate: '2025-09-02',
      endDate: '2026-09-01'
    })).toEqual({
      path: '/api/keywords/historical_search_volume?marketplace=us&keyword=faucet+mat&start_date=2025-09-02&end_date=2026-09-01',
      method: 'GET'
    });
    expect(buildSalesEstimatesRequest({
      marketplace: 'us',
      asin: 'B0ASINTEST',
      startDate: '2026-08-03',
      endDate: '2026-09-01'
    })).toEqual({
      path: '/api/sales_estimates_query?marketplace=us&asin=B0ASINTEST&start_date=2026-08-03&end_date=2026-09-01',
      method: 'GET'
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
      keyword: 'faucet mat',
      startDate: '2025-09-02',
      endDate: '2026-09-01'
    });
    expect(historical.data.points).toEqual([]);
    expect(historical.status).toBe(200);
  });
});
