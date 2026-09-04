import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { listenOnFetchSafeLoopback } from '../../../test-harness/safe-loopback-server.mjs';
import {
  buildCompleteDateRange,
  createJungleScoutSalesEstimatesQuery
} from './jungle-scout-runtime';

describe('Jungle Scout runtime queries', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('builds a complete UTC date range ending yesterday', () => {
    const range = buildCompleteDateRange(30, new Date('2026-09-03T12:00:00Z'));

    expect(range).toEqual({ startDate: '2026-08-04', endDate: '2026-09-02' });
  });

  it('queries exactly one selected ASIN with a complete date range', async () => {
    let requestedUrl = '';
    const http = createServer((request, response) => {
      requestedUrl = request.url ?? '';
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ data: [] }));
    });
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const query = createJungleScoutSalesEstimatesQuery(
      {
        JUNGLE_SCOUT_KEY_NAME: 'AI',
        JUNGLE_SCOUT_API_KEY: 'secret-key',
        JUNGLE_SCOUT_BASE_URL: address.url
      },
      new Date('2026-09-03T12:00:00Z')
    );

    await query('B0FIRST');

    expect(requestedUrl).toBe(
      '/api/sales_estimates_query?marketplace=us&asin=B0FIRST&start_date=2026-08-04&end_date=2026-09-02'
    );
  });
});
