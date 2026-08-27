import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it, afterEach } from 'vitest';
import { z } from 'zod';
import { OpenAiHttpProvider, type OpenAiHttpProviderConfig } from './openai-http';

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
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
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

  it('uses a manual model descriptor when discovery is unavailable', async () => {
    const mock = await startMockServer((_incoming, response) => {
      response.statusCode = 503;
      response.end('unavailable');
    });
    server = mock.server;
    const config: OpenAiHttpProviderConfig = {
      id: 'manual-http',
      baseUrl: mock.baseUrl,
      billingType: 'subscription',
      manualModelId: 'manual-model'
    };
    const provider = new OpenAiHttpProvider(config);

    const models = await provider.listModels();

    expect(models.map((model) => model.id)).toEqual(['manual-model']);
  });
});
