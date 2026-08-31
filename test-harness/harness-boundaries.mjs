import { spawnSync } from 'node:child_process';

export const GLOBAL_DDL_LOCK = 202608300831;

const RUN_ID_PATTERN = /^ara_it_[1-9][0-9]*_[a-f0-9]{8}$/u;
const DATABASE_IDENTIFIER_PATTERN = /^(?:ara_it_[1-9][0-9]*_[a-f0-9]{8}|subscription_schema|provider_attempts|provider_runtime|normalization_rearm)_[a-z0-9]+(?:_[a-z0-9]+)*$/u;
const INTEGRATION_TEST_SUFFIXES = [
  '.integration.test.ts',
  '.integration.test.tsx',
  '.acceptance.test.ts',
  '.acceptance.test.tsx',
];
export const INTEGRATION_TEST_GLOBS = INTEGRATION_TEST_SUFFIXES.map((suffix) => `**/*${suffix}`);
const CONTAINER_NAME_PATTERN = /^ara_it_[1-9][0-9]*_[a-f0-9]{8}_[a-f0-9]{12}_pgrst$/u;
const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

function isBoundedAsciiIdentifier(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= POSTGRES_IDENTIFIER_MAX_BYTES;
}

export function assertRunId(value) {
  if (!isBoundedAsciiIdentifier(value) || !RUN_ID_PATTERN.test(value)) {
    throw new Error(`invalid harness run ID: ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertDatabaseIdentifier(value) {
  if (!isBoundedAsciiIdentifier(value) || !DATABASE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`invalid harness database identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function quoteDatabaseIdentifier(value) {
  return `"${assertDatabaseIdentifier(value)}"`;
}

export function runOwnedDatabasePrefix(runId) {
  return `${assertRunId(runId)}_`;
}

export function isRunOwnedDatabase(databaseName, runId) {
  try {
    return assertDatabaseIdentifier(databaseName).startsWith(runOwnedDatabasePrefix(runId));
  } catch {
    return false;
  }
}

export function assertRunOwnedDatabase(databaseName, runId) {
  const validated = assertDatabaseIdentifier(databaseName);
  if (!validated.startsWith(runOwnedDatabasePrefix(runId))) {
    throw new Error(`database ${JSON.stringify(validated)} is not owned by harness run ${JSON.stringify(runId)}`);
  }
  return validated;
}

export async function withGlobalDdlLock(admin, action) {
  await admin.unsafe(`select pg_advisory_lock(${GLOBAL_DDL_LOCK})`);
  return runWithCleanup(
    action,
    async () => admin.unsafe(`select pg_advisory_unlock(${GLOBAL_DDL_LOCK})`),
  );
}

export async function createDatabase(admin, databaseName, templateDatabase) {
  const target = quoteDatabaseIdentifier(databaseName);
  if (templateDatabase === undefined) {
    await admin.unsafe(`create database ${target}`);
    return;
  }
  const template = quoteDatabaseIdentifier(templateDatabase);
  await admin.unsafe(`create database ${target} template ${template}`);
}

export async function markDatabaseAsTemplate(admin, databaseName) {
  await admin.unsafe(`alter database ${quoteDatabaseIdentifier(databaseName)} with is_template true allow_connections false`);
}

export async function dropDatabase(admin, databaseName) {
  await admin.unsafe(`drop database if exists ${quoteDatabaseIdentifier(databaseName)} with (force)`);
}

export async function cleanupRunDatabases(admin, runId) {
  const prefix = runOwnedDatabasePrefix(runId);
  await withGlobalDdlLock(admin, async () => {
    const databases = await admin.unsafe(
      `select datname, datistemplate
       from pg_database
       where left(datname, char_length($1)) = $1
       order by datistemplate, datname`,
      [prefix],
    );
    const owned = databases.map((database) => ({
      datname: assertRunOwnedDatabase(database.datname, runId),
      datistemplate: database.datistemplate === true,
    }));
    for (const database of owned) {
      if (database.datistemplate) {
        await admin.unsafe(`alter database ${quoteDatabaseIdentifier(database.datname)} with is_template false allow_connections true`);
      }
      await dropDatabase(admin, database.datname);
    }
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createIdempotentTeardown(stages) {
  let completed = false;
  return async (originalError) => {
    if (completed) {
      if (originalError !== undefined) throw originalError;
      return;
    }
    completed = true;
    const errors = originalError === undefined ? [] : [originalError];
    for (const [name, stage] of stages) {
      try {
        await stage();
      } catch (error) {
        errors.push(new Error(`${name} teardown failed: ${errorMessage(error)}`, { cause: error }));
      }
    }
    if (errors.length === 0) return;
    if (errors.length === 1 && originalError !== undefined) throw originalError;
    throw new AggregateError(errors, originalError === undefined
      ? 'isolated integration teardown failed'
      : 'isolated integration setup/test and teardown failed');
  };
}

export function assertContainerName(value) {
  if (typeof value !== 'string' || !CONTAINER_NAME_PATTERN.test(value)) {
    throw new Error(`invalid harness container name: ${JSON.stringify(value)}`);
  }
  return value;
}

function normalizedOutput(value) {
  return typeof value === 'string' ? value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim() : '';
}

function verifiedAbsentContainer(result, containerName) {
  if (result.status !== 1 || result.error !== undefined || normalizedOutput(result.stdout) !== '') return false;
  return normalizedOutput(result.stderr) === `Error response from daemon: No such container: ${containerName}`;
}

export function removeDockerContainer(containerName, spawnCommand = spawnSync) {
  const ownedName = assertContainerName(containerName);
  const result = spawnCommand('docker', ['rm', '-f', ownedName], { encoding: 'utf8' });
  if (result.status === 0) return;
  if (verifiedAbsentContainer(result, ownedName)) return;
  const detail = result.error?.message || result.stderr || result.stdout || `exit status ${String(result.status)}`;
  throw new Error(`docker rm failed: ${String(detail).trim()}`);
}

export function installSignalForwarding(signalSource) {
  let cancellationSignal;
  let child;
  let childExited = false;
  let forwarded = false;
  let disposed = false;

  const forwardCancellation = () => {
    if (cancellationSignal === undefined || child === undefined || childExited || forwarded) return;
    forwarded = true;
    child.kill(cancellationSignal);
  };
  const observeSignal = (signal) => {
    cancellationSignal ??= signal;
    forwardCancellation();
  };
  const forwardSigint = () => observeSignal('SIGINT');
  const forwardSigterm = () => observeSignal('SIGTERM');
  signalSource.on('SIGINT', forwardSigint);
  signalSource.on('SIGTERM', forwardSigterm);

  return {
    get cancellationSignal() {
      return cancellationSignal;
    },
    assignChild(ownedChild) {
      if (child !== undefined) return false;
      child = ownedChild;
      forwardCancellation();
      return true;
    },
    markChildExited(ownedChild) {
      if (child !== ownedChild) return false;
      childExited = true;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      signalSource.removeListener('SIGINT', forwardSigint);
      signalSource.removeListener('SIGTERM', forwardSigterm);
    },
  };
}

export async function runWithCleanup(action, cleanup) {
  let actionError;
  try {
    return await action();
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (actionError !== undefined) {
        throw new AggregateError([actionError, cleanupError], 'action and cleanup failed');
      }
      throw cleanupError;
    }
  }
}

export function childExitCode(code, signal, cancellationSignal) {
  if (signal || cancellationSignal) {
    throw new Error(`Vitest exited from signal ${signal ?? cancellationSignal}`);
  }
  return code ?? 1;
}

export function isIntegrationTestPath(file) {
  return INTEGRATION_TEST_SUFFIXES.some((suffix) => file.endsWith(suffix));
}
