import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { JungleScoutClientError } from '@ara/jungle-scout';
import { makeApiCacheKey, type JungleScoutEndpoint } from '@ara/shared';
import type { Job } from '@ara/queue';
import { createQueue } from '@ara/queue';
import { createJobHandlers } from '../handlers';
import { runDeepValidation } from './deep-validation';
import { PostgresApiBudget } from './postgres-api-budget';
import { appendResearchBusinessEvidence } from './research-business-test-support';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('deep validation job', () => {
  const client = database();
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
  });

  async function seedCandidate(
    state: 'Reject' | 'Watch',
    requestedApiPurposes: readonly JungleScoutEndpoint[] = ['keywords_by_keyword']
  ): Promise<{
    readonly candidateId: string;
    readonly keyword: string;
  }> {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    const keyword = `sink splash guard ${candidateId}`;
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `deep-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'deep.csv',
      source_hash: `deep-${importRunId}`,
      source_row_number: 1,
      row_hash: `deep-row-${importRunId}`,
      raw_row_text: keyword,
      raw_row: { Keyword: keyword },
      parsed_row: { keyword },
      keyword,
      normalized_exact_keyword: keyword,
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword,
      normalized_exact_keyword: keyword,
      state,
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 60,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    await appendResearchBusinessEvidence(client, candidateId, {
      requestedApiPurposes
    });
    return { candidateId, keyword };
  }

  it('does not spend Level 2 calls on a Level 1 Reject', async () => {
    const { candidateId } = await seedCandidate('Reject');
    const result = await runDeepValidation(candidateId, 'ko', { client });
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'keywords_by_keyword');
    expect(result.keywordCalls).toBe(0);
    expect(usage).toHaveLength(0);
  });

  it('enqueues exactly one ENRICH_STRONG_POTENTIAL for Watch', async () => {
    const { candidateId } = await seedCandidate('Watch', [
      'keywords_by_keyword',
      'historical_search_volume'
    ]);
    const handlers = createJobHandlers(client, {
      apiBudget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
      queryKeyword: async () => ({
        keyword: 'sink splash guard',
        monthlySearchVolume: null,
        isUpperBound: false
      })
    });
    const jobId = randomUUID();
    const job: Job = {
      id: jobId,
      type: 'DEEP_VALIDATION',
      payload: { candidateId, locale: 'ko' },
      status: 'running',
      priority: 100,
      availableAt: '2026-08-27T00:00:00.000Z',
      leasedUntil: '2026-08-27T00:02:00.000Z',
      leasedBy: 'worker-a',
      leaseIdentity: { jobId, owner: 'worker-a', epoch: 1 },
      attempts: 1,
      maxAttempts: 5,
      idempotencyKey: `deep-validation:${candidateId}`,
      checkpoint: {},
      lastError: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z'
    };

    await handlers.DEEP_VALIDATION?.(job, {
      signal: new AbortController().signal,
      checkpoint: {},
      setCheckpoint() {},
      async saveCheckpoint() {}
    });
    await handlers.DEEP_VALIDATION?.(job, {
      signal: new AbortController().signal,
      checkpoint: {},
      setCheckpoint() {},
      async saveCheckpoint() {}
    });
    const { data: jobs } = await client
      .from('jobs')
      .select('id,type')
      .like('idempotency_key', `enrich-strong:${candidateId}:%`);
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]?.type).toBe('ENRICH_STRONG_POTENTIAL');
    await client.from('jobs').delete().eq('id', jobs?.[0]?.id ?? '');
  });

  it('does not HTTP and enqueues resume when Deep Validation is deferred', async () => {
    const { candidateId } = await seedCandidate('Watch');
    const queue = createQueue(client);
    let calls = 0;
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget: new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 }),
      queryKeyword: async () => {
        calls += 1;
        return { keyword: 'sink splash guard', monthlySearchVolume: 100, isUpperBound: false };
      },
      enqueueResume: async (input) => {
        await queue.enqueueJob({
          type: 'DEEP_VALIDATION',
          payload: { candidateId: input.candidateId, locale: input.locale },
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt
        });
      }
    });
    const { data: jobs } = await client
      .from('jobs')
      .select('id,type')
      .like('idempotency_key', `deep-validation-resume:${candidateId}:%`);
    expect(result.completed).toBe(false);
    expect(result.outcome).toBe('deferred_budget');
    expect(calls).toBe(0);
    expect(jobs).toHaveLength(1);
    await client.from('jobs').delete().eq('id', jobs?.[0]?.id ?? '');
  });

  it('does not HTTP and enqueues resume when the Keyword claim is in flight', async () => {
    const { candidateId } = await seedCandidate('Watch');
    const queue = createQueue(client);
    let calls = 0;
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget: {
        authorize: async () => ({ kind: 'in_flight' as const, cacheKey: 'inflight' })
      },
      queryKeyword: async () => {
        calls += 1;
        return { keyword: 'sink splash guard', monthlySearchVolume: 100, isUpperBound: false };
      },
      enqueueResume: async (input) => {
        await queue.enqueueJob({
          type: 'DEEP_VALIDATION',
          payload: { candidateId: input.candidateId, locale: input.locale },
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt
        });
      }
    });
    const { data: jobs } = await client
      .from('jobs')
      .select('id,type')
      .like('idempotency_key', `deep-validation-inflight:${candidateId}:%`);
    expect(result.completed).toBe(false);
    expect(result.outcome).toBe('in_flight');
    expect(calls).toBe(0);
    expect(jobs).toHaveLength(1);
    await client.from('jobs').delete().eq('id', jobs?.[0]?.id ?? '');
  });

  it('records zero HTTP for blocked Keyword policy', async () => {
    const { candidateId } = await seedCandidate('Watch');
    let calls = 0;
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget: {
        authorize: async () => ({
          kind: 'blocked_policy' as const,
          cacheKey: 'blocked',
          reason: 'policy'
        })
      },
      queryKeyword: async () => {
        calls += 1;
        return { keyword: 'sink splash guard', monthlySearchVolume: 100, isUpperBound: false };
      }
    });
    expect(result.completed).toBe(false);
    expect(calls).toBe(0);
  });

  it('restores Keyword evidence from cache without HTTP', async () => {
    const { candidateId, keyword } = await seedCandidate('Watch');
    const cacheKey = makeApiCacheKey({
      endpoint: 'keywords_by_keyword',
      marketplace: 'us',
      phrases: [keyword]
    });
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    budget.seedCache(cacheKey, { capturedAt: new Date(), ttlMs: 7 * 24 * 60 * 60 * 1000 });
    await client.from('api_cache').upsert({
      cache_key: cacheKey,
      endpoint: 'keywords_by_keyword',
      response: { keyword: 'sink splash guard', monthlySearchVolume: 880, isUpperBound: false },
      captured_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });
    let calls = 0;
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget,
      queryKeyword: async () => {
        calls += 1;
        return { keyword: 'sink splash guard', monthlySearchVolume: 1, isUpperBound: false };
      }
    });
    const { data: evidence } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'keyword_metrics')
      .maybeSingle();
    expect(result.completed).toBe(true);
    expect(result.keywordCalls).toBe(0);
    expect(calls).toBe(0);
    expect(evidence?.payload).toMatchObject({ monthlySearchVolume: 880 });
  });

  it('persists three Keyword attempts after 500 then 200', async () => {
    const { candidateId } = await seedCandidate('Watch');
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
      queryKeyword: async () => ({
        keyword: 'sink splash guard',
        monthlySearchVolume: 500,
        isUpperBound: false,
        httpAttempts: 3,
        status: 200
      })
    });
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'keywords_by_keyword')
      .maybeSingle();
    expect(result.completed).toBe(true);
    expect(usage).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 200,
      success: true
    });
  });

  it('persists terminal Keyword failure without enqueueing Level 3', async () => {
    const { candidateId } = await seedCandidate('Watch');
    await expect(
      runDeepValidation(candidateId, 'ko', {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryKeyword: async () => {
          throw new JungleScoutClientError('keyword down', 500, true, 3);
        }
      })
    ).rejects.toBeInstanceOf(JungleScoutClientError);
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,http_status,success')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'keywords_by_keyword');
    const { data: jobs } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `enrich-strong:${candidateId}`);
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({ call_count: 3, http_status: 500, success: false });
    expect(jobs).toHaveLength(0);
  });

  it('reuses a staged Keyword response without a second HTTP call', async () => {
    const { candidateId, keyword } = await seedCandidate('Watch');
    const cacheKey = makeApiCacheKey({
      endpoint: 'keywords_by_keyword',
      marketplace: 'us',
      phrases: [keyword]
    });
    const budget = new PostgresApiBudget(
      client,
      { dailyLimit: 20, reservedLimit: 5 },
      `deep-crash-${candidateId}`
    );
    await budget.authorize({
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey,
      endpoint: 'keywords_by_keyword'
    });
    await budget.stage(cacheKey, {
      payload: { keyword: 'sink splash guard', monthlySearchVolume: 777, isUpperBound: false },
      status: 200,
      httpAttempts: 3
    });
    let calls = 0;
    const result = await runDeepValidation(candidateId, 'ko', {
      client,
      budget,
      queryKeyword: async () => {
        calls += 1;
        return { keyword: 'sink splash guard', monthlySearchVolume: 1, isUpperBound: false };
      }
    });
    expect(calls).toBe(0);
    expect(result.completed).toBe(true);
    expect(result.keywordCalls).toBe(0);
  });

  it('does not enqueue Level 3 when Deep Validation is deferred', async () => {
    const { candidateId } = await seedCandidate('Watch');
    const handlers = createJobHandlers(client, {
      apiBudget: new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 }),
      queryKeyword: async () => ({
        keyword: 'sink splash guard',
        monthlySearchVolume: 100,
        isUpperBound: false
      })
    });
    const jobId = randomUUID();
    const job: Job = {
      id: jobId,
      type: 'DEEP_VALIDATION',
      payload: { candidateId, locale: 'ko' },
      status: 'running',
      priority: 100,
      availableAt: '2026-08-27T00:00:00.000Z',
      leasedUntil: '2026-08-27T00:02:00.000Z',
      leasedBy: 'worker-a',
      leaseIdentity: { jobId, owner: 'worker-a', epoch: 1 },
      attempts: 1,
      maxAttempts: 5,
      idempotencyKey: `deep-validation:${candidateId}`,
      checkpoint: {},
      lastError: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z'
    };
    await handlers.DEEP_VALIDATION?.(job, {
      signal: new AbortController().signal,
      checkpoint: {},
      setCheckpoint() {},
      async saveCheckpoint() {}
    });
    const { data: jobs } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `enrich-strong:${candidateId}`);
    expect(jobs).toHaveLength(0);
  });
});


