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
test('global DDL lock always brackets provisioning and unlocks after failure', async () => {
  const observations = [];
  const admin = {
    unsafe: async (statement) => {
      observations.push(statement);
      return [];
    },
  };

  await assert.rejects(
    withGlobalDdlLock(admin, async () => {
      observations.push('provision');
      throw new Error('provision failed');
    }),
    /provision failed/u,
  );

  assert.deepEqual(observations, [
    `select pg_advisory_lock(${GLOBAL_DDL_LOCK})`,
    'provision',
    `select pg_advisory_unlock(${GLOBAL_DDL_LOCK})`,
  ]);
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

test('Docker removal tolerates only verified absence', () => {
  const calls = [];
  const absent = (command, args) => {
    calls.push([command, args]);
    return { status: 1, error: undefined, stdout: '', stderr: 'Error response from daemon: No such container: ara_it_1234_abcdef12_deadbeefcafe_pgrst' };
  };
  assert.doesNotThrow(() => removeDockerContainer('ara_it_1234_abcdef12_deadbeefcafe_pgrst', absent));

  const denied = () => ({ status: 1, error: undefined, stdout: '', stderr: 'permission denied' });
  assert.throws(
    () => removeDockerContainer('ara_it_1234_abcdef12_deadbeefcafe_pgrst', denied),
    /docker rm failed: permission denied/u,
  );
  assert.deepEqual(calls, [['docker', ['rm', '-f', 'ara_it_1234_abcdef12_deadbeefcafe_pgrst']]]);
});

test('signal forwarding requests the exact signal, cancels success, and removes exact listeners', () => {
  const source = new EventEmitter();
  const requested = [];
  let cancellationSignal;
  const uninstall = installSignalForwarding(
    source,
    () => ({
      kill(signal) {
        requested.push(signal);
        return true;
      },
    }),
    (signal) => {
      cancellationSignal = signal;
    },
  );

  source.emit('SIGINT');
  assert.throws(() => childExitCode(0, null, cancellationSignal), /signal SIGINT/u);
  source.emit('SIGTERM');
  uninstall();
  source.emit('SIGINT');
  source.emit('SIGTERM');

  assert.deepEqual(requested, ['SIGINT', 'SIGTERM']);
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
});

test('cancellation remains non-success while parent cleanup runs', async () => {
  let cleaned = false;
  await assert.rejects(
    runWithCleanup(
      async () => childExitCode(0, null, 'SIGTERM'),
      async () => {
        cleaned = true;
      },
    ),
    /signal SIGTERM/u,
  );
  assert.equal(cleaned, true);
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
