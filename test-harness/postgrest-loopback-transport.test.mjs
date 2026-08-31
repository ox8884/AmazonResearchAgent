import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  startPostgrestProxy,
  waitForPostgrest,
} from './postgrest-loopback-transport.mjs';
import { listenOnFetchSafeLoopback } from './safe-loopback-server.mjs';

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});
const redirectPort = (actualPort, observedPorts) => (options, callback) => {
  observedPorts.push(options.port);
  return request({ ...options, port: actualPort }, callback);
};

const send = ({ url, method = 'GET', headers, body }) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const outgoing = request({
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method,
    headers,
  }, (response) => {
    const chunks = [];
    response.on('error', reject);
    response.on('aborted', () => reject(new Error('response aborted')));
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  outgoing.on('error', reject);
  if (body !== undefined) outgoing.end(body);
  else outgoing.end();
});

class FakeOutgoingRequest extends EventEmitter {
  constructor(onEnd = () => undefined) {
    super();
    this.destroyCalls = 0;
    this.onEnd = onEnd;
  }

  end() {
    this.onEnd();
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

const fakeUpstreamResponse = ({ statusCode = 200, headers = {}, body } = {}) => {
  const response = new PassThrough();
  response.statusCode = statusCode;
  response.headers = headers;
  if (body !== undefined) queueMicrotask(() => response.end(body));
  return response;
};

const deterministicTiming = () => {
  let current = 0;
  const scheduled = [];
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds;
    },
    setTimeout(callback, milliseconds) {
      const handle = { active: true };
      scheduled.push(milliseconds);
      setImmediate(() => {
        if (!handle.active) return;
        current += milliseconds;
        callback();
      });
      return handle;
    },
    clearTimeout(handle) {
      handle.active = false;
    },
    scheduled,
  };
};

const readinessOptions = (timing, requestImpl) => ({
  request: requestImpl,
  now: timing.now,
  setTimeout: timing.setTimeout,
  clearTimeout: timing.clearTimeout,
  dockerLogs: () => 'deterministic docker log',
});

const errorMessages = (error) => error instanceof AggregateError
  ? error.errors.flatMap(errorMessages)
  : [error instanceof Error ? error.message : String(error)];

const assertPrimaryFailure = (error, primary, secondary) => {
  const messages = errorMessages(error);
  assert.match(messages[0], primary);
  if (secondary !== undefined) assert.match(messages.slice(1).join('\n'), secondary);
  return true;
};

const adversarialTiming = ({ advance = true } = {}) => {
  let current = 0;
  let rejectCallback;
  const callbackFailure = new Promise((_, reject) => {
    rejectCallback = reject;
  });
  return {
    now: () => current,
    setTimeout(callback, milliseconds) {
      const handle = { active: true };
      setImmediate(() => {
        if (!handle.active) return;
        if (advance) current += milliseconds;
        try {
          callback();
        } catch (error) {
          rejectCallback(error);
        }
      });
      return handle;
    },
    clearTimeout(handle) {
      handle.active = false;
    },
    callbackFailure,
  };
};

const immediateObservation = () => (_options, callback) => {
  const outgoing = new FakeOutgoingRequest(() => queueMicrotask(() => callback(
    fakeUpstreamResponse({ statusCode: 503, body: 'warming' }),
  )));
  return outgoing;
};

const requestWithResponse = (outgoing, response) => (_options, callback) => {
  outgoing.onEnd = () => queueMicrotask(() => callback(response));
  return outgoing;
};

const rejectWithCallbackGuard = (timing, operation, validator) => assert.rejects(
  Promise.race([operation, timing.callbackFailure]),
  validator,
);

test('uses Node HTTP for target port 10080 while preserving the PostgREST wire contract', async () => {
  const observed = [];
  const target = createServer((incoming, outgoing) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      observed.push({
        method: incoming.method,
        url: incoming.url,
        authorization: incoming.headers.authorization,
        apikey: incoming.headers.apikey,
        clientInfo: incoming.headers['x-client-info'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (incoming.method === 'GET') {
        outgoing.writeHead(200, { 'content-type': 'application/json' });
        outgoing.end('[]');
        return;
      }
      outgoing.writeHead(201, {
        'content-type': 'application/json',
        'x-upstream-proof': 'preserved',
        'set-cookie': ['first=one; Path=/', 'second=two; Path=/'],
      });
      outgoing.end('{"id":"job-1"}');
    });
  });
  const targetAddress = await listenOnFetchSafeLoopback(target);
  const requestedTargetPorts = [];
  const request10080 = redirectPort(targetAddress.port, requestedTargetPorts);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('global fetch must not receive the uncontrolled target port');
  };

  let proxy;
  try {
    await waitForPostgrest(10080, 'local-key', 'unused-container', {
      request: request10080,
    });
    proxy = await startPostgrestProxy(10080, { request: request10080 });
    const response = await send({
      url: `${proxy.url}/rest/v1/jobs?select=id%2Cstatus&limit=1`,
      method: 'POST',
      headers: {
        apikey: 'local-key',
        authorization: 'Bearer local-key',
        'content-type': 'application/json',
        'x-client-info': 'fixture-test',
      },
      body: '{"kind":"probe"}',
    });

    assert.equal(fetchCalls, 0);
    assert.deepEqual(requestedTargetPorts, [10080, 10080]);
    assert.equal(response.status, 201);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.equal(response.headers['x-upstream-proof'], 'preserved');
    assert.deepEqual(response.headers['set-cookie'], [
      'first=one; Path=/',
      'second=two; Path=/',
    ]);
    assert.equal(response.body, '{"id":"job-1"}');
    assert.deepEqual(observed, [
      {
        method: 'GET',
        url: '/jobs?select=id&limit=1',
        authorization: 'Bearer local-key',
        apikey: 'local-key',
        clientInfo: undefined,
        body: '',
      },
      {
        method: 'POST',
        url: '/jobs?select=id%2Cstatus&limit=1',
        authorization: 'Bearer local-key',
        apikey: 'local-key',
        clientInfo: 'fixture-test',
        body: '{"kind":"probe"}',
      },
    ]);

    target.closeAllConnections();
    await close(target);
    const failedUpstream = await send({
      url: `${proxy.url}/rest/v1/jobs`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(failedUpstream.status, 502);
    assert.match(failedUpstream.body, /PostgREST proxy failure/u);
  } finally {
    globalThis.fetch = originalFetch;
    if (target.listening) await close(target);
    if (proxy?.server.listening) await close(proxy.server);
  }
  assert.equal(target.listening, false);
  assert.equal(proxy?.server.listening, false);
});

test('supports a synchronous response callback before the request seam returns', async () => {
  let outgoing;
  const requestImpl = (_options, callback) => {
    callback(fakeUpstreamResponse({ body: 'synchronous' }));
    outgoing = new FakeOutgoingRequest();
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    const response = await send({ url: proxy.url });
    assert.equal(response.status, 200);
    assert.equal(response.body, 'synchronous');
    assert.equal(outgoing.destroyCalls, 0);
  } finally {
    await close(proxy.server);
  }
});

test('absorbs repeated upstream response failures and destroys upstream once', async () => {
  let outgoing;
  const requestImpl = (_options, callback) => {
    outgoing = new FakeOutgoingRequest(() => {
      const upstreamResponse = fakeUpstreamResponse();
      callback(upstreamResponse);
      queueMicrotask(() => {
        upstreamResponse.emit('error', new Error('first response failure'));
        upstreamResponse.emit('error', new Error('second response failure'));
      });
    });
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    await assert.rejects(send({ url: proxy.url }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outgoing.destroyCalls, 1);
  } finally {
    proxy.server.closeAllConnections();
    await close(proxy.server);
  }
});

test('handles request failure before callback and remains available afterward', async () => {
  let calls = 0;
  const requests = [];
  const requestImpl = (_options, callback) => {
    calls += 1;
    const outgoing = new FakeOutgoingRequest(() => {
      if (calls === 1) queueMicrotask(() => outgoing.emit('error', new Error('connect failed')));
      else queueMicrotask(() => callback(fakeUpstreamResponse({ body: 'recovered' })));
    });
    requests.push(outgoing);
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    const failed = await send({ url: proxy.url });
    assert.equal(failed.status, 502);
    assert.match(failed.body, /connect failed/u);
    const recovered = await send({ url: proxy.url });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body, 'recovered');
    assert.deepEqual(requests.map((outgoing) => outgoing.destroyCalls), [1, 0]);
  } finally {
    await close(proxy.server);
  }
});

test('ignores a callback that arrives after terminal request failure', async () => {
  let outgoing;
  const requestImpl = (_options, callback) => {
    outgoing = new FakeOutgoingRequest(() => {
      queueMicrotask(() => {
        outgoing.emit('error', new Error('failed before callback'));
        callback(fakeUpstreamResponse({ body: 'too late' }));
      });
    });
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    const response = await send({ url: proxy.url });
    assert.equal(response.status, 502);
    assert.match(response.body, /failed before callback/u);
    assert.equal(outgoing.destroyCalls, 1);
  } finally {
    await close(proxy.server);
  }
});

test('coalesces response abort, premature close, and downstream close', async () => {
  let outgoing;
  const requestImpl = (_options, callback) => {
    outgoing = new FakeOutgoingRequest(() => {
      const upstreamResponse = fakeUpstreamResponse();
      callback(upstreamResponse);
      queueMicrotask(() => {
        upstreamResponse.emit('aborted');
        upstreamResponse.emit('close');
        upstreamResponse.emit('error', new Error('late response error'));
      });
    });
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    await assert.rejects(send({ url: proxy.url }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outgoing.destroyCalls, 1);
  } finally {
    proxy.server.closeAllConnections();
    await close(proxy.server);
  }

});

test('treats premature upstream close as one terminal failure', async () => {
  let outgoing;
  const requestImpl = (_options, callback) => {
    outgoing = new FakeOutgoingRequest(() => {
      const upstreamResponse = fakeUpstreamResponse();
      callback(upstreamResponse);
      queueMicrotask(() => upstreamResponse.emit('close'));
    });
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    await assert.rejects(send({ url: proxy.url }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outgoing.destroyCalls, 1);
  } finally {
    proxy.server.closeAllConnections();
    await close(proxy.server);
  }
});

test('coalesces upstream failure with an overlapping client abort', async () => {
  let outgoing;
  let upstreamResponse;
  let releaseRequest;
  const requestStarted = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const requestImpl = (_options, callback) => {
    outgoing = new FakeOutgoingRequest(() => {
      upstreamResponse = fakeUpstreamResponse();
      callback(upstreamResponse);
      releaseRequest();
    });
    return outgoing;
  };
  const proxy = await startPostgrestProxy(10080, { request: requestImpl });
  try {
    const client = request(proxy.url);
    client.on('error', () => undefined);
    client.end();
    await requestStarted;
    upstreamResponse.emit('error', new Error('upstream failed'));
    client.destroy();
    upstreamResponse.emit('error', new Error('late upstream failure'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(outgoing.destroyCalls, 1);
  } finally {
    proxy.server.closeAllConnections();
    await close(proxy.server);
  }
});

test('bounds a never-settling readiness request to the fixed overall deadline', async () => {
  const timing = deterministicTiming();
  const outgoing = new FakeOutgoingRequest();
  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', readinessOptions(timing, () => outgoing)),
    /timed out after 15000 ms.*deterministic docker log/su,
  );
  assert.equal(outgoing.destroyCalls, 1);
  assert.deepEqual(timing.scheduled, [15_000]);
});

test('bounds response body collection and absorbs events after timeout', async () => {
  const timing = deterministicTiming();
  let upstreamResponse;
  const outgoing = new FakeOutgoingRequest(() => {
    queueMicrotask(() => {
      upstreamResponse = fakeUpstreamResponse();
      requestCallback(upstreamResponse);
    });
  });
  let requestCallback;
  const requestImpl = (_options, callback) => {
    requestCallback = callback;
    return outgoing;
  };
  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', readinessOptions(timing, requestImpl)),
    /timed out after 15000 ms/u,
  );
  upstreamResponse.emit('error', new Error('late error'));
  upstreamResponse.emit('end');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outgoing.destroyCalls, 1);
  assert.equal(upstreamResponse.destroyed, true);
});

test('never delays beyond the remaining readiness deadline', async () => {
  const timing = deterministicTiming();
  let calls = 0;
  const requestImpl = (_options, callback) => {
    calls += 1;
    const outgoing = new FakeOutgoingRequest(() => {
      if (calls === 1) timing.advance(14_980);
      queueMicrotask(() => callback(fakeUpstreamResponse({ statusCode: 503, body: 'warming' })));
    });
    return outgoing;
  };
  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', readinessOptions(timing, requestImpl)),
    /503 warming/u,
  );
  assert.deepEqual(timing.scheduled, [15_000, 20]);
});

test('still succeeds when readiness becomes healthy before the deadline', async () => {
  const timing = deterministicTiming();
  let calls = 0;
  const requestImpl = (_options, callback) => {
    calls += 1;
    const outgoing = new FakeOutgoingRequest(() => queueMicrotask(() => callback(
      fakeUpstreamResponse({ statusCode: calls === 1 ? 503 : 200, body: calls === 1 ? 'warming' : '[]' }),
    )));
    return outgoing;
  };
  await waitForPostgrest(10080, 'key', 'container', readinessOptions(timing, requestImpl));
  assert.equal(calls, 2);
  assert.deepEqual(timing.scheduled, [15_000, 50, 14_950]);
});

test('keeps timeout primary when request and response cleanup fail or re-enter', async () => {
  const cases = [
    { name: 'outgoing destroy throws', outgoingThrow: new Error('outgoing cleanup failed') },
    { name: 'outgoing destroy emits error', outgoingEmit: new Error('reentrant outgoing error') },
    { name: 'response destroy throws', responseThrow: new Error('response cleanup failed') },
    {
      name: 'both destroys fail and re-enter',
      outgoingThrow: new Error('outgoing cleanup failed'),
      outgoingEmit: new Error('reentrant outgoing error'),
      responseThrow: new Error('response cleanup failed'),
      responseEmit: new Error('reentrant response error'),
    },
  ];

  for (const scenario of cases) {
    const timing = adversarialTiming();
    const outgoing = new FakeOutgoingRequest();
    const response = fakeUpstreamResponse();
    let responseDestroyCalls = 0;
    outgoing.destroy = () => {
      outgoing.destroyCalls += 1;
      if (scenario.outgoingEmit) outgoing.emit('error', scenario.outgoingEmit);
      if (scenario.outgoingThrow) throw scenario.outgoingThrow;
    };
    response.destroy = () => {
      responseDestroyCalls += 1;
      if (scenario.responseEmit) response.emit('error', scenario.responseEmit);
      if (scenario.responseThrow) throw scenario.responseThrow;
      return response;
    };

    await rejectWithCallbackGuard(
      timing,
      waitForPostgrest(
        10080,
        'key',
        'container',
        readinessOptions(timing, requestWithResponse(outgoing, response)),
      ),
      (error) => assertPrimaryFailure(
        error,
        /PostgREST readiness request timed out after 15000 ms/u,
        scenario.outgoingThrow || scenario.responseThrow ? /cleanup failed/u : undefined,
      ),
    );
    assert.equal(outgoing.destroyCalls, 1, scenario.name);
    assert.equal(responseDestroyCalls, 1, scenario.name);
  }
});

test('attempts both destroys once when timer cancellation throws', async () => {
  const timing = adversarialTiming();
  const outgoing = new FakeOutgoingRequest();
  const response = fakeUpstreamResponse();
  let responseDestroyCalls = 0;
  response.destroy = () => {
    responseDestroyCalls += 1;
    return response;
  };
  const options = readinessOptions(timing, requestWithResponse(outgoing, response));
  options.clearTimeout = () => {
    throw new Error('timer cancellation failed');
  };

  await rejectWithCallbackGuard(
    timing,
    waitForPostgrest(10080, 'key', 'container', options),
    (error) => assertPrimaryFailure(
      error,
      /PostgREST readiness request timed out after 15000 ms/u,
      /timer cancellation failed/u,
    ),
  );
  assert.equal(outgoing.destroyCalls, 1);
  assert.equal(responseDestroyCalls, 1);
});

test('keeps readiness failure primary when injected Docker-log retrieval throws', async () => {
  const timing = deterministicTiming();
  const options = readinessOptions(timing, () => new FakeOutgoingRequest());
  options.dockerLogs = () => {
    throw new Error('docker log retrieval failed');
  };

  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', options),
    (error) => assertPrimaryFailure(
      error,
      /PostgREST readiness request timed out after 15000 ms/u,
      /docker log retrieval failed/u,
    ),
  );
});

test('keeps readiness failure primary for failed or malformed Docker command results', async () => {
  const cases = [
    { result: { error: new Error('spawn failed') }, secondary: /spawn failed/u },
    {
      result: { error: new Error('spawn failed'), stderr: 'useful docker stderr' },
      secondary: /spawn failed/u,
      log: /useful docker stderr/u,
    },
    { result: null, secondary: /invalid result/u },
    { result: { stderr: { secret: 'must not format' }, stdout: 42 }, secondary: /invalid output/u },
  ];
  for (const scenario of cases) {
    const timing = deterministicTiming();
    const options = readinessOptions(timing, () => new FakeOutgoingRequest());
    delete options.dockerLogs;
    options.spawnSync = () => scenario.result;
    await assert.rejects(
      waitForPostgrest(10080, 'key', 'container', options),
      (error) => {
        if (scenario.log) assert.match(error.message, scenario.log);
        return assertPrimaryFailure(
          error,
          /PostgREST readiness request timed out after 15000 ms/u,
          scenario.secondary,
        );
      },
    );
  }
});

test('stops after one observation when a scheduled delay makes no clock progress', async () => {
  let clockReads = 0;
  let requests = 0;
  const timing = adversarialTiming({ advance: false });
  timing.now = () => {
    clockReads += 1;
    if (clockReads > 8) throw new Error('old loop sentinel');
    return 0;
  };
  const options = readinessOptions(timing, (...args) => {
    requests += 1;
    return immediateObservation()(...args);
  });

  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', options),
    (error) => assertPrimaryFailure(error, /503 warming/u, /clock did not advance/u),
  );
  assert.equal(requests, 1);
});

test('stops after one observation when the injected clock moves backward', async () => {
  let current = 0;
  let clockReads = 0;
  let requests = 0;
  const timing = {
    now: () => {
      clockReads += 1;
      if (clockReads > 8) throw new Error('old loop sentinel');
      return current;
    },
    setTimeout(callback) {
      const handle = { active: true };
      setImmediate(() => {
        if (!handle.active) return;
        current -= 1;
        callback();
      });
      return handle;
    },
    clearTimeout(handle) {
      handle.active = false;
    },
  };
  const options = readinessOptions(timing, (...args) => {
    requests += 1;
    return immediateObservation()(...args);
  });

  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', options),
    (error) => assertPrimaryFailure(error, /503 warming/u, /clock moved backward/u),
  );
  assert.equal(requests, 1);
});

test('rejects invalid injected clock values without issuing a request', async () => {
  for (const value of [NaN, Infinity, 'not-a-number']) {
    let requests = 0;
    await assert.rejects(
      waitForPostgrest(10080, 'key', 'container', {
        now: () => value,
        request: () => {
          requests += 1;
          return new FakeOutgoingRequest();
        },
        dockerLogs: () => 'deterministic docker log',
      }),
      (error) => assertPrimaryFailure(error, /no response/u, /clock returned/u),
    );
    assert.equal(requests, 0);
  }
});

test('keeps readiness context when the injected clock throws', async () => {
  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', {
      now: () => { throw new Error('clock read failed'); },
      request: () => { throw new Error('request must not run'); },
      dockerLogs: () => 'deterministic docker log',
    }),
    (error) => assertPrimaryFailure(error, /no response/u, /clock read failed/u),
  );
});

test('absorbs a late response callback and error after timeout settlement', async () => {
  const timing = deterministicTiming();
  const outgoing = new FakeOutgoingRequest();
  let requestCallback;
  const requestImpl = (_options, callback) => {
    requestCallback = callback;
    return outgoing;
  };

  await assert.rejects(
    waitForPostgrest(10080, 'key', 'container', readinessOptions(timing, requestImpl)),
    /PostgREST readiness request timed out after 15000 ms/u,
  );

  const response = fakeUpstreamResponse();
  let responseDestroyCalls = 0;
  response.destroy = () => {
    responseDestroyCalls += 1;
    throw new Error('late response cleanup failed');
  };
  requestCallback(response);
  response.emit('error', new Error('late response error'));
  response.emit('end');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(outgoing.destroyCalls, 1);
  assert.equal(responseDestroyCalls, 1);
});
