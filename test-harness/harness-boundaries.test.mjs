import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  GLOBAL_DDL_LOCK,
  assertDatabaseIdentifier,
  assertRunId,
  childExitCode,
  cleanupRunDatabases,
  createIdempotentTeardown,
  installSignalForwarding,
  isIntegrationTestPath,
  isRunOwnedDatabase,
  quoteDatabaseIdentifier,
  removeDockerContainer,
  runWithCleanup,
  runOwnedDatabasePrefix,
  withGlobalDdlLock,
} from './harness-boundaries.mjs';

test('database identifiers reject malformed and foreign ownership input', () => {
  const runId = 'ara_it_1234_abcdef12';
  assert.equal(assertRunId(runId), runId);
  assert.equal(assertDatabaseIdentifier(`${runId}_template`), `${runId}_template`);
  assert.equal(quoteDatabaseIdentifier(`${runId}_template`), `"${runId}_template"`);
  assert.equal(runOwnedDatabasePrefix(runId), `${runId}_`);
  assert.equal(isRunOwnedDatabase(`${runId}_shared`, runId), true);
  assert.equal(isRunOwnedDatabase('araXitX1234Xabcdef12_shared', runId), false);
  assert.equal(isRunOwnedDatabase(`${runId.slice(0, -1)}3_shared`, runId), false);

  for (const malformed of [
    'ara_it_1234_abcd_ef1',
    'ara_it_1234_abcd%ef1',
    'ara_it_1234_abcd"ef1',
    'ara_it_1234_abcd;ef1',
    'ara_it_1234_abcd ef1',
    'other_1234_abcdef12',
  ]) {
    assert.throws(() => assertRunId(malformed), /invalid harness run ID/u);
  }
  for (const malformed of [
    `${runId}_bad%name`,
    `${runId}_bad"name`,
    `${runId}_bad;name`,
    `${runId}_bad name`,
    'foreign_database',
  ]) {
    assert.throws(() => assertDatabaseIdentifier(malformed), /invalid harness database identifier/u);
    assert.equal(isRunOwnedDatabase(malformed, runId), false);
  }
});


test('cleanup targets valid current-run databases and refuses a catalog lookalike', async () => {
  const runId = 'ara_it_1234_abcdef12';
  const valid = `${runId}_shared`;
  const lookalike = 'araXitX1234Xabcdef12_shared';
  const statements = [];
  const admin = {
    unsafe: async (statement) => {
      statements.push(statement);
      if (statement.startsWith('select datname')) {
        return [{ datname: valid, datistemplate: false }];
      }
      return [];
    },
  };

  await cleanupRunDatabases(admin, runId);
  assert(statements.includes(`drop database if exists "${valid}" with (force)`));
  assert.equal(statements.some((statement) => statement.includes(' like ')), false);

  statements.length = 0;
  admin.unsafe = async (statement) => {
    statements.push(statement);
    if (statement.startsWith('select datname')) {
      return [
        { datname: valid, datistemplate: false },
        { datname: lookalike, datistemplate: false },
      ];
    }
    return [];
  };
  await assert.rejects(cleanupRunDatabases(admin, runId), /(?:invalid harness database identifier|not owned by harness run)/u);
});
test('global DDL lock preserves acquisition, action, and unlock outcomes', async (t) => {
  await t.test('does not unlock when acquisition fails', async () => {
    const acquisitionError = new Error('lock failed');
    const statements = [];
    const admin = {
      unsafe: async (statement) => {
        statements.push(statement);
        throw acquisitionError;
      },
    };

    await assert.rejects(withGlobalDdlLock(admin, async () => 'unreachable'), (error) => error === acquisitionError);
    assert.deepEqual(statements, [`select pg_advisory_lock(${GLOBAL_DDL_LOCK})`]);
  });

  await t.test('returns the action value after a successful unlock', async () => {
    const statements = [];
    const admin = { unsafe: async (statement) => { statements.push(statement); return []; } };
    assert.equal(await withGlobalDdlLock(admin, async () => 'created'), 'created');
    assert.deepEqual(statements, [
      `select pg_advisory_lock(${GLOBAL_DDL_LOCK})`,
      `select pg_advisory_unlock(${GLOBAL_DDL_LOCK})`,
    ]);
  });

  await t.test('throws an unlock failure after action success', async () => {
    const unlockError = new Error('unlock failed');
    let calls = 0;
    const admin = {
      unsafe: async () => {
        calls += 1;
        if (calls === 2) throw unlockError;
        return [];
      },
    };
    await assert.rejects(withGlobalDdlLock(admin, async () => 'created'), (error) => error === unlockError);
  });

  await t.test('preserves the action failure after a successful unlock', async () => {
    const actionError = new Error('provision failed');
    const admin = { unsafe: async () => [] };
    await assert.rejects(withGlobalDdlLock(admin, async () => { throw actionError; }), (error) => error === actionError);
  });

  await t.test('aggregates action then unlock failures by identity', async () => {
    const actionError = new Error('provision failed');
    const unlockError = new Error('unlock failed');
    let calls = 0;
    const admin = {
      unsafe: async () => {
        calls += 1;
        if (calls === 2) throw unlockError;
        return [];
      },
    };
    await assert.rejects(
      withGlobalDdlLock(admin, async () => { throw actionError; }),
      (error) => {
        assert(error instanceof AggregateError);
        assert.deepEqual(error.errors, [actionError, unlockError]);
        return true;
      },
    );
  });
});

test('teardown aggregates failures while attempting every stage and is idempotent', async () => {
  const calls = [];
  const teardown = createIdempotentTeardown([
    ['proxy', async () => {
      calls.push('proxy');
      throw new Error('proxy close failed');
    }],
    ['docker', async () => {
      calls.push('docker');
      throw new Error('docker rm failed');
    }],
    ['admin', async () => {
      calls.push('admin');
    }],
  ]);

  await assert.rejects(teardown(), (error) => {
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(({ message }) => message), [
      'proxy teardown failed: proxy close failed',
      'docker teardown failed: docker rm failed',
    ]);
    return true;
  });
  await teardown();
  assert.deepEqual(calls, ['proxy', 'docker', 'admin']);
});

test('setup failure remains visible alongside teardown failure', async () => {
  const setupError = new Error('setup failed');
  const teardown = createIdempotentTeardown([
    ['proxy', async () => {
      throw new Error('proxy failed');
    }],
    ['admin', async () => undefined],
  ]);

  await assert.rejects(teardown(setupError), (error) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors[0], setupError);
    assert.match(error.errors[1].message, /proxy teardown failed/u);
    return true;
  });
});

test('Docker removal accepts only the exact daemon absence response', async (t) => {
  const containerName = 'ara_it_1234_abcdef12_deadbeefcafe_pgrst';
  const absence = `Error response from daemon: No such container: ${containerName}`;
  const cases = [
    { name: 'pure stderr absence', result: { status: 1, error: undefined, stdout: '', stderr: absence }, accepted: true },
    { name: 'normalized stderr absence', result: { status: 1, error: undefined, stdout: '', stderr: `\r\n  ${absence}  \r\n` }, accepted: true },
    { name: 'permission plus absence', result: { status: 1, error: undefined, stdout: '', stderr: `permission denied\n${absence}` }, accepted: false },
    { name: 'absence plus warning', result: { status: 1, error: undefined, stdout: '', stderr: `${absence}\nwarning: daemon degraded` }, accepted: false },
    { name: 'mismatched name', result: { status: 1, error: undefined, stdout: '', stderr: 'Error response from daemon: No such container: ara_it_1234_abcdef12_badc0ffee000_pgrst' }, accepted: false },
    { name: 'stdout-only absence', result: { status: 1, error: undefined, stdout: absence, stderr: '' }, accepted: false },
    { name: 'spawn error', result: { status: 1, error: new Error('spawn failed'), stdout: '', stderr: absence }, accepted: false },
    { name: 'null status', result: { status: null, error: undefined, stdout: '', stderr: absence }, accepted: false },
    { name: 'status two', result: { status: 2, error: undefined, stdout: '', stderr: absence }, accepted: false },
    { name: 'successful removal', result: { status: 0, error: undefined, stdout: '', stderr: '' }, accepted: true },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const remove = () => removeDockerContainer(containerName, () => scenario.result);
      if (scenario.accepted) assert.doesNotThrow(remove);
      else assert.throws(remove, /docker rm failed/u);
    });
  }

  assert.throws(
    () => removeDockerContainer('foreign-container', () => { throw new Error('Docker must not run'); }),
    /invalid harness container name/u,
  );
});

test('signal controller is first-signal-wins before child assignment', async (t) => {
  for (const [first, later] of [['SIGINT', 'SIGTERM'], ['SIGTERM', 'SIGINT']]) {
    await t.test(`${first} then ${later}`, () => {
      const source = new EventEmitter();
      const requested = [];
      const controller = installSignalForwarding(source);

      source.emit(first);
      source.emit(later);
      assert.equal(controller.cancellationSignal, first);
      assert.equal(controller.assignChild({ kill: (signal) => { requested.push(signal); return true; } }), true);
      assert.deepEqual(requested, [first]);
      controller.dispose();
    });
  }
});

test('signal controller handles assignment boundary and repeated pre-child signal', () => {
  const source = new EventEmitter();
  const requested = [];
  const controller = installSignalForwarding(source);

  source.emit('SIGINT');
  source.emit('SIGINT');
  assert.deepEqual(requested, []);
  assert.equal(controller.assignChild({ kill: (signal) => { requested.push(signal); return true; } }), true);
  assert.deepEqual(requested, ['SIGINT']);
  controller.dispose();
});

test('signal controller supervises repeated and mixed signals without retargeting', () => {
  const source = new EventEmitter();
  const requested = [];
  const replacementRequested = [];
  const child = {
    kill(signal) {
      requested.push(signal);
      source.emit('SIGTERM');
      return true;
    },
  };
  const controller = installSignalForwarding(source);
  assert.equal(controller.assignChild(child), true);

  source.emit('SIGINT');
  source.emit('SIGINT');
  source.emit('SIGTERM');
  assert.equal(controller.assignChild({ kill: (signal) => { replacementRequested.push(signal); return true; } }), false);

  assert.equal(controller.cancellationSignal, 'SIGINT');
  assert.deepEqual(requested, ['SIGINT']);
  assert.deepEqual(replacementRequested, []);
  assert.equal(source.listenerCount('SIGINT'), 1);
  assert.equal(source.listenerCount('SIGTERM'), 1);
  controller.dispose();
});

test('signal controller supervises cleanup without signaling an exited child', () => {
  const source = new EventEmitter();
  const requested = [];
  const child = { kill: (signal) => { requested.push(signal); return true; } };
  const controller = installSignalForwarding(source);
  controller.assignChild(child);
  controller.markChildExited(child);

  source.emit('SIGTERM');
  source.emit('SIGINT');
  assert.deepEqual(requested, []);
  assert.equal(controller.cancellationSignal, 'SIGTERM');
  assert.throws(() => childExitCode(0, null, controller.cancellationSignal), /signal SIGTERM/u);
  assert.equal(source.listenerCount('SIGINT'), 1);
  assert.equal(source.listenerCount('SIGTERM'), 1);

  controller.dispose();
  controller.dispose();
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
});

test('cancellation remains non-success while parent cleanup runs once', async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    runWithCleanup(
      async () => childExitCode(0, null, 'SIGTERM'),
      async () => {
        cleanupCalls += 1;
      },
    ),
    /signal SIGTERM/u,
  );
  assert.equal(cleanupCalls, 1);
});

test('parent runner preserves action and cleanup failures', async () => {
  const actionError = new Error('action failed');
  const cleanupError = new Error('cleanup failed');
  await assert.rejects(
    runWithCleanup(
      async () => { throw actionError; },
      async () => { throw cleanupError; },
    ),
    (error) => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [actionError, cleanupError]);
      return true;
    },
  );
});

test('acceptance TSX is classified only as integration', () => {
  assert.equal(isIntegrationTestPath('src/example.acceptance.test.tsx'), true);
  assert.equal(isIntegrationTestPath('src/example.acceptance.test.ts'), true);
  assert.equal(isIntegrationTestPath('src/example.integration.test.tsx'), true);
  assert.equal(isIntegrationTestPath('src/example.test.tsx'), false);
});
