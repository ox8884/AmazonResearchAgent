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
    const upstream = (options.request ?? httpRequest)(
      targetOptions(
        targetPort,
        `${path}${sourceUrl.search}`,
        request.method,
        headers,
      ),
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.once('error', fail);
        upstreamResponse.pipe(response);
      },
    );
    const fail = (error) => {
      if (response.headersSent || response.destroyed) {
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
    upstream.once('error', fail);
    request.once('aborted', () => upstream.destroy());
    response.once('close', () => {
      if (!response.writableEnded) upstream.destroy();
    });
    if (request.method === 'GET' || request.method === 'HEAD') upstream.end();
    else request.pipe(upstream);
  });
  const address = await listenOnFetchSafeLoopback(server);
  return { server, url: address.url };
}

function readinessRequest(targetPort, key, request = httpRequest) {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      targetOptions(
        targetPort,
        '/jobs?select=id&limit=1',
        'GET',
        { apikey: key, authorization: `Bearer ${key}` },
      ),
      (response) => {
        response.once('error', reject);
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          ok: response.statusCode !== undefined
            && response.statusCode >= 200
            && response.statusCode < 300,
          status: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

export async function waitForPostgrest(targetPort, key, containerName, options = {}) {
  const deadline = Date.now() + 15_000;
  let lastObservation = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await readinessRequest(targetPort, key, options.request);
      if (response.ok) return;
      lastObservation = `${response.status} ${response.body}`;
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  const logs = spawnSync('docker', ['logs', containerName], { encoding: 'utf8' });
  throw new Error(
    `Ephemeral PostgREST did not become ready: ${lastObservation}\n${logs.stderr || logs.stdout}`,
  );
}
