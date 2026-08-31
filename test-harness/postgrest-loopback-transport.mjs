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

const helperCompositions = new WeakSet();
const terminalSetupFailures = new WeakSet();

function withSecondaryErrors(primaryValue, secondaryValues) {
  const primary = asError(primaryValue);
  const secondary = secondaryValues.map(asError);
  if (secondary.length === 0) return primary;
  const composition = new AggregateError(
    [primary, ...secondary],
    `${primary.message} Additional cleanup or diagnostic failures occurred.`,
    { cause: primary },
  );
  helperCompositions.add(composition);
  return composition;
}

function causalErrors(error) {
  return error instanceof AggregateError && helperCompositions.has(error)
    ? error.errors
    : [error];
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
    let scheduling = false;
    let timerFiredSynchronously = false;
    let settled = false;
    let outgoingDestroyed = false;
    let responseDestroyed = false;

    const timeoutFailure = () => {
      const error = new Error(`PostgREST readiness request timed out after ${timeoutMs} ms.`);
      terminalSetupFailures.add(error);
      return error;
    };
    const destroyOutgoing = () => {
      if (outgoingDestroyed || outgoing === undefined) return;
      outgoingDestroyed = true;
      outgoing.destroy();
    };
    const destroyResponse = () => {
      if (responseDestroyed || upstreamResponse === undefined) return;
      responseDestroyed = true;
      upstreamResponse.destroy?.();
    };
    const cancelTimer = () => {
      if (timer === undefined) return;
      const assignedTimer = timer;
      timer = undefined;
      cancel(assignedTimer);
    };
    const rejectWithCleanup = (primaryValue, cleanupTimer = true) => {
      if (settled) return;
      settled = true;
      const cleanupErrors = [];
      const cleanups = cleanupTimer
        ? [cancelTimer, destroyOutgoing, destroyResponse]
        : [destroyOutgoing, destroyResponse];
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      reject(withSecondaryErrors(primaryValue, cleanupErrors));
    };
    const resolveResponse = (value) => {
      if (settled) return;
      settled = true;
      try {
        cancelTimer();
      } catch (error) {
        reject(asError(error));
        return;
      }
      resolve(value);
    };
    const onResponse = (response) => {
      upstreamResponse = response;
      const chunks = [];
      response.on('error', (error) => rejectWithCleanup(error));
      response.once('aborted', () => rejectWithCleanup(
        new Error('PostgREST readiness response aborted.'),
      ));
      response.once('close', () => {
        if (!response.complete && !response.readableEnded) {
          rejectWithCleanup(new Error('PostgREST readiness response closed prematurely.'));
        }
      });
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveResponse({
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
          // The settled request remains authoritative; listeners absorb late errors.
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
      const primary = asError(error);
      terminalSetupFailures.add(primary);
      rejectWithCleanup(primary, false);
      return;
    }
    outgoing.on('error', (error) => rejectWithCleanup(error));
    if (settled) {
      try {
        destroyOutgoing();
      } catch {
        // A synchronous response already established the authoritative outcome.
      }
      return;
    }

    scheduling = true;
    try {
      timer = schedule(() => {
        if (settled) return;
        if (scheduling) {
          timerFiredSynchronously = true;
          return;
        }
        rejectWithCleanup(timeoutFailure());
      }, timeoutMs);
    } catch (error) {
      scheduling = false;
      const primary = asError(error);
      terminalSetupFailures.add(primary);
      rejectWithCleanup(primary, false);
      return;
    }
    scheduling = false;
    if (timerFiredSynchronously) {
      rejectWithCleanup(timeoutFailure());
      return;
    }
    if (settled) {
      try {
        cancelTimer();
      } catch {
        // Synchronous settlement is already authoritative.
      }
      return;
    }
    try {
      outgoing.end();
    } catch (error) {
      const primary = asError(error);
      terminalSetupFailures.add(primary);
      rejectWithCleanup(primary);
    }
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
      if (terminalSetupFailures.has(lastObservation)
        || causalErrors(lastObservation).some((entry) => terminalSetupFailures.has(entry))) break;
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

  const observation = lastObservation instanceof Error
    ? lastObservation
    : new Error(String(lastObservation));
  const diagnostics = causalErrors(observation).slice();
  const primary = diagnostics[0];
  if (clockFailure !== undefined) diagnostics.push(clockFailure);
  let dockerLogs = '';
  try {
    const diagnostic = retrieveDockerLogs(containerName, options);
    dockerLogs = diagnostic.logs;
    if (diagnostic.error !== undefined) diagnostics.push(diagnostic.error);
  } catch (error) {
    diagnostics.push(asError(error));
  }
  const message = `Ephemeral PostgREST did not become ready: ${primary.message}`
    + (dockerLogs.length > 0 ? `\n${dockerLogs}` : '');
  const failure = new AggregateError(diagnostics, message, { cause: primary });
  helperCompositions.add(failure);
  throw failure;
}
