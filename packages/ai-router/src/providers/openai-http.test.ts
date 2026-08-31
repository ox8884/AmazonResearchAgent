import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAiHttpProvider, MODEL_LIST_MAX_BYTES, type OpenAiHttpProviderConfig } from './openai-http';
import { listenOnFetchSafeLoopback } from '../../../../test-harness/safe-loopback-server.mjs';

const ClassificationSchema = z.object({
  classification: z.enum(['product_niche', 'brand_ip'])
});

const request = {
  role: 'niche_normalization' as const,
  modelId: 'cheap-model',
  locale: 'ko' as const,
  prompt: 'Classify batter squeeze bottle.',
  inputHash: 'b'.repeat(64),
  schema: ClassificationSchema
};

async function startMockServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{ server: Server; baseUrl: string; authorization: string | undefined }> {
  let authorization: string | undefined;
  const server = createServer((incoming, response) => {
    authorization = incoming.headers.authorization;
    handler(incoming, response);
  });
  const address = await listenOnFetchSafeLoopback(server);
  return {
    server,
    baseUrl: `${address.url}/v1`,
    get authorization() {
      return authorization;
    }
  };
}

describe('OpenAI-compatible HTTP provider', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('discovers models and performs a structured request', async () => {
    const mock = await startMockServer((incoming, response) => {
      if (incoming.url === '/v1/models') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: 'cheap-model' }] }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        choices: [{ message: { content: '{"classification":"product_niche"}' } }],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 }
      }));
    });
    server = mock.server;
    const provider = new OpenAiHttpProvider({
      id: 'mock-http',
      baseUrl: mock.baseUrl,
      apiKey: 'secret-key',
      billingType: 'free'
    });

    const models = await provider.listModels();
    const result = await provider.runStructured(request);

    expect(models.map((model) => model.id)).toContain('cheap-model');
    expect(result.output.classification).toBe('product_niche');
    expect(result.usage.totalTokens).toBe(13);
    expect(mock.authorization).toBe('Bearer secret-key');
    expect(JSON.stringify(provider)).not.toContain('secret-key');
  });

  it('uses a manual model without network discovery when discovery is disabled', async () => {
    let requestCount = 0;
    const mock = await startMockServer((_incoming, response) => {
      requestCount += 1;
      response.statusCode = 503;
      response.end('unavailable');
    });
    server = mock.server;
    const config: OpenAiHttpProviderConfig = {
      id: 'manual-http',
      baseUrl: mock.baseUrl,
      billingType: 'subscription',
      manualModelId: 'manual-model',
      modelDiscovery: 'disabled'
    };
    const provider = new OpenAiHttpProvider(config);

    const models = await provider.listModels();

    expect(models.map((model) => model.id)).toEqual(['manual-model']);
    expect(requestCount).toBe(0);
  });

  it('does not hide a discovery outage behind a manual model', async () => {
    const mock = await startMockServer((_incoming, response) => {
      response.statusCode = 503;
      response.end('unavailable');
    });
    server = mock.server;
    const provider = new OpenAiHttpProvider({
      id: 'manual-http',
      baseUrl: mock.baseUrl,
      billingType: 'subscription',
      manualModelId: 'manual-model',
      timeoutMs: 1_000
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      status: 503,
      retryable: true
    });
  });

  it('does not follow provider redirects', async () => {
    let requestCount = 0;
    const mock = await startMockServer((_incoming, response) => {
      requestCount += 1;
      response.statusCode = 302;
      response.setHeader('location', 'http://169.254.169.254/latest/meta-data');
      response.end();
    });
    server = mock.server;
    const provider = new OpenAiHttpProvider({
      id: 'redirecting-http',
      baseUrl: mock.baseUrl,
      billingType: 'free'
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      status: 302,
      retryable: false
    });
    expect(requestCount).toBe(1);
  });

  it('does not treat a manual model as healthy without a real provider probe', async () => {
    const health = await new OpenAiHttpProvider({
      id: 'manual-http',
      baseUrl: 'http://127.0.0.1:1',
      billingType: 'subscription',
      manualModelId: 'manual-model',
      modelDiscovery: 'disabled'
    }).health();
    expect(health.available).toBe(false);
    expect(health.reason).toMatch(/secret/i);
  });

  it('rejects an oversized model list even when Content-Length is missing', async () => {
    const mock = await startMockServer((_incoming, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(`{"data":[{"id":"${'m'.repeat(MODEL_LIST_MAX_BYTES)}"}]}`);
    });
    server = mock.server;
    const provider = new OpenAiHttpProvider({
      id: 'huge-http',
      baseUrl: mock.baseUrl,
      billingType: 'free',
      requiresSecret: false
    });
    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      message: 'Provider response exceeded the size limit.'
    });
  });

  it('does not probe /models for health when discovery is disabled', async () => {
    const paths: string[] = [];
    const mock = await startMockServer((incoming, response) => {
      paths.push(incoming.url ?? '');
      response.statusCode = 200;
      response.end('{"data":[{"id":"x"}]}');
    });
    server = mock.server;
    const health = await new OpenAiHttpProvider({
      id: 'secret-http',
      baseUrl: mock.baseUrl,
      billingType: 'subscription',
      apiKey: 'test-key',
      manualModelId: 'manual-model',
      modelDiscovery: 'disabled'
    }).health();
    expect(health.available).toBe(false);
    expect(health.reason).toBe('Explicit Test Connection is required.');
    expect(paths).toEqual([]);
  });

  it('does not treat unsupported /models as healthy when a manual model exists', async () => {
    const mock = await startMockServer((_incoming, response) => {
      response.statusCode = 404;
      response.end('missing');
    });
    server = mock.server;
    const health = await new OpenAiHttpProvider({
      id: 'manual-http',
      baseUrl: mock.baseUrl,
      billingType: 'subscription',
      apiKey: 'test-key',
      manualModelId: 'manual-model'
    }).health();
    expect(health.available).toBe(false);
    expect(health.reason).toBe('Explicit Test Connection is required.');
  });

  it('rejects an oversized body when Content-Length exceeds the cap', async () => {
    const mock = await startMockServer((_incoming, response) => {
      response.statusCode = 200;
      response.setHeader('content-length', String(MODEL_LIST_MAX_BYTES + 1));
      response.end('{"data":[]}');
    });
    server = mock.server;
    const provider = new OpenAiHttpProvider({
      id: 'huge-http',
      baseUrl: mock.baseUrl,
      billingType: 'free',
      requiresSecret: false
    });
    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      message: 'Provider response exceeded the size limit.'
    });
  });

  // Break: a provider that never responds can hold a worker indefinitely.
  it('bounds provider request timeouts', async () => {
    let requestCount = 0;
    const hangingFetch: typeof fetch = async (input, init) => {
      requestCount += 1;
      const signal = input instanceof Request ? input.signal : init?.signal;
      if (!signal) {
        throw new Error('Expected ky to attach a timeout signal.');
      }
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    const provider = new OpenAiHttpProvider({
      id: 'timeout-http',
      baseUrl: 'https://provider.example/v1',
      billingType: 'free',
      requiresSecret: false,
      timeoutMs: 10,
      fetch: hangingFetch
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      retryable: true
    });
    expect(requestCount).toBeGreaterThan(0);
    expect(requestCount).toBeLessThanOrEqual(3);
  });
});
