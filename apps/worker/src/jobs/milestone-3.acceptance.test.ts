import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import { ProductDatabasePageSchema, type ProductDatabasePage } from '@ara/jungle-scout';
import { runMarketProbe } from './market-probe';
import { PostgresApiBudget } from './postgres-api-budget';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;
const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/jungle-scout'
);

function loadPage(name: string): ProductDatabasePage {
  return ProductDatabasePageSchema.parse(
    JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
  );
}

function loadMeta(name: string): { result_count: number } {
  const raw = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as {
    meta?: { result_count?: number };
  };
  return { result_count: raw.meta?.result_count ?? 0 };
}

const sinkPage = loadPage('product-database-sink.json');
const sinkZero = loadPage('product-database-sink-zero.json');
const milkFrother = loadPage('product-database-milk-frother.json');
const batter = loadPage('product-database-batter-dispenser.json');
const expandedMeta = loadMeta('product-database-sink-expanded-meta.json');

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('Milestone 3 full-pipeline fixtures', () => {
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

  async function seedCandidate(keyword: string, phrases: readonly string[]): Promise<string> {
    const importRunId = randomUUID();
    const clusterId = randomUUID();
    const rawId = randomUUID();
    const candidateId = randomUUID();
    importRuns.push(importRunId);
    clusterIds.push(clusterId);
    const { error: clusterError } = await client.from('niche_clusters').insert({
      id: clusterId,
      canonical_name: keyword,
      canonical_key: `${keyword} ${clusterId}`,
      catalog_phrases: phrases.map((phrase) => `${phrase} ${clusterId}`),
      aliases: [keyword]
    });
    if (clusterError) throw clusterError;
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `m3-${importRunId}`,
      file_count: 1,
      total_row_count: 1,
      unique_keyword_count: 1,
      source_files: []
    });
    if (importError) throw importError;
    const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
      id: rawId,
      import_run_id: importRunId,
      source_file_name: 'milestone.csv',
      source_hash: `m3-${importRunId}`,
      source_row_number: 1,
      row_hash: `m3-row-${importRunId}`,
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
      niche_cluster_id: clusterId,
      representative_raw_keyword_id: rawId,
      keyword,
      normalized_exact_keyword: keyword,
      state: 'Ready for API Validation',
      rule_passed: true,
      rule_reasons: [],
      risk_flags: [],
      preliminary_score: 70,
      preliminary_score_components: {},
      eligible_for_ai_normalization: true
    });
    if (candidateError) throw candidateError;
    return candidateId;
  }

  it('validates the Zulay milk frother family without double-counting variants', async () => {
    const candidateId = await seedCandidate('milk frother', ['milk frother']);
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async () => ({ page: milkFrother, httpAttempts: 1, status: 200 })
      }
    );
    const { data: snapshot } = await client
      .from('market_snapshots')
      .select('observed_sample_sales,estimated_market_sales,sample_product_family_count')
      .eq('candidate_id', candidateId)
      .maybeSingle();
    expect(snapshot?.sample_product_family_count).toBe(1);
    expect(snapshot?.observed_sample_sales).toBe(200368);
    expect(snapshot?.estimated_market_sales).toBeNull();
  });

  it('treats the recorded sink drip tray zero page as empty sample sales', async () => {
    const candidateId = await seedCandidate('sink drip tray', ['sink drip tray']);
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async () => ({ page: sinkZero, httpAttempts: 1, status: 200 })
      }
    );
    const { data: snapshot } = await client
      .from('market_snapshots')
      .select('observed_sample_sales,sample_product_family_count')
      .eq('candidate_id', candidateId)
      .maybeSingle();
    expect(snapshot?.sample_product_family_count).toBe(0);
    expect(snapshot?.observed_sample_sales).toBe(0);
  });

  it('records expanded sink metadata 329 while probing the top page', async () => {
    expect(expandedMeta.result_count).toBe(329);
    const candidateId = await seedCandidate('sink drip tray', [
      'sink mat',
      'faucet mat',
      'sink splash guard'
    ]);
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async () => ({ page: sinkPage, httpAttempts: 1, status: 200 })
      }
    );
    const { data: products } = await client
      .from('products')
      .select('asin,seller_type,attributes')
      .eq('asin', 'B0SINKMAT1')
      .maybeSingle();
    const { data: relevant } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'relevant_asins')
      .maybeSingle();
    const { data: niches } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'micro_niches')
      .maybeSingle();
    expect(products?.seller_type).toBe('FBA');
    expect(products?.attributes).toMatchObject({
      dimensions: { length: 5.5, width: 5.5, height: 0.2 }
    });
    expect(relevant?.payload).toMatchObject({ asins: expect.arrayContaining(['B0SINKMAT1']) });
    expect(JSON.stringify(niches?.payload)).toMatch(/Silicone Faucet Mat/);
  });

  it('clusters the batter-dispenser Opportunity Finder fixture and drops rug noise', async () => {
    const candidateId = await seedCandidate('pancake dispenser bottle', [
      'pancake dispenser bottle'
    ]);
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async () => ({ page: batter, httpAttempts: 1, status: 200 })
      }
    );
    const { data: relevant } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'relevant_asins')
      .maybeSingle();
    const asins =
      relevant?.payload && typeof relevant.payload === 'object' && 'asins' in relevant.payload
        ? (relevant.payload as { asins: string[] }).asins
        : [];
    expect(asins).toContain('B0BATTER1');
    expect(asins).not.toContain('B0RUGNOISE');
  });

  it('reuses a fresh Product Database cache instead of a second paid call', async () => {
    const candidateId = await seedCandidate('sink drip tray', ['sink drip tray']);
    const budget = new PostgresApiBudget(
      client,
      { dailyLimit: 20, reservedLimit: 5 },
      `m3-cache-${candidateId}`
    );
    let calls = 0;
    const query = async () => {
      calls += 1;
      return { page: sinkPage, httpAttempts: 1, status: 200 };
    };
    await runMarketProbe({ candidateId, locale: 'en' }, { client, budget, queryProductDatabase: query });
    await runMarketProbe({ candidateId, locale: 'en' }, { client, budget, queryProductDatabase: query });
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database');
    expect(calls).toBe(1);
    expect(usage).toHaveLength(1);
  });

  it('defers exhausted normal budget without losing the candidate', async () => {
    const candidateId = await seedCandidate('sink drip tray', ['sink drip tray']);
    let calls = 0;
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 3, used: 2, reserve: 1 }),
        queryProductDatabase: async () => {
          calls += 1;
          return { page: sinkPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    const { data: candidate } = await client
      .from('candidates')
      .select('state')
      .eq('id', candidateId)
      .single();
    expect(calls).toBe(0);
    expect(candidate?.state).toBe('Waiting for API Budget');
  });
});
