import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { JungleScoutClientError } from '@ara/jungle-scout';
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
      querySalesEstimates: async (asin) => {
        salesCalls += 1;
        return {
          data: { estimates: [{ asin, estimatedMonthlySales: null }] },
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

    const seen: string[] = [];
    await runEnrichStrongPotential(candidateId, client, {
      budget,
      asins: ['B0AAA', 'B0AAA', 'B0BBB'],
      querySalesEstimates: async (asin) => {
        seen.push(asin);
        return {
          data: { estimates: [{ asin, estimatedMonthlySales: null }] },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    expect(seen).toEqual(['B0AAA', 'B0BBB']);
  });

  it('sends only relevant ASINs to Sales Estimates', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-rel-${importRunId}`,
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
      source_hash: `enrich-rel-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-rel-row-${importRunId}`,
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
    await client.from('candidate_evidence').insert({
      candidate_id: candidateId,
      kind: 'relevant_asins',
      payload: {
        asins: ['us/B0REL1', 'us/B0REL1', 'us/B0REL2', 'us/B0REL3', 'us/B0REL4'],
        parentKeys: ['us/B0REL1']
      }
    });
    const seen: string[] = [];
    const result = await runEnrichStrongPotential(candidateId, client, {
      budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
      querySalesEstimates: async (asin) => {
        seen.push(asin);
        if (asin === 'B0REL1') {
          throw new JungleScoutClientError('rank data unavailable', 422, false, 1);
        }
        return {
          data: { estimates: [{ asin, estimatedMonthlySales: 10 }] },
          httpAttempts: 1,
          status: 200
        };
      }
    });
    expect(seen).toEqual(['B0REL1', 'B0REL2', 'B0REL3']);
    expect(result.salesAsins).toEqual(['B0REL1', 'B0REL2', 'B0REL3']);
    expect(result.analysisVerdict).not.toBe('strong_potential');
  });

  it('enqueues a future enrich job when Task 11 is deferred', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-def-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-def-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-def-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    await client.from('candidates').insert({
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
    const resumes: string[] = [];
    let calls = 0;
    const result = await runEnrichStrongPotential(candidateId, client, {
      budget: new MemoryApiBudget({ dailyLimit: 20, used: 20, reserve: 5 }),
      queryHistoricalSearchVolume: async () => {
        calls += 1;
        return { data: { keyword: 'faucet mat', points: [] }, httpAttempts: 1, status: 200 };
      },
      enqueueResume: async (input) => {
        resumes.push(input.idempotencyKey);
      }
    });
    expect(result.completed).toBe(false);
    expect(calls).toBe(0);
    expect(resumes).toHaveLength(1);
  });

  it('persists strong_potential as analysis verdict without Strong candidate state', async () => {
    const importRunId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `enrich-strong-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'enrich.csv',
      source_hash: `enrich-strong-${importRunId}`,
      source_row_number: 1,
      row_hash: `enrich-strong-row-${importRunId}`,
      raw_row_text: 'faucet mat',
      raw_row: { Keyword: 'faucet mat' },
      parsed_row: { keyword: 'faucet mat' },
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      is_exact_duplicate: false
    });
    await client.from('candidates').insert({
      id: candidateId,
      import_run_id: importRunId,
      representative_raw_keyword_id: rawId,
      keyword: 'faucet mat',
      normalized_exact_keyword: 'faucet mat',
      state: 'Watch',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 80,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    await client.from('market_snapshots').insert({
      candidate_id: candidateId,
      observed_sample_sales: 2000,
      estimated_market_sales: null,
      sample_product_family_count: 4,
      source_endpoint_set: ['product_database'],
      captured_at: new Date().toISOString(),
      confidence: 0.7,
      metrics: {
        metrics: {
          observedSampleSales: 2000,
          estimatedMarketSales: null,
          top3SalesConcentration: 0.2,
          top10AverageReviews: 40,
          medianReviews: 20,
          shareOver1000Reviews: 0,
          brandConcentration: 0.2,
          amazonRetailPresent: false,
          familyCount: 4,
          priceCompression: 0.1,
          newerLowReviewSellerSuccess: null,
          historicalTrendConsistency: null
        },
        observation: { cacheCapturedAt: new Date().toISOString() }
      }
    });
    await client.from('candidate_evidence').insert({
      candidate_id: candidateId,
      kind: 'review_text',
      payload: { source: 'test', notes: 'permitted review-text fixture' }
    });
    await client.from('candidate_evidence').insert({
      candidate_id: candidateId,
      kind: 'economics_verified',
      payload: { salePrice: 29.99, amazonFees: 10.33, economicsSource: 'supplier_verified' }
    });
    const result = await runEnrichStrongPotential(candidateId, client, {
      budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 })
    });
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    const { data: verdict } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'analysis_verdict')
      .maybeSingle();
    expect(result.analysisVerdict).toBe('strong_potential');
    expect(result.completed).toBe(true);
    expect(candidate?.state).toBe('Watch');
    expect(verdict?.payload).toMatchObject({ verdict: 'strong_potential', candidateState: 'Watch' });
  });
});


