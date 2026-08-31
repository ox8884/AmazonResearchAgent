import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  isFetchForbiddenPort,
  listenOnFetchSafeLoopback,
} from './safe-loopback-server.mjs';

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});
class ScriptedServer extends EventEmitter {
  constructor(outcomes) {
    super();
    this.outcomes = [...outcomes];
    this.calls = [];
    this.closeCalls = 0;
    this.listening = false;
    this.boundAddress = null;
  }

  listen(port, host) {
    this.calls.push({ port, host });
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) {
      queueMicrotask(() => this.emit('error', outcome));
      return this;
    }
    this.listening = true;
    this.boundAddress = { address: host, family: 'IPv4', port };
    queueMicrotask(() => this.emit('listening'));
    return this;
  }

  address() {
    return this.boundAddress;
  }

  close(callback) {
    this.closeCalls += 1;
    this.listening = false;
    this.boundAddress = null;
    queueMicrotask(() => {
      this.emit('close');
      callback?.();
    });
    return this;
  }
}

const addressInUse = () => Object.assign(new Error('address in use'), { code: 'EADDRINUSE' });

test('classifies the observed Windows port and representative WHATWG bad ports', () => {
  for (const port of [0, 22, 2049, 6000, 6667, 10080]) {
    assert.equal(isFetchForbiddenPort(port), true, `${port} must be forbidden`);
  }
  for (const port of [80, 443, 3000, 49152, 65535]) {
    assert.equal(isFetchForbiddenPort(port), false, `${port} must be allowed`);
  }
});

test('skips forbidden candidates and binds the supplied server to an allowed port', async () => {
  const server = new ScriptedServer(['success']);
  const result = await listenOnFetchSafeLoopback(server, {
    candidates: [10080, 18080],
  });
  assert.equal(result.port, 18080);
  assert.equal(server.listening, true);
  assert.deepEqual(server.calls, [{ port: 18080, host: '127.0.0.1' }]);
});

test('fails immediately on unexpected listen errors', async () => {
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const server = new ScriptedServer([error, 'success']);
  await assert.rejects(
    listenOnFetchSafeLoopback(server, { candidates: [18080, 18081] }),
    (caught) => caught === error,
  );
  assert.deepEqual(server.calls, [{ port: 18080, host: '127.0.0.1' }]);
});

test('advances after address-in-use only within the candidate contract', async () => {
  const server = new ScriptedServer([addressInUse(), 'success']);
  const result = await listenOnFetchSafeLoopback(server, {
    candidates: [18082, 18083],
  });
  assert.equal(result.port, 18083);
  assert.deepEqual(server.calls, [
    { port: 18082, host: '127.0.0.1' },
    { port: 18083, host: '127.0.0.1' },
  ]);
});

test('reports bounded candidate exhaustion clearly without closing the supplied server', async () => {
  const server = new ScriptedServer([addressInUse(), addressInUse()]);
  await assert.rejects(
    listenOnFetchSafeLoopback(server, { candidates: [18084, 18085] }),
    /exhausted 2 safe loopback port candidates/u,
  );
  assert.equal(server.closeCalls, 0);
});

test('concurrent allocations keep distinct active listeners and return Fetch-accepted URLs', async () => {
  const first = createServer((_request, response) => response.end('first'));
  const second = createServer((_request, response) => response.end('second'));
  const [firstAddress, secondAddress] = await Promise.all([
    listenOnFetchSafeLoopback(first),
    listenOnFetchSafeLoopback(second),
  ]);
  try {
    assert.notEqual(firstAddress.port, secondAddress.port);
    assert.equal(new URL(firstAddress.url).hostname, '127.0.0.1');
    assert.equal(await (await fetch(firstAddress.url)).text(), 'first');
    assert.equal(await (await fetch(secondAddress.url)).text(), 'second');
  } finally {
    await Promise.all([close(first), close(second)]);
  }
});
