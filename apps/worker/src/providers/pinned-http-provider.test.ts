import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COMPLETION_MAX_BYTES,
  MODEL_LIST_MAX_BYTES,
  OpenAiHttpProvider
} from '@ara/ai-router';
import { createPinnedProviderFetch } from './provider-url-policy';
import { listenOnFetchSafeLoopback } from '../../../../test-harness/safe-loopback-server.mjs';

describe('pinned OpenAI HTTP provider byte cap', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('rejects an oversized streamed body without pre-buffering the pinned adapter', async () => {
    const chunk = Buffer.alloc(16 * 1024, 0x61);
    const intendedBytes = MODEL_LIST_MAX_BYTES * 40;
    let bytesWritten = 0;
    let aborted = false;
    server = createServer((request, response) => {
      request.on('aborted', () => {
        aborted = true;
      });
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      const write = (): void => {
        while (!aborted && bytesWritten < intendedBytes) {
          const ok = response.write(chunk);
          bytesWritten += chunk.byteLength;
          if (!ok) {
            response.once('drain', write);
            return;
          }
        }
        if (!aborted) {
          response.end();
        }
      };
      write();
    });
    const address = await listenOnFetchSafeLoopback(server);
    const provider = new OpenAiHttpProvider({
      id: 'pinned-http',
      baseUrl: address.url,
      billingType: 'free',
      requiresSecret: false,
      fetch: createPinnedProviderFetch('loopback')
    });

    await expect(provider.listModels()).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      message: 'Provider response exceeded the size limit.'
    });
    expect(bytesWritten).toBeGreaterThan(MODEL_LIST_MAX_BYTES);
    expect(bytesWritten).toBeLessThan(intendedBytes);
  });

  it('parses a normal bounded model list through the pinned path', async () => {
    server = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'cheap-model' }] }));
    });
    const address = await listenOnFetchSafeLoopback(server);
    const provider = new OpenAiHttpProvider({
      id: 'pinned-http',
      baseUrl: address.url,
      billingType: 'free',
      requiresSecret: false,
      fetch: createPinnedProviderFetch('loopback')
    });
    const models = await provider.listModels();
    expect(models.map((model) => model.id)).toEqual(['cheap-model']);
  });

  // Break: structured completions bypass the byte cap enforced for model discovery.
  it('rejects an oversized structured completion through the pinned path', async () => {
    server = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        padding: 'x'.repeat(COMPLETION_MAX_BYTES)
      }));
    });
    const address = await listenOnFetchSafeLoopback(server);
    const provider = new OpenAiHttpProvider({
      id: 'pinned-http',
      baseUrl: address.url,
      billingType: 'free',
      requiresSecret: false,
      fetch: createPinnedProviderFetch('loopback')
    });

    await expect(provider.runStructured({
      role: 'niche_normalization',
      modelId: 'bounded-model',
      locale: 'ko',
      prompt: 'Return bounded JSON.',
      inputHash: 'bounded-input',
      schema: z.object({ ok: z.boolean() })
    })).rejects.toMatchObject({
      name: 'OpenAiHttpError',
      message: 'Provider response exceeded the size limit.'
    });
  });
});
