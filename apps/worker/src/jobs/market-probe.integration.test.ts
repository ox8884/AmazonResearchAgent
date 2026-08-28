import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { DEFAULT_CACHE_TTL_MS, MemoryApiBudget, type ApiBudget } from '@ara/api-budget';
import {
  JungleScoutClient,
  JungleScoutClientError,
  ProductDatabasePageSchema,
  queryProductDatabase
} from '@ara/jungle-scout';
import { makeApiCacheKey } from '@ara/shared';
import { createQueue } from '@ara/queue';
import { createJobHandlers } from '../handlers';
import { runJob } from '../main';
import { runMarketProbe } from './market-probe';
import { PostgresApiBudget } from './postgres-api-budget';




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
const emptyPage = ProductDatabasePageSchema.parse({ data: [] });


function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('market probe job', () => {
  const client = database();
  const importRuns: string[] = [];
  const clusterIds: string[] = [];

  afterEach(async () => {
    await client.from('jobs').delete().like('idempotency_key', 'market-probe-resume:%');
    await client.from('jobs').delete().like('idempotency_key', 'market-probe-inflight:%');
    await client.from('jobs').delete().like('idempotency_key', 'deep-validation:%');
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
        `sink splash guard ${clusterId}`,
        `silicone sink mat ${clusterId}`,
        `faucet splash guard ${clusterId}`
      ],
      state: 'Ready for API Validation'
    });

    if (clusterError) throw clusterError;
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `probe-${importRunId}`,
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
      source_hash: `probe-${importRunId}`,
      source_row_number: 1,
      row_hash: `probe-row-${importRunId}`,
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
    return { candidateId };
  }
  async function seedExpandableCandidate(): Promise<{
    candidateId: string;
    literalPhrases: string[];
    expandedPhrases: string[];
  }> {
    const importRunId = randomUUID();
    const clusterId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    const literalPhrases = [`zero-literal ${clusterId}`];
    const aliases = [`expand-alias ${clusterId}`];
    const expandedPhrases = [...new Set([...literalPhrases, ...aliases])];
    importRuns.push(importRunId);
    clusterIds.push(clusterId);
    const { error: clusterError } = await client.from('niche_clusters').insert({
      id: clusterId,
      canonical_name: `sink drip tray ${clusterId}`,
      canonical_key: `sink drip tray ${clusterId}`,
      catalog_phrases: literalPhrases,
      aliases,
      state: 'Ready for API Validation'
    });
    if (clusterError) throw clusterError;
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `probe-${importRunId}`,
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
      source_hash: `probe-${importRunId}`,
      source_row_number: 1,
      row_hash: `probe-row-${importRunId}`,
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
    return { candidateId, literalPhrases, expandedPhrases };
  }
  async function resetDailyBudget(): Promise<void> {
    const budgetDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
      new Date()
    );
    const { error } = await client.from('api_budget_daily').upsert({
      budget_date: budgetDate,
      daily_limit: 1000,
      reserved_limit: 5,
      used_count: 0,
      reserved_used_count: 0
    });
    if (error) throw error;
  }



  it('expands sink niche, caches the Product Database page, and produces relevant micro niches', async () => {
    const { candidateId } = await seedSinkCandidate();
    let calls = 0;
    const query = async () => {
      calls += 1;
      return { page: fixture, httpAttempts: 1, status: 200 };
    };

    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    const first = await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    budget.seedCache(first.checkpoint.cacheKey ?? 'missing', {
      capturedAt: new Date(),
      ttlMs: 24 * 60 * 60 * 1000
    });
    const second = await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    const { data: families } = await client
      .from('product_families')
      .select('id')
      .in('niche_cluster_id', clusterIds);
    const { data: evidence } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId);
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database');
    const { data: snapshot } = await client
      .from('market_snapshots')
      .select('observed_sample_sales,estimated_market_sales')
      .eq('candidate_id', candidateId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(first.realCalls).toBe(1);
    expect(second.realCalls).toBe(0);
    expect(calls).toBe(1);
    expect(families?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).toContain('Silicone Faucet Mat / Sink Splash Guard');
    expect(usage).toHaveLength(1);
    expect(snapshot?.observed_sample_sales).toBeGreaterThan(0);
    expect(snapshot?.estimated_market_sales).toBeNull();
  });

  it('persists three HTTP attempts when Product Database recovers after two 500s', async () => {
    const { candidateId } = await seedSinkCandidate();
    let hits = 0;
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      hits += 1;
      if (hits < 3) {
        response.statusCode = 500;
        response.end(JSON.stringify({ errors: [{ status: '500' }] }));
        return;
      }
      response.setHeader('content-type', 'application/vnd.api+json');
      response.end(JSON.stringify(fixture));
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const address = http.address() as AddressInfo;
    const jsClient = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: `http://127.0.0.1:${address.port}`
    });
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    try {
      await runMarketProbe(
        { candidateId, locale: 'ko' },
        {
          client,
          budget,
          queryProductDatabase: (phrases) =>
            queryProductDatabase(jsClient, {
              marketplace: 'us',
              phrases: [...phrases]
            })
        }
      );

    } finally {
      http.close();
    }
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database')
      .maybeSingle();
    expect(hits).toBe(3);
    expect(usage).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 200,
      success: true
    });
  });

  it('persists terminal Product Database failure without a success row', async () => {
    const { candidateId } = await seedSinkCandidate();
    let hits = 0;
    const http = createServer((_request: IncomingMessage, response: ServerResponse) => {
      hits += 1;
      response.statusCode = 500;
      response.end(JSON.stringify({ errors: [{ status: '500' }] }));
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const address = http.address() as AddressInfo;
    const jsClient = new JungleScoutClient({
      keyName: 'AI',
      apiKey: 'secret-key',
      baseUrl: `http://127.0.0.1:${address.port}`
    });
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    try {
      await expect(
        runMarketProbe(
          { candidateId, locale: 'ko' },
          {
            client,
            budget,
            queryProductDatabase: (phrases) =>
              queryProductDatabase(jsClient, {
                marketplace: 'us',
                phrases: [...phrases]
              })

          }
        )
      ).rejects.toBeInstanceOf(JungleScoutClientError);
    } finally {
      http.close();
    }
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database');
    expect(hits).toBe(3);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 500,
      success: false
    });
  });


  it('defers normal research when only reserve remains', async () => {
    const { candidateId } = await seedSinkCandidate();
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 });
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => ({ page: fixture, httpAttempts: 1, status: 200 })

      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    expect(candidate?.state).toBe('Waiting for API Budget');
  });

  it('never calls Jungle Scout for blocked_policy or deferred_budget', async () => {
    const { candidateId } = await seedSinkCandidate();
    let calls = 0;
    const query = async () => {
      calls += 1;
      return { page: fixture, httpAttempts: 1, status: 200 };

    };
    const blockedBudget = {
      authorize: async () =>
        ({
          kind: 'blocked_policy' as const,
          cacheKey: 'blocked',
          reason: 'policy'
        })
    };
    const blocked = await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget: blockedBudget, queryProductDatabase: query }
    );
    const deferredBudget = new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 });
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget: deferredBudget, queryProductDatabase: query }
    );
    expect(blocked.checkpoint.phase).toBe('blocked_policy');
    expect(calls).toBe(0);
  });

  it('enqueues exactly one future MARKET_PROBE when budget is deferred', async () => {
    const { candidateId } = await seedSinkCandidate();
    const queue = createQueue(client);
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 });
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => ({ page: fixture, httpAttempts: 1, status: 200 }),

        enqueueResume: async (input) => {
          await queue.enqueueJob({
            type: 'MARKET_PROBE',
            payload: { candidateId: input.candidateId, locale: input.locale },
            idempotencyKey: input.idempotencyKey,
            availableAt: input.availableAt
          });
        }
      }
    );
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => ({ page: fixture, httpAttempts: 1, status: 200 }),

        enqueueResume: async (input) => {
          await queue.enqueueJob({
            type: 'MARKET_PROBE',
            payload: { candidateId: input.candidateId, locale: input.locale },
            idempotencyKey: input.idempotencyKey,
            availableAt: input.availableAt
          });
        }
      }
    );
    const { data: jobs } = await client
      .from('jobs')
      .select('id,available_at,type')
      .like('idempotency_key', `market-probe-resume:${candidateId}:%`);
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]?.type).toBe('MARKET_PROBE');
    expect(jobs?.[0]?.available_at && Date.parse(jobs[0].available_at) > Date.now()).toBe(true);
    await client.from('jobs').delete().eq('id', jobs?.[0]?.id ?? '');
  });

  it('does not re-reserve budget when the same Product Database job retries after failure', async () => {
    const { candidateId } = await seedSinkCandidate();
    const budget = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, 'retry-owner');
    const { data: before } = await client
      .from('api_budget_daily')
      .select('used_count')
      .order('budget_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const usedBefore = before?.used_count ?? 0;
    await expect(
      runMarketProbe(
        { candidateId, locale: 'ko' },
        {
          client,
          budget,
          queryProductDatabase: async () => {
            throw new JungleScoutClientError('provider down', 500, true, 3);
          }
        }
      )
    ).rejects.toBeInstanceOf(JungleScoutClientError);
    let calls = 0;
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => {
          calls += 1;
          return { page: fixture, httpAttempts: 1, status: 200 };
        }
      }
    );
    const { data: after } = await client
      .from('api_budget_daily')
      .select('used_count')
      .order('budget_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(calls).toBe(1);
    expect((after?.used_count ?? 0) - usedBefore).toBe(1);
  });

  it('does not HTTP again when a staged response exists before api_cache persist', async () => {
    const { candidateId } = await seedSinkCandidate();
    const { data: candidate } = await client
      .from('candidates')
      .select('keyword,niche_cluster_id')
      .eq('id', candidateId)
      .single();
    const { data: cluster } = await client
      .from('niche_clusters')
      .select('catalog_phrases')
      .eq('id', candidate?.niche_cluster_id ?? '')
      .maybeSingle();
    const phrases = Array.isArray(cluster?.catalog_phrases)
      ? cluster.catalog_phrases.filter((item): item is string => typeof item === 'string')
      : [candidate?.keyword ?? 'sink drip tray'];
    const cacheKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases
    });
    const budget = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, 'crash-owner');
    await budget.authorize({
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey,
      endpoint: 'product_database'
    });
    await budget.stage(cacheKey, { page: fixture, status: 200, httpAttempts: 3 });
    let calls = 0;
    const result = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => {
          calls += 1;
          return { page: fixture, httpAttempts: 1, status: 200 };
        }
      }
    );
    expect(calls).toBe(0);
    expect(result.realCalls).toBe(0);
  });

  it('defers the second worker while the first owns the cache key', async () => {
    const { candidateId } = await seedSinkCandidate();
    const ownerA = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, 'owner-a');
    const ownerB = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, 'owner-b');
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const startedAtQuery = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: ownerA,
        queryProductDatabase: async () => {
          started?.();
          await held;
          return { page: fixture, httpAttempts: 1, status: 200 };
        }
      }
    );
    await startedAtQuery;
    const second = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: ownerB,
        queryProductDatabase: async () => ({ page: fixture, httpAttempts: 1, status: 200 })
      }
    );
    expect(second.checkpoint.phase).toBe('in_flight');
    expect(second.realCalls).toBe(0);
    release?.();
    const completed = await first;
    expect(completed.checkpoint.phase).toBe('completed');
  });

  it('reuses durable cache after the first worker completes the logical call', async () => {
    const { candidateId } = await seedSinkCandidate();
    const budget = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, 'cache-owner');
    let calls = 0;
    const query = async () => {
      calls += 1;
      return { page: fixture, httpAttempts: 1, status: 200 };
    };
    const first = await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    const second = await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    expect(first.realCalls).toBe(1);
    expect(second.realCalls).toBe(0);
    expect(calls).toBe(1);
  });

  it('recovers expanded Product Database after crash before api_usage', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const expandedKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases: expandedPhrases
    });
    const owner = `expand-crash-${candidateId}`;
    const budget = new PostgresApiBudget(client, { dailyLimit: 1000, reservedLimit: 5 }, owner);
    await budget.authorize({
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey: expandedKey,
      endpoint: 'product_database'
    });
    let expandedHits = 0;
    expandedHits += 1;
    await budget.stage(expandedKey, {
      payload: fixture,
      httpAttempts: 1,
      status: 200
    });
    const { error: cacheError } = await client.from('api_cache').upsert({
      cache_key: expandedKey,
      endpoint: 'product_database',
      response: JSON.parse(JSON.stringify(fixture)),
      captured_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + DEFAULT_CACHE_TTL_MS.product_database).toISOString()
    });
    if (cacheError) throw cacheError;
    const result = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          expect(phrases).toEqual(literalPhrases);
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success,cached')
      .eq('candidate_id', candidateId)
      .eq('cache_key', expandedKey);
    const { data: claim } = await client
      .from('api_call_claims')
      .select('completed_at,usage_persisted')
      .eq('cache_key', expandedKey)
      .maybeSingle();
    expect(expandedHits).toBe(1);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({
      call_count: 1,
      retry_count: 0,
      http_status: 200,
      success: true,
      cached: false
    });
    expect(claim?.usage_persisted).toBe(true);
    expect(claim?.completed_at).not.toBeNull();
    expect(result.checkpoint.phase).toBe('completed');
  });

  it('does not fabricate expanded usage on a completed expanded cache hit', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const expandedKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases: expandedPhrases
    });
    const budget = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-cache-${candidateId}`
    );
    let expandedHits = 0;
    const query = async (phrases: readonly string[]) => {
      if (phrases.join('\0') === expandedPhrases.join('\0')) {
        expandedHits += 1;
        return { page: fixture, httpAttempts: 1, status: 200 };
      }
      expect(phrases).toEqual(literalPhrases);
      return { page: emptyPage, httpAttempts: 1, status: 200 };
    };
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      { client, budget, queryProductDatabase: query }
    );
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('cache_key', expandedKey);
    expect(expandedHits).toBe(1);
    expect(usage).toHaveLength(1);
  });

  it('records expanded terminal Product Database failure without fake success', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const expandedKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases: expandedPhrases
    });
    const budget = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-fail-${candidateId}`
    );
    await expect(
      runMarketProbe(
        { candidateId, locale: 'ko' },
        {
          client,
          budget,
          queryProductDatabase: async (phrases) => {
            if (phrases.join('\0') === expandedPhrases.join('\0')) {
              throw new JungleScoutClientError('expanded provider 500', 500, true, 3);
            }
            expect(phrases).toEqual(literalPhrases);
            return { page: emptyPage, httpAttempts: 1, status: 200 };
          }
        }
      )
    ).rejects.toBeInstanceOf(JungleScoutClientError);
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('cache_key', expandedKey);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 500,
      success: false
    });
  });

  it('defers expanded Product Database when literal consumed the last normal slot', async () => {
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const queue = createQueue(client);
    let expandedHits = 0;
    const result = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 2, used: 0, reserve: 1 }),
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          expect(phrases).toEqual(literalPhrases);
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        },
        enqueueResume: async (input) => {
          await queue.enqueueJob({
            type: 'MARKET_PROBE',
            payload: { candidateId: input.candidateId, locale: input.locale },
            idempotencyKey: input.idempotencyKey,
            availableAt: input.availableAt
          });
        }
      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    const { data: jobs } = await client
      .from('jobs')
      .select('id,type,payload,available_at,status')
      .like('idempotency_key', `market-probe-resume:${candidateId}:%`);
    const { data: snapshots } = await client
      .from('market_snapshots')
      .select('id')
      .eq('candidate_id', candidateId);
    const { data: downstream } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `deep-validation:${candidateId}`);
    expect(expandedHits).toBe(0);
    expect(result.checkpoint.phase).toBe('deferred_budget');
    expect(candidate?.state).toBe('Waiting for API Budget');
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]?.type).toBe('MARKET_PROBE');
    expect(jobs?.[0]?.payload).toMatchObject({ candidateId, locale: 'ko' });
    expect(jobs?.[0]?.available_at && Date.parse(jobs[0].available_at) > Date.now()).toBe(true);
    expect(snapshots ?? []).toHaveLength(0);
    expect(downstream ?? []).toHaveLength(0);
  });

  it('does not complete expanded Product Database while the claim is in flight', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const ownerA = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-inflight-a-${candidateId}`
    );
    const ownerB = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-inflight-b-${candidateId}`
    );
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const startedAtQuery = new Promise<void>((resolve) => {
      started = resolve;
    });
    let expandedHits = 0;
    const first = runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: ownerA,
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            started?.();
            await held;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          expect(phrases).toEqual(literalPhrases);
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    await startedAtQuery;
    const second = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: ownerB,
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    expect(second.checkpoint.phase).toBe('in_flight');
    expect(second.realCalls).toBe(0);
    expect(expandedHits).toBe(1);
    release?.();
    const completed = await first;
    expect(completed.checkpoint.phase).toBe('completed');
  });

  it('blocks expanded Product Database without scoring the literal zero page', async () => {
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const inner = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    let authorizes = 0;
    const budget: ApiBudget = {
      authorize: async (input) => {
        authorizes += 1;
        if (authorizes === 1) {
          return inner.authorize(input);
        }
        return { kind: 'blocked_policy', cacheKey: input.cacheKey, reason: 'blocked' };
      }
    };
    let expandedHits = 0;
    const result = await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          expect(phrases).toEqual(literalPhrases);
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    const { data: snapshots } = await client
      .from('market_snapshots')
      .select('id')
      .eq('candidate_id', candidateId);
    expect(expandedHits).toBe(0);
    expect(result.checkpoint.phase).toBe('blocked_policy');
    expect(candidate?.state).toBe('Ready for API Validation');
    expect(snapshots ?? []).toHaveLength(0);
  });

  it('does not complete a production retry while the expanded claim is in flight', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const expandedKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases: expandedPhrases
    });
    const queue = createQueue(client);
    const workerId = `expand-retry-${candidateId}`;
    let expandedHits = 0;
    const query = async (phrases: readonly string[]) => {
      if (phrases.join('\0') === expandedPhrases.join('\0')) {
        expandedHits += 1;
        throw new JungleScoutClientError('expanded provider 500', 500, true, 3);
      }
      expect(phrases).toEqual(literalPhrases);
      return { page: emptyPage, httpAttempts: 1, status: 200 };
    };
    await queue.enqueueJob({
      type: 'MARKET_PROBE',
      payload: { candidateId, locale: 'ko' },
      idempotencyKey: `market-probe:${candidateId}`
    });
    const firstClaimed = await queue.claimJobs(workerId, 1, 60);
    const firstJob = firstClaimed[0];
    if (!firstJob) {
      throw new Error('Did not claim the initial MARKET_PROBE job.');
    }
    const handlers = createJobHandlers(client, { queryProductDatabase: query });
    await runJob(firstJob, {
      queue,
      handlers,
      workerId,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    const { data: failed } = await client
      .from('jobs')
      .select('id,status,available_at')
      .eq('id', firstJob.id)
      .single();
    expect(failed?.status).toBe('queued');
    expect(expandedHits).toBe(1);
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString(), priority: 1 })
      .eq('id', firstJob.id);
    const retryClaimed = await queue.claimJobs(workerId, 1, 60);
    const retryJob = retryClaimed.find((job) => job.id === firstJob.id);
    if (!retryJob) {
      throw new Error('Did not claim the MARKET_PROBE retry.');
    }
    await runJob(retryJob, {
      queue,
      handlers,
      workerId,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    const { data: afterRetry } = await client
      .from('jobs')
      .select('status,checkpoint')
      .eq('id', firstJob.id)
      .single();
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    const { data: snapshots } = await client
      .from('market_snapshots')
      .select('id')
      .eq('candidate_id', candidateId);
    const { data: downstream } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `deep-validation:${candidateId}`);
    expect(expandedHits).toBe(1);
    expect(afterRetry?.checkpoint).toMatchObject({ phase: 'in_flight' });
    expect(candidate?.state).not.toBe('Watch');
    expect(candidate?.state).not.toBe('Needs Review');
    expect(snapshots ?? []).toHaveLength(0);
    expect(downstream ?? []).toHaveLength(0);
    await client
      .from('api_call_claims')
      .update({ claimed_until: new Date(0).toISOString() })
      .eq('cache_key', expandedKey);
    const { data: inflightRows } = await client
      .from('jobs')
      .select('id')
      .like('idempotency_key', `market-probe-inflight:${candidateId}:%`);
    const nextId = inflightRows?.[0]?.id;
    if (!nextId) {
      throw new Error('Expected an in-flight resume job after the production retry.');
    }
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString(), priority: 1 })
      .eq('id', nextId);
    const reclaimClaimed = await queue.claimJobs(`${workerId}-reclaim`, 1, 60);
    const reclaimJob = reclaimClaimed.find((job) => job.id === nextId);
    if (!reclaimJob) {
      throw new Error('Did not claim the in-flight resume job after lease expiry.');
    }
    await runJob(reclaimJob, {
      queue,
      handlers: createJobHandlers(client, {
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }),
      workerId: `${workerId}-reclaim`,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    expect(expandedHits).toBe(2);

  });

  it('keeps a durable Market Probe after a pre-expiry in-flight continuation', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const expandedKey = makeApiCacheKey({
      endpoint: 'product_database',
      marketplace: 'us',
      phrases: expandedPhrases
    });
    const queue = createQueue(client);
    const workerId = `expand-preexpiry-${candidateId}`;
    let expandedHits = 0;
    const failingQuery = async (phrases: readonly string[]) => {
      if (phrases.join('\0') === expandedPhrases.join('\0')) {
        expandedHits += 1;
        throw new JungleScoutClientError('expanded provider 500', 500, true, 3);
      }
      expect(phrases).toEqual(literalPhrases);
      return { page: emptyPage, httpAttempts: 1, status: 200 };
    };
    await queue.enqueueJob({
      type: 'MARKET_PROBE',
      payload: { candidateId, locale: 'ko' },
      idempotencyKey: `market-probe:${candidateId}`
    });
    const firstClaimed = await queue.claimJobs(workerId, 1, 60);
    const firstJob = firstClaimed[0];
    if (!firstJob) {
      throw new Error('Did not claim the initial MARKET_PROBE job.');
    }
    const handlers = createJobHandlers(client, { queryProductDatabase: failingQuery });
    await runJob(firstJob, {
      queue,
      handlers,
      workerId,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('cache_key', expandedKey);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 500,
      success: false
    });
    const { data: failed } = await client
      .from('jobs')
      .select('id,status')
      .eq('id', firstJob.id)
      .single();
    expect(failed?.status).toBe('queued');
    expect(expandedHits).toBe(1);
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString(), priority: 1 })
      .eq('id', firstJob.id);
    const retryClaimed = await queue.claimJobs(workerId, 1, 60);
    const retryJob = retryClaimed.find((job) => job.id === firstJob.id);
    if (!retryJob) {
      throw new Error('Did not claim the MARKET_PROBE retry.');
    }
    await runJob(retryJob, {
      queue,
      handlers,
      workerId,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    const { data: claim } = await client
      .from('api_call_claims')
      .select('claimed_until')
      .eq('cache_key', expandedKey)
      .single();
    const claimedUntilMs = Date.parse(claim?.claimed_until ?? '');
    expect(claimedUntilMs).toBeGreaterThan(Date.now());
    const { data: afterRetry } = await client
      .from('jobs')
      .select('status,checkpoint')
      .eq('id', firstJob.id)
      .single();
    expect(afterRetry?.checkpoint).toMatchObject({ phase: 'in_flight' });
    expect(expandedHits).toBe(1);
    const { data: firstContinuations } = await client
      .from('jobs')
      .select('id,status,type,payload')
      .like('idempotency_key', `market-probe-inflight:${candidateId}:%`)
      .neq('id', firstJob.id);
    const firstContinuation = firstContinuations?.[0];
    if (!firstContinuation) {
      throw new Error('Expected an in-flight continuation after the production retry.');
    }
    expect(firstContinuation.type).toBe('MARKET_PROBE');
    expect(firstContinuation.payload).toMatchObject({ candidateId, locale: 'ko' });
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString(), priority: 1 })
      .eq('id', firstContinuation.id);
    const preExpiryClaimed = await queue.claimJobs(`${workerId}-early`, 1, 60);
    const preExpiryJob = preExpiryClaimed.find((job) => job.id === firstContinuation.id);
    if (!preExpiryJob) {
      throw new Error('Did not claim the in-flight continuation before lease expiry.');
    }
    await runJob(preExpiryJob, {
      queue,
      handlers,
      workerId: `${workerId}-early`,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    expect(expandedHits).toBe(1);
    expect(Date.parse(claim?.claimed_until ?? '')).toBeGreaterThan(Date.now());
    const { data: afterEarly } = await client
      .from('jobs')
      .select('id,status,available_at,type,payload')
      .eq('type', 'MARKET_PROBE')
      .like('idempotency_key', `market-probe-inflight:${candidateId}:%`);
    const future = (afterEarly ?? []).find(
      (job) =>
        job.status === 'queued' &&
        Date.parse(job.available_at) >= claimedUntilMs &&
        (job.id !== firstContinuation.id || job.status === 'queued')
    );
    expect(future).toBeTruthy();
    expect(future?.id).not.toBe(firstContinuation.id);
    expect(future?.type).toBe('MARKET_PROBE');
    expect(future?.payload).toMatchObject({ candidateId, locale: 'ko' });
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    const { data: snapshots } = await client
      .from('market_snapshots')
      .select('id')
      .eq('candidate_id', candidateId);
    const { data: downstream } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `deep-validation:${candidateId}`);
    expect(candidate?.state).not.toBe('Watch');
    expect(candidate?.state).not.toBe('Needs Review');
    expect(snapshots ?? []).toHaveLength(0);
    expect(downstream ?? []).toHaveLength(0);
    await client
      .from('api_call_claims')
      .update({ claimed_until: new Date(0).toISOString() })
      .eq('cache_key', expandedKey);
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString(), priority: 1 })
      .eq('id', future?.id ?? '');
    const postExpiryClaimed = await queue.claimJobs(`${workerId}-reclaim`, 1, 60);
    const postExpiryJob = postExpiryClaimed.find((job) => job.id === future?.id);
    if (!postExpiryJob) {
      throw new Error('Did not claim the post-expiry MARKET_PROBE job.');
    }
    await runJob(postExpiryJob, {
      queue,
      handlers: createJobHandlers(client, {
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            expandedHits += 1;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }),
      workerId: `${workerId}-reclaim`,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    expect(expandedHits).toBe(2);
    const { data: completedFuture } = await client
      .from('jobs')
      .select('status')
      .eq('id', future?.id ?? '')
      .single();
    expect(completedFuture?.status).toBe('completed');
    const { data: leftover } = await client
      .from('jobs')
      .select('id')
      .like('idempotency_key', `market-probe-inflight:${candidateId}:%`)
      .eq('status', 'queued');
    expect(leftover ?? []).toHaveLength(0);
  });

  it('collapses concurrent in-flight resumes onto one reclaim-window job', async () => {
    await resetDailyBudget();
    const { candidateId, literalPhrases, expandedPhrases } = await seedExpandableCandidate();
    const queue = createQueue(client);
    const ownerA = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-conc-a-${candidateId}`
    );
    const ownerB = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-conc-b-${candidateId}`
    );
    const ownerC = new PostgresApiBudget(
      client,
      { dailyLimit: 1000, reservedLimit: 5 },
      `expand-conc-c-${candidateId}`
    );
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const startedAtQuery = new Promise<void>((resolve) => {
      started = resolve;
    });
    const enqueueResume = async (input: {
      candidateId: string;
      locale: 'ko';
      availableAt: string;
      idempotencyKey: string;
    }) => {
      await queue.enqueueJob({
        type: 'MARKET_PROBE',
        payload: { candidateId: input.candidateId, locale: input.locale },
        idempotencyKey: input.idempotencyKey,
        availableAt: input.availableAt
      });
    };
    const first = runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget: ownerA,
        queryProductDatabase: async (phrases) => {
          if (phrases.join('\0') === expandedPhrases.join('\0')) {
            started?.();
            await held;
            return { page: fixture, httpAttempts: 1, status: 200 };
          }
          expect(phrases).toEqual(literalPhrases);
          return { page: emptyPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    await startedAtQuery;
    const observers = await Promise.all([
      runMarketProbe(
        { candidateId, locale: 'ko' },
        {
          client,
          budget: ownerB,
          queryProductDatabase: async () => {
            throw new Error('observer B must not call the provider');
          },
          enqueueResume
        }
      ),
      runMarketProbe(
        { candidateId, locale: 'ko' },
        {
          client,
          budget: ownerC,
          queryProductDatabase: async () => {
            throw new Error('observer C must not call the provider');
          },
          enqueueResume
        }
      )
    ]);
    expect(observers.map((result) => result.checkpoint.phase)).toEqual(['in_flight', 'in_flight']);
    const { data: inflightJobs } = await client
      .from('jobs')
      .select('id')
      .like('idempotency_key', `market-probe-inflight:${candidateId}:%`);
    expect(inflightJobs).toHaveLength(1);
    release?.();
    await first;
  });



});



