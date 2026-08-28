import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { runEnrichStrongPotential } from './enrich-strong-potential';


const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('strong potential enrichment', () => {
  const client = database();
  const importRuns: string[] = [];

  afterEach(async () => {
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
  });

  it('does not fabricate economics or listing_proxy evidence', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      state: 'Watch',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 70,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;

    const result = await runEnrichStrongPotential(candidateId, client);
    const { data: evidence } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'economics')
      .maybeSingle();

    expect(result.differentiationMode).toBe('missing');
    expect(evidence).toBeNull();
  });

  it('does not call Task 11 adapters unless the candidate is Watch', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-reject-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-reject-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-reject-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      state: 'Reject',
      rule_passed: false,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 10,
      preliminary_score_components: {},
      eligible_for_ai_normalization: false
    });
    if (candidateError) throw candidateError;
    let calls = 0;
    await runEnrichStrongPotential(candidateId, client, {
      queryHistoricalSearchVolume: async () => {
        calls += 1;
        return { data: { keyword: 'faucet mat', points: [] }, httpAttempts: 1, status: 200 };
      }
    });
    expect(calls).toBe(0);
  });

  it('dedupes persisted ASINs and skips Sales Estimates when none exist', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-asin-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-asin-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-asin-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    if (rawError) throw rawError;
    const { error: candidateError } = await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      state: 'Watch',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 70,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 });
    let salesCalls = 0;
    await runEnrichStrongPotential(candidateId, client, {
      budget,
      querySalesEstimates: async (asins) => {
        salesCalls += 1;
        return {
          data: { estimates: asins.map((asin) => ({ asin, estimatedMonthlySales: null })) },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    expect(salesCalls).toBe(0);
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'sales_estimates');
    expect(usage).toHaveLength(0);

    let seen: readonly string[] = [];
    await runEnrichStrongPotential(candidateId, client, {
      budget,
      asins: ['B0AAA', 'B0AAA', 'B0BBB'],
      querySalesEstimates: async (asins) => {
        seen = asins;
        return {
          data: { estimates: asins.map((asin) => ({ asin, estimatedMonthlySales: null })) },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    expect(seen).toEqual(['B0AAA', 'B0BBB']);
  });
});


