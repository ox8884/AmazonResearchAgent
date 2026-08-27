import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { ProductDatabasePageSchema } from '@ara/jungle-scout';
import { runMarketProbe } from './market-probe';

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
        'sink mat',
        'faucet mat',
        'sink splash guard',
        'silicone sink mat',
        'faucet splash guard'
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
      return fixture;
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

  it('defers normal research when only reserve remains', async () => {
    const { candidateId } = await seedSinkCandidate();
    const budget = new MemoryApiBudget({ dailyLimit: 20, used: 15, reserve: 5 });
    await runMarketProbe(
      { candidateId, locale: 'ko' },
      {
        client,
        budget,
        queryProductDatabase: async () => fixture
      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    expect(candidate?.state).toBe('Waiting for API Budget');
  });
});
