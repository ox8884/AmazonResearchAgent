import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';

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
