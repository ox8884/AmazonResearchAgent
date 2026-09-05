import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { ProductDatabasePageSchema } from '@ara/jungle-scout';
import type { Job } from '@ara/queue';
import { createJobHandlers, resolveJobHandler } from '../handlers';
import { listenOnFetchSafeLoopback } from '../../../../test-harness/safe-loopback-server.mjs';
import { appendResearchBusinessEvidence } from './research-business-test-support';


const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

const fixture = ProductDatabasePageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../tests/fixtures/jungle-scout/product-database-sink.json'
      ),
      'utf8'
    )
  )
);

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

function makeProbeJob(candidateId: string): Job {
  const id = randomUUID();
  return {
    id,
    type: 'MARKET_PROBE',
    payload: { candidateId, locale: 'ko' },
    status: 'running',
    priority: 100,
    availableAt: '2026-08-27T00:00:00.000Z',
    leasedUntil: '2026-08-27T00:02:00.000Z',
    leasedBy: 'worker-a',
    leaseIdentity: { jobId: id, owner: 'worker-a', epoch: 1 },
    attempts: 1,
    maxAttempts: 5,
    idempotencyKey: `probe-wire-${candidateId}`,
    checkpoint: {},
    lastError: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z'
  };
}

async function startFakeJungleScout(): Promise<{
  server: Server;
  baseUrl: string;
  hits: () => number;
}> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.setHeader('content-type', 'application/vnd.api+json');
    response.end(JSON.stringify(fixture));
  });
  const address = await listenOnFetchSafeLoopback(server);
  return {
    server,
    baseUrl: address.url,
    hits: () => hits
  };
}

integration('production MARKET_PROBE wiring', () => {
  const client = database();
  const importRuns: string[] = [];
  const clusterIds: string[] = [];
  const previousEnv = {
    keyName: process.env.JUNGLE_SCOUT_KEY_NAME,
    apiKey: process.env.JUNGLE_SCOUT_API_KEY,
    baseUrl: process.env.JUNGLE_SCOUT_BASE_URL
  };
  let server: Server | undefined;

  afterEach(async () => {
    server?.close();
    server = undefined;
    if (previousEnv.keyName === undefined) {
      delete process.env.JUNGLE_SCOUT_KEY_NAME;
    } else {
      process.env.JUNGLE_SCOUT_KEY_NAME = previousEnv.keyName;
    }
    if (previousEnv.apiKey === undefined) {
      delete process.env.JUNGLE_SCOUT_API_KEY;
    } else {
      process.env.JUNGLE_SCOUT_API_KEY = previousEnv.apiKey;
    }
    if (previousEnv.baseUrl === undefined) {
      delete process.env.JUNGLE_SCOUT_BASE_URL;
    } else {
      process.env.JUNGLE_SCOUT_BASE_URL = previousEnv.baseUrl;
    }
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
    for (const clusterId of clusterIds.splice(0)) {
      await client.from('product_families').delete().eq('niche_cluster_id', clusterId);
      await client.from('niche_clusters').delete().eq('id', clusterId);
    }
  });

  async function seedSinkCandidate(): Promise<{ candidateId: string }> {
    const importRunId = randomUUID();
    const clusterId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    clusterIds.push(clusterId);
    const { error: clusterError } = await client.from('niche_clusters').insert({
      id: clusterId,
      canonical_name: `sink drip tray ${clusterId}`,
      canonical_key: `sink drip tray ${clusterId}`,
      catalog_phrases: [
        `sink mat ${clusterId}`,
        `faucet mat ${clusterId}`,
        `sink splash guard ${clusterId}`
      ],
      state: 'Ready for API Validation'
    });
    if (clusterError) throw clusterError;
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `probe-wire-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'probe.csv',
      source_hash: `probe-wire-${importRunId}`,
      source_row_number: 1,
      row_hash: `probe-wire-row-${importRunId}`,
      raw_row_text: 'sink drip tray',
      raw_row: { Keyword: 'sink drip tray' },
      parsed_row: { keyword: 'sink drip tray' },
      keyword: 'sink drip tray',
      normalized_exact_keyword: 'sink drip tray',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      niche_cluster_id: clusterId,
      keyword: 'sink drip tray',
      normalized_exact_keyword: 'sink drip tray',
      state: 'Ready for API Validation',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 70,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    await appendResearchBusinessEvidence(client, candidateId, {
      requestedApiPurposes: ['product_database']
    });
    return { candidateId };
  }

  // Break: production workers omit MARKET_PROBE or probe Jungle Scout at startup.
  it('reaches a fake Jungle Scout server only when MARKET_PROBE runs', async () => {
    const mock = await startFakeJungleScout();
    server = mock.server;
    process.env.JUNGLE_SCOUT_KEY_NAME = 'AI';
    process.env.JUNGLE_SCOUT_API_KEY = 'wiring-secret-key';
    process.env.JUNGLE_SCOUT_BASE_URL = mock.baseUrl;

    const handlers = createJobHandlers(client);
    expect(handlers.MARKET_PROBE).toEqual(expect.any(Function));
    expect(mock.hits()).toBe(0);

    const { candidateId } = await seedSinkCandidate();
    const checkpoint = await handlers.MARKET_PROBE?.(makeProbeJob(candidateId), {
      signal: new AbortController().signal,
      checkpoint: {},
      setCheckpoint() {},
      async saveCheckpoint() {}
    });

    const { data: families } = await client
      .from('product_families')
      .select('id')
      .in('niche_cluster_id', clusterIds);

    expect(mock.hits()).toBe(1);
    expect(checkpoint).toMatchObject({ phase: 'completed' });
    expect(families?.length ?? 0).toBeGreaterThan(0);
    const { data: deepJobs } = await client
      .from('jobs')
      .select('id,type')
      .like('idempotency_key', `deep-validation:${candidateId}:%`);
    expect(deepJobs ?? []).toHaveLength(0);
  });

  // Break: missing Jungle Scout env crashes the worker or leaks a secret.

  it('fails MARKET_PROBE as configuration error without leaking secrets', async () => {
    delete process.env.JUNGLE_SCOUT_KEY_NAME;
    delete process.env.JUNGLE_SCOUT_API_KEY;
    delete process.env.JUNGLE_SCOUT_BASE_URL;
    const handlers = createJobHandlers(client);
    expect(handlers.MARKET_PROBE).toEqual(expect.any(Function));

    const { candidateId } = await seedSinkCandidate();
    await expect(
      handlers.MARKET_PROBE?.(makeProbeJob(candidateId), {
        signal: new AbortController().signal,
        checkpoint: {},
        setCheckpoint() {},
        async saveCheckpoint() {}
      })
    ).rejects.toThrow(/Jungle Scout is not configured/u);
  });

  it('resolves production DEEP_VALIDATION and ENRICH_STRONG_POTENTIAL handlers', () => {
    const handlers = createJobHandlers(client, {
      apiBudget: {
        authorize: async () => ({ kind: 'blocked_policy', cacheKey: 'x', reason: 'test' })
      },
      queryProductDatabase: async () => ({
        page: fixture,
        httpAttempts: 1,
        status: 200
      }),
      queryKeyword: async () => ({
        keyword: 'x',
        monthlySearchVolume: null,
        isUpperBound: false
      })
    });
    expect(resolveJobHandler(handlers, 'DEEP_VALIDATION')).toBe(handlers.DEEP_VALIDATION);
    expect(resolveJobHandler(handlers, 'ENRICH_STRONG_POTENTIAL')).toBe(
      handlers.ENRICH_STRONG_POTENTIAL
    );
    expect(resolveJobHandler(handlers, 'MARKET_PROBE')).toBe(handlers.MARKET_PROBE);
  });
});

