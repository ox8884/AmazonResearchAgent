import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { DEFAULT_CACHE_TTL_MS } from '@ara/api-budget';
import { makeApiCacheKey } from '@ara/shared';
import { executeBudgetedApiCall } from './budgeted-api-call';
import { PostgresApiBudget } from './postgres-api-budget';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('budgeted API call crash accounting', () => {
  const client = database();
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
  });

  async function seedCandidate(): Promise<{ candidateId: string; keyword: string }> {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    const keyword = `crash keyword ${candidateId}`;
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `crash-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'crash.csv',
      source_hash: `crash-${importRunId}`,
      source_row_number: 1,
      row_hash: `crash-row-${importRunId}`,
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
      state: 'Watch',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 60,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    return { candidateId, keyword };
  }

  it('records paid usage after a crash between cache publication and api_usage', async () => {
    const { candidateId, keyword } = await seedCandidate();
    const cacheKey = makeApiCacheKey({
      endpoint: 'keywords_by_keyword',
      marketplace: 'us',
      phrases: [keyword]
    });
    const owner = `crash-owner-${candidateId}`;
    const budget = new PostgresApiBudget(client, { dailyLimit: 20, reservedLimit: 5 }, owner);
    await budget.authorize({
      purpose: 'normal_validation',
      estimatedCalls: 1,
      cacheKey,
      endpoint: 'keywords_by_keyword'
    });
    let hits = 0;
    const payload = { keyword, monthlySearchVolume: 440, isUpperBound: false };
    hits += 1;
    await budget.stage(cacheKey, { payload, httpAttempts: 3, status: 200 });
    const { error: cacheError } = await client.from('api_cache').upsert({
      cache_key: cacheKey,
      endpoint: 'keywords_by_keyword',
      response: payload,
      captured_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + DEFAULT_CACHE_TTL_MS.keywords_by_keyword).toISOString()
    });
    if (cacheError) throw cacheError;

    const retry = await executeBudgetedApiCall({
      client,
      budget,
      candidateId,
      endpoint: 'keywords_by_keyword',
      cacheKey,
      purpose: 'normal_validation',
      ttlMs: DEFAULT_CACHE_TTL_MS.keywords_by_keyword,
      query: async () => {
        hits += 1;
        return { payload, httpAttempts: 1, status: 200 };
      }
    });
    const { data: usage } = await client
      .from('api_usage')
      .select('call_count,retry_count,http_status,success,cached')
      .eq('candidate_id', candidateId)
      .eq('cache_key', cacheKey);
    const { data: claim } = await client
      .from('api_call_claims')
      .select('completed_at,usage_persisted')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    expect(hits).toBe(1);
    expect(retry.kind).toBe('completed');
    if (retry.kind === 'completed') {
      expect(retry.fromCache).toBe(true);
    }
    expect(usage).toHaveLength(1);
    expect(usage?.[0]).toMatchObject({
      call_count: 3,
      retry_count: 2,
      http_status: 200,
      success: true,
      cached: false
    });
    expect(claim?.usage_persisted).toBe(true);
    expect(claim?.completed_at).not.toBeNull();
  });

  it('does not fabricate usage for an older completed cache hit', async () => {
    const { candidateId, keyword } = await seedCandidate();
    const cacheKey = makeApiCacheKey({
      endpoint: 'keywords_by_keyword',
      marketplace: 'us',
      phrases: [keyword]
    });
    const budget = new PostgresApiBudget(
      client,
      { dailyLimit: 20, reservedLimit: 5 },
      `old-cache-${candidateId}`
    );
    let hits = 0;
    await executeBudgetedApiCall({
      client,
      budget,
      candidateId,
      endpoint: 'keywords_by_keyword',
      cacheKey,
      purpose: 'normal_validation',
      ttlMs: DEFAULT_CACHE_TTL_MS.keywords_by_keyword,
      query: async () => {
        hits += 1;
        return {
          payload: { keyword, monthlySearchVolume: 10, isUpperBound: false },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    await executeBudgetedApiCall({
      client,
      budget,
      candidateId,
      endpoint: 'keywords_by_keyword',
      cacheKey,
      purpose: 'normal_validation',
      ttlMs: DEFAULT_CACHE_TTL_MS.keywords_by_keyword,
      query: async () => {
        hits += 1;
        return {
          payload: { keyword, monthlySearchVolume: 99, isUpperBound: false },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('cache_key', cacheKey);
    expect(hits).toBe(1);
    expect(usage).toHaveLength(1);
  });
});
