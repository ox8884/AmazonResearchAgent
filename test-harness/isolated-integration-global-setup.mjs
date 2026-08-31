import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import postgres from 'postgres';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.TEST_DATABASE_URL;
const templateDatabase = process.env.ARA_TEST_DATABASE_TEMPLATE;
const runId = process.env.ARA_TEST_RUN_ID;
const needsRest = process.env.ARA_TEST_HARNESS_REST === '1';
const network = 'supabase_network_amazon_research_agent';
const databaseHost = 'supabase_db_amazon_research_agent';
const postgrestImage = 'public.ecr.aws/supabase/postgrest:v16.1';
const jwtSecret = 'super-secret-jwt-token-with-at-least-32-characters-long';
const provisioningLock = 202608300831;

function serviceRoleToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'supabase-demo',
    role: 'service_role',
    exp: 1983812996,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function withProvisioningLock(admin, action) {
  await admin.unsafe(`select pg_advisory_lock(${provisioningLock})`);
  try {
    return await action();
  } finally {
    await admin.unsafe(`select pg_advisory_unlock(${provisioningLock})`);
  }
}

function required(value, name) {
  if (!value) throw new Error(`Isolated integration harness requires ${name}.`);
  return value;
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function startProxy(targetPort) {
  const server = createServer((request, response) => {
    const sourceUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = sourceUrl.pathname.replace(/^\/rest\/v1(?=\/|$)/u, '') || '/';
    const target = new URL(`${path}${sourceUrl.search}`, `http://127.0.0.1:${targetPort}`);
    const headers = { ...request.headers };
    delete headers.host;
    const upstream = fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request,
      duplex: 'half',
    });
    void upstream.then(async (upstreamResponse) => {
      response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()));
      response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    }).catch((error) => {
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(error instanceof Error ? error.message : 'PostgREST proxy failure');
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve proxy port.');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function waitForPostgrest(url, key, containerName) {
  const deadline = Date.now() + 15_000;
  let lastObservation = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/jobs?select=id&limit=1`, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
      });
      if (response.ok) return;
      lastObservation = `${response.status} ${await response.text()}`;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      lastObservation = error.message;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  const logs = spawnSync('docker', ['logs', containerName], { encoding: 'utf8' });
  throw new Error(
    `Ephemeral PostgREST did not become ready: ${lastObservation}\n${logs.stderr || logs.stdout}`,
  );
}

export async function setup(project) {
  const adminUrl = required(databaseUrl, 'TEST_DATABASE_URL');
  const key = required(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');
  const selfManaged = /(?:subscription-provider-schema|provider-attempts|provider-runtime|normalization-rearm)\.integration\.test\.ts$/u.test(
    project.name,
  );
  if (selfManaged) {
    project.provide('isolatedSupabaseUrl', process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321');
    project.provide('isolatedServiceRoleKey', key);
    project.provide('isolatedDatabaseUrl', adminUrl);
    return async () => undefined;
  }
  const sharedDatabase = process.env.ARA_TEST_SHARED_DATABASE;
  if (sharedDatabase) {
    const sharedUrl = new URL(adminUrl);
    sharedUrl.pathname = `/${sharedDatabase}`;
    project.provide('isolatedSupabaseUrl', process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321');
    project.provide('isolatedServiceRoleKey', key);
    project.provide('isolatedDatabaseUrl', sharedUrl.toString());
    return async () => undefined;
  }
  const template = required(templateDatabase, 'ARA_TEST_DATABASE_TEMPLATE');
  const currentRun = required(runId, 'ARA_TEST_RUN_ID');
  const suffix = createHash('sha256').update(project.name).digest('hex').slice(0, 12);
  const databaseName = `${currentRun}_${suffix}`;
  const containerName = `${databaseName}_pgrst`;
  const admin = postgres(adminUrl, { max: 1 });
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  const ephemeralKey = serviceRoleToken();
  let proxy;
  let supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

  try {
    await withProvisioningLock(admin, async () => {
      await admin.unsafe(`create database ${databaseName} template ${template}`);
      if (!needsRest) return;
      docker([
        'run', '-d', '--rm', '--name', containerName,
        '--network', network,
        '-p', '127.0.0.1::3000',
        '-e', `PGRST_DB_URI=postgresql://authenticator:postgres@${databaseHost}:5432/${databaseName}`,
        '-e', 'PGRST_DB_SCHEMAS=public',
        '-e', 'PGRST_DB_ANON_ROLE=anon',
        '-e', 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions',
        '-e', `PGRST_JWT_SECRET=${jwtSecret}`,
        postgrestImage,
      ]);
      const portOutput = docker(['port', containerName, '3000/tcp']);
      const targetPort = Number.parseInt(portOutput.slice(portOutput.lastIndexOf(':') + 1), 10);
      if (!Number.isSafeInteger(targetPort)) throw new Error(`Invalid PostgREST port: ${portOutput}`);
      proxy = await startProxy(targetPort);
      await waitForPostgrest(`http://127.0.0.1:${targetPort}`, ephemeralKey, containerName);
      supabaseUrl = proxy.url;
    });

    project.provide('isolatedSupabaseUrl', supabaseUrl);
    project.provide('isolatedServiceRoleKey', needsRest ? ephemeralKey : key);
    project.provide('isolatedDatabaseUrl', isolatedUrl.toString());
  } catch (error) {
    proxy?.server.close();
    if (needsRest) spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
    await admin.end();
    throw error;
  }

  return async () => {
    if (proxy) {
      await new Promise((resolveClose, reject) => {
        proxy.server.close((error) => error ? reject(error) : resolveClose());
      });
    }
    if (needsRest) spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
    await admin.end();
  };
}
