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
