import { createServer, request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';

import { listenOnFetchSafeLoopback } from './safe-loopback-server.mjs';

function targetOptions(targetPort, path, method, headers) {
  return {
    hostname: '127.0.0.1',
    port: targetPort,
    path,
    method,
    headers,
  };
}

export async function startPostgrestProxy(targetPort, options = {}) {
  const server = createServer((request, response) => {
    const sourceUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = sourceUrl.pathname.replace(/^\/rest\/v1(?=\/|$)/u, '') || '/';
    const headers = { ...request.headers };
    delete headers.host;
    let upstream;
    let upstreamDestroyed = false;
    let terminal = false;

    const destroyUpstream = () => {
      if (upstreamDestroyed || upstream === undefined) return;
      upstreamDestroyed = true;
      upstream.destroy();
    };
    const terminate = (error, sendFailure = true) => {
      if (terminal) return;
      terminal = true;
      destroyUpstream();
      if (!sendFailure || response.headersSent || response.destroyed) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(
        error instanceof Error
          ? `PostgREST proxy failure: ${error.message}`
          : 'PostgREST proxy failure',
      );
    };
    const onUpstreamResponse = (upstreamResponse) => {
      let upstreamEnded = false;
      const onResponseError = (error) => terminate(error);
      upstreamResponse.on('error', onResponseError);
      upstreamResponse.once('end', () => {
        upstreamEnded = true;
      });
      upstreamResponse.once('aborted', () => terminate(new Error('PostgREST upstream response aborted.')));
      upstreamResponse.once('close', () => {
        if (!upstreamEnded) terminate(new Error('PostgREST upstream response closed prematurely.'));
      });
      if (terminal) {
        upstreamResponse.destroy?.();
        return;
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    };

    try {
      upstream = (options.request ?? httpRequest)(
        targetOptions(
          targetPort,
          `${path}${sourceUrl.search}`,
          request.method,
          headers,
        ),
        onUpstreamResponse,
      );
    } catch (error) {
      terminate(error);
      return;
    }
    upstream.on('error', (error) => terminate(error));
    if (terminal) {
      destroyUpstream();
      return;
    }
    request.once('aborted', () => terminate(new Error('PostgREST proxy request aborted.'), false));
    response.once('close', () => {
      if (!response.writableEnded) {
        terminate(new Error('PostgREST proxy response closed prematurely.'), false);
      }
    });
    if (request.method === 'GET' || request.method === 'HEAD') upstream.end();
    else request.pipe(upstream);
  });
  const address = await listenOnFetchSafeLoopback(server);
  return { server, url: address.url };
}

function readinessRequest(targetPort, key, timeoutMs, options) {
  const request = options.request ?? httpRequest;
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  return new Promise((resolve, reject) => {
    let outgoing;
    let upstreamResponse;
    let timer;
    let settled = false;
    let outgoingDestroyed = false;
    const destroyOutgoing = () => {
      if (outgoingDestroyed) return;
      outgoingDestroyed = true;
      outgoing?.destroy();
    };
    const settle = (complete, value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) cancel(timer);
      complete(value);
    };
    const onResponse = (response) => {
      upstreamResponse = response;
      const chunks = [];
      response.on('error', (error) => settle(reject, error));
      response.once('aborted', () => settle(reject, new Error('PostgREST readiness response aborted.')));
      response.once('close', () => {
        if (!response.complete && !response.readableEnded) {
          settle(reject, new Error('PostgREST readiness response closed prematurely.'));
        }
      });
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => settle(resolve, {
        ok: response.statusCode !== undefined
          && response.statusCode >= 200
          && response.statusCode < 300,
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      if (settled) response.destroy?.();
    };
    try {
      outgoing = request(
        targetOptions(
          targetPort,
          '/jobs?select=id&limit=1',
          'GET',
          { apikey: key, authorization: `Bearer ${key}` },
        ),
        onResponse,
      );
    } catch (error) {
      settle(reject, error);
      return;
    }
    outgoing.on('error', (error) => settle(reject, error));
    timer = schedule(() => {
      if (settled) return;
      destroyOutgoing();
      upstreamResponse?.destroy?.();
      settle(reject, new Error(`PostgREST readiness request timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    if (settled) {
      cancel(timer);
      return;
    }
    outgoing.end();
  });
}

export async function waitForPostgrest(targetPort, key, containerName, options = {}) {
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? setTimeout;
  const deadline = now() + 15_000;
  let lastObservation = 'no response';
  while (now() < deadline) {
    const remaining = deadline - now();
    try {
      const response = await readinessRequest(targetPort, key, remaining, options);
      if (response.ok) return;
      lastObservation = `${response.status} ${response.body}`;
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    const delay = Math.min(50, deadline - now());
    if (delay > 0) {
      await new Promise((resolveDelay) => schedule(resolveDelay, delay));
    }
  }
  const logResult = options.dockerLogs === undefined
    ? spawnSync('docker', ['logs', containerName], { encoding: 'utf8' })
    : undefined;
  const logs = options.dockerLogs?.() ?? (logResult?.stderr || logResult?.stdout || '');
  throw new Error(
    `Ephemeral PostgREST did not become ready: ${lastObservation}\n${logs}`,
  );
}
