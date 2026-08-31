import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { JungleScoutClient, JungleScoutClientError } from './client';
import { listenOnFetchSafeLoopback } from '../../../test-harness/safe-loopback-server.mjs';

async function startMockServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{
  server: Server;
  baseUrl: string;
  headers: () => IncomingMessage['headers'];
}> {
  let headers: IncomingMessage['headers'] = {};
  const server = createServer((incoming, response) => {
    headers = incoming.headers;
    handler(incoming, response);
  });
  const address = await listenOnFetchSafeLoopback(server);
  return {
    server,
    baseUrl: address.url,
    headers: () => headers
  };
}

describe('Jungle Scout authenticated client', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  // Break: the API key is logged or sent with the wrong header shape.
  it('sends Jungle Scout auth without logging the api key', async () => {
    const mock = await startMockServer((_request, response) => {
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ data: [] }));
    });
    server = mock.server;
    const logs: string[] = [];
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: mock.baseUrl,
      log: (message) => logs.push(message)
    });

    await client.request('/api/test?marketplace=us', { method: 'GET' });

    expect(mock.headers().authorization).toBe('AI:secret-key');
    expect(mock.headers()['x-api-type']).toBe('junglescout');
    expect(logs.join('\n')).not.toContain('secret-key');
  });

  // Break: auth/config 4xx responses are retried or include the secret.
  it('does not retry auth failures and redacts secrets from errors', async () => {
    let hits = 0;
    const mock = await startMockServer((_request, response) => {
      hits += 1;
      response.statusCode = 401;
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({
        errors: [{ status: '401', title: 'Unauthorized', detail: 'bad secret-key' }]
      }));
    });
    server = mock.server;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: mock.baseUrl
    });

    await expect(client.request('/api/test', { method: 'GET' })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof JungleScoutClientError &&
        error.status === 401 &&
        error.retryable === false &&
        !error.message.includes('secret-key')
    );
    expect(hits).toBe(1);
  });

  // Break: 500s are not retried or each attempt is invisible.
  it('retries retryable server failures a bounded number of times', async () => {
    let hits = 0;
    const mock = await startMockServer((_request, response) => {
      hits += 1;
      if (hits < 3) {
        response.statusCode = 500;
        response.end(JSON.stringify({ errors: [{ status: '500', title: 'Server Error' }] }));
        return;
      }
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify({ data: [{ id: 'ok' }] }));
    });
    server = mock.server;
    const client = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: mock.baseUrl
    });

    const result = await client.request('/api/test', { method: 'GET' });
    expect(result.httpAttempts).toBe(3);
    expect(result.body).toEqual({ data: [{ id: 'ok' }] });
    expect(hits).toBe(3);
  });
});
