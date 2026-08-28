import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import { MemoryApiBudget } from '@ara/api-budget';
import {
  ProductDatabasePageSchema,
  type ProductDatabasePage
} from '@ara/jungle-scout';
import {
  type AiProvider,
  type AiProviderResult,
  type ProviderHealth,
  type StructuredAiRequest
} from '@ara/ai-router';
import { AiUsageSchema, type AiModelDescriptor } from '@ara/shared';
import { createQueue } from '@ara/queue';
import { createJobHandlers } from '../handlers';
import { runJob } from '../main';
import { runImportJob } from './import-opportunity-csv';
import { runNormalizeJob } from './normalize-opportunities';
import { runMarketProbe } from './market-probe';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;
const root = dirname(fileURLToPath(import.meta.url));
const jsFixtures = join(root, '../../../../tests/fixtures/jungle-scout');
const ofCsv = join(root, '../../../../tests/fixtures/opportunity-finder/page-1.csv');

const healthy: ProviderHealth = {
  available: true,
  checkedAt: new Date(0).toISOString(),
  reason: null,
  retryAfterSeconds: null
};

class FakeNormalizationProvider implements AiProvider {
  readonly id = `fake-normalizer-${randomUUID()}`;
  readonly billingType = 'free' as const;

  async health(): Promise<ProviderHealth> {
    return healthy;
  }

  async listModels(): Promise<readonly AiModelDescriptor[]> {
    return [];
  }

  async runStructured<T>(request: StructuredAiRequest<T>): Promise<AiProviderResult<T>> {
    const output = {
      classification: 'product_niche',
      canonicalNiche: 'Batter / Pancake Dispenser',
      canonicalEnglish: 'Batter / Pancake Dispenser',
      catalogPhrases: ['pancake dispenser', 'batter dispenser bottle'],
      aliases: ['pancake dispenser bottle'],
      productFit: 'strong',
      riskFlags: [],
      confidence: 0.94,
      reason: 'Equivalent product phrases describe one dispensing niche.'
    };
    return {
      output: request.schema.parse(output),
      providerId: this.id,
      modelId: request.modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage: AiUsageSchema.parse({
        inputTokens: 20,
        outputTokens: 30,
        totalTokens: 50,
        requestCount: 1
      }),
      costClass: this.billingType,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString()
    };
  }
}

function loadPage(name: string): ProductDatabasePage {
  return ProductDatabasePageSchema.parse(JSON.parse(readFileSync(join(jsFixtures, name), 'utf8')));
}

const sinkPage = loadPage('product-database-sink.json');
const sinkZero = loadPage('product-database-sink-zero.json');
const batter = loadPage('product-database-batter-dispenser.json');
const expandedMeta = JSON.parse(
  readFileSync(join(jsFixtures, 'product-database-sink-expanded-meta.json'), 'utf8')
) as { meta: { result_count: number } };
const recordedExpandedCount = expandedMeta.meta.result_count;
const expandedSink: ProductDatabasePage = {
  ...sinkPage,
  meta: { result_count: recordedExpandedCount }
};

function database() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

integration('Milestone 3 Task 12 pipeline gate', () => {
  const client = database();
  const importRuns: string[] = [];
  const clusterIds: string[] = [];

  afterEach(async () => {
    await client.from('jobs').delete().like('idempotency_key', 'market-probe-resume:%');
    await client.from('jobs').delete().like('idempotency_key', 'deep-validation:%');
    for (const importRunId of importRuns.splice(0)) {
      await client.from('import_runs').delete().eq('id', importRunId);
    }
    for (const clusterId of clusterIds.splice(0)) {
      await client.from('product_families').delete().eq('niche_cluster_id', clusterId);
      await client.from('niche_clusters').delete().eq('id', clusterId);
    }
  });

  async function seedCandidate(
    keyword: string,
    phrases: readonly string[],
    aliases: readonly string[] = []
  ): Promise<string> {
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
      catalog_phrases: [...phrases],
      aliases: [...aliases]
    });
    if (clusterError) throw clusterError;
    const { error: importError } = await client.from('import_runs').insert({
      id: importRunId,
      submission_hash: `m3p-${importRunId}`,
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
      source_hash: `m3p-${importRunId}`,
      source_row_number: 1,
      row_hash: `m3p-row-${importRunId}`,
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

  it('imports Opportunity Finder page-1.csv then probes the batter-dispenser cluster', async () => {
    const { data: run, error: runError } = await client
      .from('import_runs')
      .insert({
        status: 'queued',
        locale: 'en',
        submission_hash: `of-${randomUUID()}`,
        file_count: 1,
        source_files: [{ name: 'page-1.csv' }]
      })
      .select('id')
      .single();
    if (runError || !run) throw runError ?? new Error('import run missing');
    importRuns.push(run.id);
    await runImportJob(
      {
        importRunId: run.id,
        files: [{ sourceFileName: 'page-1.csv', content: readFileSync(ofCsv, 'utf8') }]
      },
      { client }
    );
    const { data: imported } = await client
      .from('candidates')
      .select('id,keyword')
      .eq('import_run_id', run.id)
      .eq('keyword', 'pancake dispenser bottle');
    expect(imported?.length).toBeGreaterThan(0);
    const candidateIds = (imported ?? []).map((row) => row.id);
    const pancake = candidateIds[0];
    const provider = new FakeNormalizationProvider();
    const { error: providerError } = await client.from('ai_providers').insert({
      id: provider.id,
      name: provider.id,
      kind: 'command',
      billing_type: 'free',
      enabled: true,
      config: {}
    });
    if (providerError) throw providerError;
    await client
      .from('candidates')
      .update({ state: 'AI Screening', eligible_for_ai_normalization: true })
      .in('id', candidateIds);
    await runNormalizeJob(
      { candidateIds, locale: 'en' },
      {
        client,
        provider,
        modelId: 'fake-normalizer',
        workerId: `m3-${run.id}`,
        promptVersion: `m3-${run.id}`
      }
    );
    if (!pancake) throw new Error('pancake candidate missing');
    await runMarketProbe(
      { candidateId: pancake, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async () => ({ page: batter, httpAttempts: 1, status: 200 })
      }
    );
    const { data: relevant } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', pancake)
      .eq('kind', 'relevant_asins')
      .maybeSingle();
    const asins =
      relevant?.payload && typeof relevant.payload === 'object' && 'asins' in relevant.payload
        ? (relevant.payload as { asins: string[] }).asins
        : [];
    expect(asins).toContain('B0BATTER1');
    expect(asins).not.toContain('B0RUGNOISE');
  });

  it('expands a literal sink zero page into recorded 329 coverage and family segments', async () => {
    const candidateId = await seedCandidate('sink drip tray', ['sink drip tray'], [
      'sink mat',
      'faucet mat',
      'sink splash guard'
    ]);
    const queries: string[][] = [];
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: new MemoryApiBudget({ dailyLimit: 20, used: 0, reserve: 5 }),
        queryProductDatabase: async (phrases) => {
          queries.push([...phrases]);
          if (phrases.length === 1 && phrases[0] === 'sink drip tray') {
            return { page: sinkZero, httpAttempts: 1, status: 200 };
          }
          return { page: expandedSink, httpAttempts: 1, status: 200 };
        }
      }
    );
    const { data: coverage } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'product_database_coverage')
      .maybeSingle();
    const { data: niches } = await client
      .from('candidate_evidence')
      .select('payload')
      .eq('candidate_id', candidateId)
      .eq('kind', 'micro_niches')
      .maybeSingle();
    const { data: snapshot } = await client
      .from('market_snapshots')
      .select('observed_sample_sales,estimated_market_sales,sample_product_family_count')
      .eq('candidate_id', candidateId)
      .maybeSingle();
    const { data: probed } = await client
      .from('candidates')
      .select('niche_cluster_id')
      .eq('id', candidateId)
      .single();
    const { data: families } = await client
      .from('product_families')
      .select('parent_key,variant_count')
      .eq('niche_cluster_id', probed?.niche_cluster_id ?? '');
    expect(queries[0]).toEqual(['sink drip tray']);
    expect(queries[0]?.some((phrase) => /[0-9a-f]{8}-[0-9a-f]{4}-/u.test(phrase))).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toEqual([
      'sink drip tray',
      'sink mat',
      'faucet mat',
      'sink splash guard'
    ]);
    expect(coverage?.payload).toMatchObject({ result_count: recordedExpandedCount });
    expect(families).toHaveLength(2);
    expect(families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent_key: 'B0SINKPARENT', variant_count: 1 }),
        expect.objectContaining({ parent_key: 'B0MISSING1', variant_count: 1 })
      ])
    );
    expect(niches?.payload).toEqual([
      {
        name: 'Silicone Faucet Mat / Sink Splash Guard',
        priceSegments: [{ label: 'all', minPrice: 12.99, maxPrice: 12.99, familyCount: 1 }]
      },
      {
        name: 'sink drip tray',
        priceSegments: []
      }
    ]);
    expect(snapshot?.observed_sample_sales).toBe(3855);
    expect(snapshot?.estimated_market_sales).toBeNull();
    expect(snapshot?.sample_product_family_count).toBe(2);
  });

  it('allows two normal probes and one manual reserve call at dailyLimit 3 / reserve 1', async () => {
    const budget = new MemoryApiBudget({ dailyLimit: 3, used: 0, reserve: 1 });
    const outcomes: Array<{ purpose: 'normal_validation' | 'manual_research'; calls: number; state: string }> =
      [];
    for (let index = 0; index < 4; index += 1) {
      const candidateId = await seedCandidate(`normal ${index}`, [`normal ${index}`]);
      let calls = 0;
      await runMarketProbe(
        { candidateId, locale: 'en' },
        {
          client,
          budget,
          purpose: 'normal_validation',
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
      outcomes.push({
        purpose: 'normal_validation',
        calls,
        state: String(candidate?.state)
      });
    }
    const manualId = await seedCandidate('manual research', ['manual research']);
    let manualCalls = 0;
    await runMarketProbe(
      { candidateId: manualId, locale: 'en' },
      {
        client,
        budget,
        purpose: 'manual_research',
        queryProductDatabase: async () => {
          manualCalls += 1;
          return { page: sinkPage, httpAttempts: 1, status: 200 };
        }
      }
    );
    const normalCalls = outcomes.filter((row) => row.calls > 0);
    const deferred = outcomes.filter((row) => row.state === 'Waiting for API Budget');
    expect(normalCalls).toHaveLength(2);
    expect(deferred).toHaveLength(2);
    expect(manualCalls).toBe(1);
  });

  it('resumes a deferred Market Probe from the durable queued job', async () => {
    const candidateId = await seedCandidate('sink drip tray', ['sink drip tray']);
    const queue = createQueue(client);
    const workerId = `m3-resume-${candidateId}`;
    let calls = 0;
    const exhausted = new MemoryApiBudget({ dailyLimit: 3, used: 2, reserve: 1 });
    await runMarketProbe(
      { candidateId, locale: 'en' },
      {
        client,
        budget: exhausted,
        queryProductDatabase: async () => {
          calls += 1;
          return { page: sinkPage, httpAttempts: 1, status: 200 };
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
    const { data: jobs } = await client
      .from('jobs')
      .select('id,payload,idempotency_key,available_at,status')
      .like('idempotency_key', `market-probe-resume:${candidateId}:%`);
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]?.status).toBe('queued');
    expect(jobs?.[0]?.payload).toMatchObject({ candidateId, locale: 'en' });
    expect(jobs?.[0]?.available_at && Date.parse(jobs[0].available_at) > Date.now()).toBe(true);
    expect(calls).toBe(0);
    const early = await queue.claimJobs(workerId, 8, 60);
    expect(early.some((job) => job.id === jobs?.[0]?.id)).toBe(false);
    await client
      .from('jobs')
      .update({ available_at: new Date().toISOString() })
      .eq('id', jobs?.[0]?.id ?? '');
    const claimed = await queue.claimJobs(workerId, 8, 60);
    const resumeJob = claimed.find((job) => job.id === jobs?.[0]?.id);
    if (!resumeJob) {
      throw new Error('Production claim did not return the persisted MARKET_PROBE resume job.');
    }
    const handlers = createJobHandlers(client, {
      apiBudget: new MemoryApiBudget({ dailyLimit: 3, used: 0, reserve: 1 }),
      queryProductDatabase: async () => {
        calls += 1;
        return { page: sinkPage, httpAttempts: 1, status: 200 };
      }
    });
    await runJob(resumeJob, {
      queue,
      handlers,
      workerId,
      signal: AbortSignal.timeout(30_000),
      heartbeatIntervalMs: 60_000
    });
    const { data: candidate } = await client
      .from('candidates')
      .select('id,state')
      .eq('id', candidateId)
      .single();
    const { data: usage } = await client
      .from('api_usage')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('endpoint', 'product_database');
    const { data: evidence } = await client
      .from('candidate_evidence')
      .select('id')
      .eq('candidate_id', candidateId);
    const { data: finished } = await client
      .from('jobs')
      .select('status')
      .eq('id', jobs?.[0]?.id ?? '')
      .maybeSingle();
    expect(calls).toBe(1);
    expect(usage).toHaveLength(1);
    expect(candidate?.id).toBe(candidateId);
    expect(candidate?.state).not.toBe('Waiting for API Budget');
    expect((evidence ?? []).length).toBeGreaterThan(0);
    expect(finished?.status).toBe('completed');
  });
});
