import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import postgres from 'postgres';

const root = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runId = `ara_it_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const templateDatabase = `${runId}_template`;
const admin = postgres(databaseUrl, { max: 1 });
const sharedDatabase = `${runId}_shared`;
const sharedMode = process.argv.includes('--shared-db');
const databaseDropLock = 202608300830;

async function createTemplateDatabase() {
  await admin.unsafe(`create database ${templateDatabase}`);
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
  await admin.unsafe(`alter database ${templateDatabase} with is_template true allow_connections false`);
}
async function dropDatabase(name) {
  await admin.unsafe(`select pg_advisory_lock(${databaseDropLock})`);
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.unsafe(`select pg_advisory_unlock(${databaseDropLock})`);
  }
}

async function dropTemplateDatabase() {
  const databases = await admin`
    select datname, datistemplate
    from pg_database
    where datname like ${`${runId}_%`}
    order by datistemplate, datname
  `;
  for (const database of databases) {
    if (database.datistemplate) {
      await admin.unsafe(`alter database ${database.datname} with is_template false allow_connections true`);
    }
    await dropDatabase(database.datname);
  }
}

async function run() {
  await createTemplateDatabase();
  if (sharedMode) {
    await admin.unsafe(`create database ${sharedDatabase} template ${templateDatabase}`);
  }
  const executable = process.execPath;
  let child;
  const forwardSignal = (signal) => {
    child?.kill(signal);
  };
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);
  try {
    child = spawn(
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
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Vitest exited from signal ${signal}`));
          return;
        }
        resolveExit(code ?? 1);
      });
    });
  } finally {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
  }
}

let exitCode = 1;
try {
  exitCode = await run();
} finally {
  try {
    await dropTemplateDatabase();
  } finally {
    await admin.end();
  }
}
process.exitCode = exitCode;
