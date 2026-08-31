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
    this.boundAddress = outcome !== null
      && typeof outcome === 'object'
      && Object.hasOwn(outcome, 'address')
      ? outcome.address
      : { address: host, family: 'IPv4', port };
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
const scriptedIterable = ({
  values = [], repeat, nextErrorAt, nextError, returnError,
} = {}) => {
  const state = { nextCalls: 0, returnCalls: 0 };
  let index = 0;
  const iterator = {
    next() {
      state.nextCalls += 1;
      if (state.nextCalls === nextErrorAt) throw nextError;
      if (index < values.length) return { done: false, value: values[index++] };
      if (repeat !== undefined) return { done: false, value: repeat };
      return { done: true, value: undefined };
    },
    return() {
      state.returnCalls += 1;
      if (returnError) throw returnError;
      return { done: true, value: undefined };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
  return { iterator, state };
};

const assertTemporaryListenersRemoved = (server) => {
  assert.equal(server.listenerCount('listening'), 0);
  assert.equal(server.listenerCount('error'), 0);
};

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
test('rejects every observed bind identity except the exact requested safe loopback endpoint', async (t) => {
  const cases = [
    ['different port', { address: '127.0.0.1', family: 'IPv4', port: 18082 }],
    ['Fetch-forbidden port', { address: '127.0.0.1', family: 'IPv4', port: 10080 }],
    ['wrong host', { address: '127.0.0.2', family: 'IPv4', port: 18081 }],
    ['string address', 'loopback-pipe'],
    ['null address', null],
    ['out-of-range port', { address: '127.0.0.1', family: 'IPv4', port: 65_536 }],
    ['non-integer port', { address: '127.0.0.1', family: 'IPv4', port: 18081.5 }],
  ];

  for (const [name, address] of cases) {
    await t.test(name, async () => {
      const server = new ScriptedServer([{ address }]);
      await assert.rejects(
        listenOnFetchSafeLoopback(server, { candidates: [18081] }),
        /did not bind the requested Fetch-safe IPv4 endpoint/u,
      );
      assert.equal(server.closeCalls, 0);
      assert.equal(server.listening, true);
      assertTemporaryListenersRemoved(server);
    });
  }

  await t.test('exact candidate', async () => {
    const server = new ScriptedServer([{
      address: { address: '127.0.0.1', family: 'IPv4', port: 18081 },
    }]);
    const result = await listenOnFetchSafeLoopback(server, { candidates: [18081] });
    assert.deepEqual(result, {
      host: '127.0.0.1',
      port: 18081,
      url: 'http://127.0.0.1:18081',
    });
    assert.equal(server.closeCalls, 0);
    assertTemporaryListenersRemoved(server);
  });
});

test('consumes no more than the exact iterator budget and finalizes every early stop', async (t) => {
  await t.test('a throwing fourth next is never consumed', async () => {
    const fourthError = new Error('fourth next consumed');
    const { iterator, state } = scriptedIterable({
      values: [10080, 10080, 10080],
      nextErrorAt: 4,
      nextError: fourthError,
    });
    const server = new ScriptedServer([]);
    await assert.rejects(
      listenOnFetchSafeLoopback(server, { candidates: iterator, maxAttempts: 3 }),
      /exhausted 3 safe loopback port candidates/u,
    );
    assert.deepEqual(state, { nextCalls: 3, returnCalls: 1 });
  });

  const budgetCases = [
    ['exactly three items', { values: [10080, 10080, 10080] }, 3, 1],
    ['two-item natural exhaustion', { values: [10080, 10080] }, 3, 0],
    ['longer finite iterable', { values: [10080, 10080, 10080, 10080] }, 3, 1],
    ['infinite iterable', { repeat: 10080 }, 3, 1],
  ];
  for (const [name, definition, expectedNextCalls, expectedReturnCalls] of budgetCases) {
    await t.test(name, async () => {
      const { iterator, state } = scriptedIterable(definition);
      await assert.rejects(
        listenOnFetchSafeLoopback(new ScriptedServer([]), {
          candidates: iterator,
          maxAttempts: 3,
        }),
        /exhausted/u,
      );
      assert.deepEqual(state, {
        nextCalls: expectedNextCalls,
        returnCalls: expectedReturnCalls,
      });
    });
  }

  await t.test('duplicate candidates retain their positions in the budget', async () => {
    const { iterator, state } = scriptedIterable({ values: [18090, 18090] });
    const server = new ScriptedServer([addressInUse(), addressInUse()]);
    await assert.rejects(
      listenOnFetchSafeLoopback(server, { candidates: iterator, maxAttempts: 2 }),
      /exhausted 2/u,
    );
    assert.deepEqual(server.calls, [
      { port: 18090, host: '127.0.0.1' },
      { port: 18090, host: '127.0.0.1' },
    ]);
    assert.deepEqual(state, { nextCalls: 2, returnCalls: 1 });
  });

  await t.test('EADDRINUSE-only candidates consume and finalize the exact budget', async () => {
    const { iterator, state } = scriptedIterable({ repeat: 18091 });
    const server = new ScriptedServer([addressInUse(), addressInUse(), addressInUse()]);
    await assert.rejects(
      listenOnFetchSafeLoopback(server, { candidates: iterator, maxAttempts: 3 }),
      /exhausted 3/u,
    );
    assert.deepEqual(state, { nextCalls: 3, returnCalls: 1 });
  });
});

test('preserves iterator failures and reports finalization failures deterministically', async (t) => {
  await t.test('next failure inside the budget is preserved by identity', async () => {
    const nextError = new Error('next failed');
    const { iterator, state } = scriptedIterable({
      values: [10080],
      nextErrorAt: 2,
      nextError,
    });
    await assert.rejects(
      listenOnFetchSafeLoopback(new ScriptedServer([]), {
        candidates: iterator,
        maxAttempts: 3,
      }),
      (caught) => caught === nextError,
    );
    assert.deepEqual(state, { nextCalls: 2, returnCalls: 1 });
  });

  await t.test('return failure alone is preserved by identity', async () => {
    const returnError = new Error('return failed');
    const { iterator, state } = scriptedIterable({ values: [18092], returnError });
    const server = new ScriptedServer(['success']);
    await assert.rejects(
      listenOnFetchSafeLoopback(server, { candidates: iterator, maxAttempts: 3 }),
      (caught) => caught === returnError,
    );
    assert.deepEqual(state, { nextCalls: 1, returnCalls: 1 });
    assert.equal(server.closeCalls, 0);
  });

  await t.test('primary and return failures are both reported in causal order', async () => {
    const returnError = new Error('return failed');
    const { iterator, state } = scriptedIterable({ values: [-1], returnError });
    await assert.rejects(
      listenOnFetchSafeLoopback(new ScriptedServer([]), {
        candidates: iterator,
        maxAttempts: 3,
      }),
      (caught) => {
        assert.ok(caught instanceof AggregateError);
        assert.equal(caught.errors.length, 2);
        assert.ok(caught.errors[0] instanceof RangeError);
        assert.equal(caught.errors[1], returnError);
        return true;
      },
    );
    assert.deepEqual(state, { nextCalls: 1, returnCalls: 1 });
  });
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
