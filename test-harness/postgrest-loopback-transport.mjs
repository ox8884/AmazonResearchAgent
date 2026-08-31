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

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function withSecondaryErrors(primary, secondaryErrors) {
  if (secondaryErrors.length === 0) return primary;
  return new AggregateError(
    [primary, ...secondaryErrors.map(asError)],
    `${primary.message} Additional cleanup or diagnostic failures occurred.`,
  );
}

function secondaryErrors(error) {
  return error instanceof AggregateError ? error.errors.slice(1).map(asError) : [];
}

function readClock(now) {
  const value = now();
  if (typeof value !== 'number') {
    throw new TypeError('PostgREST readiness clock returned a non-number value.');
  }
  if (!Number.isFinite(value)) {
    throw new RangeError('PostgREST readiness clock returned a non-finite number.');
  }
  return value;
}

function retrieveDockerLogs(containerName, options) {
  if (options.dockerLogs !== undefined) {
    const logs = options.dockerLogs();
    if (typeof logs !== 'string') {
      throw new TypeError('Docker log retrieval returned invalid output.');
    }
    return { logs, error: undefined };
  }
  const run = options.spawnSync ?? spawnSync;
  const result = run('docker', ['logs', containerName], { encoding: 'utf8' });
  if (result === null || typeof result !== 'object') {
    throw new TypeError('Docker log retrieval returned an invalid result.');
  }
  if (result.stderr !== undefined && result.stderr !== null && typeof result.stderr !== 'string') {
    throw new TypeError('Docker log retrieval returned invalid output.');
  }
  if (result.stdout !== undefined && result.stdout !== null && typeof result.stdout !== 'string') {
    throw new TypeError('Docker log retrieval returned invalid output.');
  }
  const logs = result.stderr || result.stdout || '';
  return {
    logs,
    error: result.error === undefined ? undefined : asError(result.error),
  };
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
    let responseDestroyed = false;
    const destroyOutgoing = () => {
      if (outgoingDestroyed) return;
      outgoingDestroyed = true;
      outgoing?.destroy();
    };
    const destroyResponse = () => {
      if (responseDestroyed || upstreamResponse === undefined) return;
      responseDestroyed = true;
      upstreamResponse.destroy?.();
    };
    const cancelTimer = () => {
      if (timer !== undefined) cancel(timer);
    };
    const settle = (complete, value) => {
      if (settled) return;
      settled = true;
      try {
        cancelTimer();
      } catch (error) {
        if (complete === reject) {
          reject(withSecondaryErrors(asError(value), [error]));
        } else {
          reject(asError(error));
        }
        return;
      }
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
      if (settled) {
        try {
          destroyResponse();
        } catch {
          // The request outcome is already authoritative; late cleanup cannot replace it.
        }
      }
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
      const timeoutError = new Error(`PostgREST readiness request timed out after ${timeoutMs} ms.`);
      settled = true;
      const cleanupErrors = [];
      for (const cleanup of [cancelTimer, destroyOutgoing, destroyResponse]) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      reject(withSecondaryErrors(timeoutError, cleanupErrors));
    }, timeoutMs);
    if (settled) {
      try {
        cancelTimer();
      } catch {
        // Synchronous settlement is already authoritative.
      }
      return;
    }
    outgoing.end();
  });
}

export async function waitForPostgrest(targetPort, key, containerName, options = {}) {
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? setTimeout;
  let lastObservation = 'no response';
  let clockFailure;
  let current;
  let deadline;
  try {
    current = readClock(now);
    deadline = current + 15_000;
    if (!Number.isFinite(deadline)) {
      throw new RangeError('PostgREST readiness clock cannot represent the fixed deadline.');
    }
  } catch (error) {
    clockFailure = asError(error);
  }

  while (clockFailure === undefined && current < deadline) {
    const remaining = deadline - current;
    try {
      const response = await readinessRequest(targetPort, key, remaining, options);
      if (response.ok) return;
      lastObservation = `${response.status} ${response.body}`;
    } catch (error) {
      lastObservation = asError(error);
    }

    let beforeDelay;
    try {
      beforeDelay = readClock(now);
      if (beforeDelay < current) {
        throw new Error('PostgREST readiness clock moved backward.');
      }
    } catch (error) {
      clockFailure = asError(error);
      break;
    }
    const positiveRemaining = deadline - beforeDelay;
    if (positiveRemaining <= 0) {
      current = beforeDelay;
      continue;
    }
    const delay = Math.min(50, positiveRemaining);
    try {
      await new Promise((resolveDelay) => schedule(resolveDelay, delay));
      const afterDelay = readClock(now);
      if (afterDelay < beforeDelay) {
        throw new Error('PostgREST readiness clock moved backward.');
      }
      if (afterDelay === beforeDelay) {
        throw new Error('PostgREST readiness clock did not advance after a scheduled delay.');
      }
      current = afterDelay;
    } catch (error) {
      clockFailure = asError(error);
    }
  }

  const observationMessage = lastObservation instanceof Error
    ? lastObservation.message
    : lastObservation;
  const readinessFailure = new Error(
    `Ephemeral PostgREST did not become ready: ${observationMessage}`,
  );
  const diagnostics = lastObservation instanceof Error
    ? secondaryErrors(lastObservation)
    : [];
  if (clockFailure !== undefined) diagnostics.push(clockFailure);
  try {
    const diagnostic = retrieveDockerLogs(containerName, options);
    if (diagnostic.logs.length > 0) readinessFailure.message += `\n${diagnostic.logs}`;
    if (diagnostic.error !== undefined) diagnostics.push(diagnostic.error);
  } catch (error) {
    diagnostics.push(asError(error));
  }
  throw withSecondaryErrors(readinessFailure, diagnostics);
}
