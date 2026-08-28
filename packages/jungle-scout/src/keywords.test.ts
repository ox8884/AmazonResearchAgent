import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import { buildKeywordRequest, queryKeywordMetrics } from './keywords';

describe('Jungle Scout keyword adapter', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('builds a keyword-by-keyword request', () => {
    const request = buildKeywordRequest({
      marketplace: 'us',
      keyword: 'sink splash guard'
    });
    expect(request.method).toBe('GET');
    expect(request.path).toContain('/api/keywords/by_keyword');
    expect(request.path).toContain('marketplace=us');
    expect(request.path).toContain('sink+splash+guard');
  });

  it('parses monthly search volume and upper-bound flag from the provider body', async () => {
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [
            {
              attributes: {
                monthly_search_volume: 1800,
                is_upper_bound: true
              }
            }
          ]
        })
      );
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
    const result = await queryKeywordMetrics(client, {
      marketplace: 'us',
      keyword: 'sink splash guard'
    });
    expect(result.metrics.monthlySearchVolume).toBe(1800);
    expect(result.metrics.isUpperBound).toBe(true);
    expect(result.httpAttempts).toBe(1);
    expect(result.status).toBe(200);
  });

  it('fails safely on a malformed Keyword API body', async () => {
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ not: 'jsonapi' }));
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
      queryKeywordMetrics(client, { marketplace: 'us', keyword: 'sink splash guard' })
    ).rejects.toThrow(/malformed/u);
  });
});
