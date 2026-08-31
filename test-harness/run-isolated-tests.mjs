import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import postgres from 'postgres';
import {
  assertDatabaseIdentifier,
  assertRunId,
  childExitCode,
  cleanupRunDatabases,
  createDatabase,
  installSignalForwarding,
  markDatabaseAsTemplate,
  withGlobalDdlLock,
  runWithCleanup,
} from './harness-boundaries.mjs';

const root = resolve(import.meta.dirname, '..');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  throw new Error('Isolated integration harness requires SUPABASE_SERVICE_ROLE_KEY.');
}

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runId = assertRunId(`ara_it_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`);
const templateDatabase = assertDatabaseIdentifier(`${runId}_template`);
const admin = postgres(databaseUrl, { max: 1 });
const sharedDatabase = assertDatabaseIdentifier(`${runId}_shared`);
const sharedMode = process.argv.includes('--shared-db');

async function createTemplateDatabase() {
  await withGlobalDdlLock(admin, async () => {
    await createDatabase(admin, templateDatabase);
    const url = new URL(databaseUrl);
    url.pathname = `/${templateDatabase}`;
    const sql = postgres(url.toString(), { max: 1 });
    try {
      await sql.unsafe('create schema extensions');
      await sql.unsafe(`
        create schema storage;
        create table storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
      `);
      const migrationsDirectory = resolve(root, 'supabase/migrations');
      const migrations = (await readdir(migrationsDirectory))
        .filter((file) => file.endsWith('.sql'))
        .sort();
      for (const migration of migrations) {
        await sql.unsafe(await readFile(resolve(migrationsDirectory, migration), 'utf8'));
      }
    } finally {
      await sql.end();
    }
    await markDatabaseAsTemplate(admin, templateDatabase);
    if (sharedMode) {
      await createDatabase(admin, sharedDatabase, templateDatabase);
    }
  });
}
async function dropTemplateDatabase() {
  await cleanupRunDatabases(admin, runId);
}

const signalController = installSignalForwarding(process);

async function run() {
  const executable = process.execPath;
  await createTemplateDatabase();
  const child = spawn(
    executable,
    [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--passWithNoTests', '--config', resolve(import.meta.dirname, 'vitest.config.mjs')],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ARA_TEST_DATABASE_TEMPLATE: templateDatabase,
        ARA_TEST_SHARED_DATABASE: sharedMode ? sharedDatabase : '',
        ARA_TEST_HARNESS_REST: process.argv.includes('--rest') ? '1' : '0',
        ARA_TEST_RUN_ID: runId,
        TEST_DATABASE_URL: databaseUrl,
      },
      stdio: 'inherit',
    },
  );
  if (!signalController.assignChild(child)) {
    throw new Error('isolated test child was already assigned');
  }
  return new Promise((resolveExit, reject) => {
    child.once('error', (error) => {
      signalController.markChildExited(child);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      signalController.markChildExited(child);
      resolveExit({ code, signal });
    });
  });
}

const childExit = await runWithCleanup(
  run,
  async () => {
    try {
      try {
        await dropTemplateDatabase();
      } finally {
        await admin.end();
      }
    } finally {
      signalController.dispose();
    }
  },
);
process.exitCode = childExitCode(childExit.code, childExit.signal, signalController.cancellationSignal);
