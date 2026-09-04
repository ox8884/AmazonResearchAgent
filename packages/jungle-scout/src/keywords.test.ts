import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient } from './client';
import { buildKeywordRequest, queryKeywordMetrics } from './keywords';
import { listenOnFetchSafeLoopback } from '../../../test-harness/safe-loopback-server.mjs';

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
    expect(request).toEqual({
      path: '/api/keywords/keywords_by_keyword_query?marketplace=us',
      method: 'POST',
      json: {
        data: {
          type: 'keywords_by_keyword_query',
          attributes: {
            search_terms: 'sink splash guard'
          }
        }
      }
    });
  });

  it('parses monthly search volume and upper-bound flag from the provider body', async () => {
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(
        JSON.stringify({
          data: [
            {
              attributes: {
                monthly_search_volume_exact: 1800,
                is_upper_bound: true
              }
            }
          ]
        })
      );
    });
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url
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
    const address = await listenOnFetchSafeLoopback(http);
    server = http;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: address.url
    });
    await expect(
      queryKeywordMetrics(client, { marketplace: 'us', keyword: 'sink splash guard' })
    ).rejects.toThrow(/malformed/u);
  });
});
