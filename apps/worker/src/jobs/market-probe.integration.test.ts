import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { JungleScoutClientError, ProductDatabasePageSchema } from '@ara/jungle-scout';
import { makeApiCacheKey } from '@ara/shared';
import { createQueue } from '@ara/queue';
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
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => ({
          page: fixture,
          httpAttempts: 3,
          status: 200
        })
      }
    );
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database')
      .maybeSingle();
    expect(usage).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 200,
      success: true
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
    const { data: budgets } = await client
      .from('api_budget_daily')
      .select('used_count')
      .order('budget_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(calls).toBe(1);
    expect(budgets?.used_count).toBe(1);
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
});


