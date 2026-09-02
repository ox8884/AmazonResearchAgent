import { randomUUID } from 'node:crypto';
import {
  createProviderAttemptRepository,
  createServerDatabaseClient
} from '@ara/db';
import { createQueue, type Job } from '@ara/queue';
import type { AiProvider, AiProviderResult, ProviderCatalog } from '@ara/ai-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { KeywordNormalization } from '@ara/research-engine';
import { AdapterSemaphoreRegistry } from '../providers/adapter-semaphore';
import {
  NormalizationExecutionCoordinator,
  type NormalizationExecutionTarget
} from '../providers/normalization-execution-coordinator';
import { runNormalizeJob } from './normalize-opportunities';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

function databaseClient() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

const usage = {
  inputTokens: 20,
  outputTokens: 30,
  totalTokens: 50,
  requestCount: 1
};

function catalog(providerId: string, modelId: string): ProviderCatalog {
  const provider: AiProvider = {
    id: providerId,
    billingType: 'subscription',
    async health() {
      return { available: true, checkedAt: new Date(0).toISOString(), reason: null, retryAfterSeconds: null };
    },
    async listModels() { return []; },
    async runStructured() { throw new Error('Coordinator target must own execution.'); }
  };
  return {
    entries: [{
      provider,
      enabled: true,
      priority: 1,
      roles: ['niche_normalization'],
      health: { available: true, checkedAt: new Date(0).toISOString(), reason: null, retryAfterSeconds: null },
      models: [{
        providerId,
        id: modelId,
        displayName: modelId,
        capabilities: ['structured_json'],
        billingType: 'subscription',
        qualityRank: 1
      }]
    }]
  };
}

async function seedExecution(
  client: ReturnType<typeof databaseClient>,
  output: KeywordNormalization,
  executeOverride?: NormalizationExecutionTarget['execute']
): Promise<{
  readonly candidateId: string;
  readonly importRunId: string;
  readonly providerId: string;
  readonly job: Job;
  readonly catalog: ProviderCatalog;
  readonly coordinator: NormalizationExecutionCoordinator;
  readonly calls: { count: number };
}> {
  const suffix = randomUUID();
  const providerId = `http-normalizer-${suffix}`;
  const modelId = `model-${suffix}`;
  const fingerprint = `fingerprint-${suffix}`;
  const importRunId = randomUUID();
  const rawId = randomUUID();
  const candidateId = randomUUID();
  const calls = { count: 0 };
  const { error: providerError } = await client.from('ai_providers').insert({
    id: providerId,
    name: providerId,
    kind: 'openai_http',
    billing_type: 'subscription',
    enabled: true,
    config: { executionIdentity: fingerprint },
    settings_revision: 1
  });
  if (providerError) throw providerError;
  const { error: modelError } = await client.from('ai_models').insert({
    provider_id: providerId,
    model_id: modelId,
    display_name: modelId,
    capabilities: ['structured_json'],
    billing_type: 'subscription',
    enabled: true,
    quality_rank: 1,
    priority: 1
  });
  if (modelError) throw modelError;
  const { error: importError } = await client.from('import_runs').insert({
    id: importRunId,
    submission_hash: `normalize-it-${suffix}`,
    file_count: 1,
    total_row_count: 1,
    unique_keyword_count: 1,
    source_files: []
  });
  if (importError) throw importError;
  const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
    id: rawId,
    import_run_id: importRunId,
    source_file_name: 'normalize-fixture.csv',
    source_hash: suffix,
    source_row_number: 1,
    row_hash: `row-${suffix}`,
    raw_row_text: 'batter dispenser',
    raw_row: { Keyword: 'batter dispenser' },
    parsed_row: { keyword: 'batter dispenser' },
    keyword: 'batter dispenser',
    normalized_exact_keyword: `batter dispenser ${suffix}`,
    is_exact_duplicate: false
  });
  if (rawError) throw rawError;
  const { error: candidateError } = await client.from('candidates').insert({
    id: candidateId,
    import_run_id: importRunId,
    representative_raw_keyword_id: rawId,
    keyword: 'batter dispenser',
    normalized_exact_keyword: `batter dispenser ${suffix}`,
    state: 'AI Screening',
    rule_passed: true,
    rule_reasons: [{ code: 'RULE_PASS', detail: 'rule accepted' }],
    risk_flags: [],
    preliminary_score: 80,
    preliminary_score_components: {},
    eligible_for_ai_normalization: true
  });
  if (candidateError) throw candidateError;
  const queue = createQueue(client);
  await queue.enqueueJob({
    type: 'NORMALIZE_OPPORTUNITIES',
    payload: { candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 },
    idempotencyKey: `normalize:${candidateId}:0`
  });
  const jobs = await queue.claimJobs(`worker-${suffix}`, 100, 120);
  const job = jobs.find((candidate) => candidate.idempotencyKey === `normalize:${candidateId}:0`);
  if (!job) throw new Error('Normalization fixture job was not claimed.');
  const selectedCatalog = catalog(providerId, modelId);
  const execute: NormalizationExecutionTarget['execute'] = executeOverride ?? (async (_attemptId, request) => {
    calls.count += 1;
    return {
      output: request.schema.parse(output),
      providerId,
      modelId,
      role: request.role,
      inputHash: request.inputHash,
      usage,
      costClass: 'subscription',
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString()
    } satisfies AiProviderResult<KeywordNormalization>;
  });
  const coordinator = new NormalizationExecutionCoordinator({
    attempts: createProviderAttemptRepository(client),
    runtime: {
      async applyFailure() {
        return { mutated: false, allow_fallback: false, allow_replay: false };
      }
    },
    semaphores: new AdapterSemaphoreRegistry(),
    resolveTarget: async (selection) => ({
      providerId: selection.providerId,
      modelId: selection.model.id,
      adapter: null,
      expectedSettingsRevision: 1,
      expectedAuthGeneration: 0,
      expectedExecutionFingerprint: fingerprint,
      execute
    })
  });
  return { candidateId, importRunId, providerId, job, catalog: selectedCatalog, coordinator, calls };
}

integration('opportunity normalization job', () => {
  const client = databaseClient();
  const importRuns: string[] = [];
  const providers: string[] = [];

  afterEach(async () => {
    importRuns.length = 0;
    providers.length = 0;
  });

  // Break: success bypasses attempt authority or writes only part of the candidate domain.
  it('commits one durable winner and all candidate-domain rows atomically', async () => {
    const fixture = await seedExecution(client, {
      classification: 'product_niche',
      canonicalNiche: 'Batter / Pancake Dispenser',
      canonicalEnglish: 'Batter / Pancake Dispenser',
      catalogPhrases: ['pancake dispenser'],
      aliases: ['batter bottle'],
      productFit: 'strong',
      riskFlags: ['food_contact'],
      confidence: 0.91,
      reason: 'A distinct kitchen product niche.'
    });
    importRuns.push(fixture.importRunId);
    providers.push(fixture.providerId);
    const dependencies = {
      client,
      coordinator: fixture.coordinator,
      catalog: fixture.catalog,
      jobLease: fixture.job.leaseIdentity,
      signal: new AbortController().signal,
      workerId: `analysis-${fixture.job.id}`
    };
    const first = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      dependencies
    );
    const repeat = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      dependencies
    );
    const { data: candidate } = await client.from('candidates')
      .select('state,niche_cluster_id').eq('id', fixture.candidateId).single();
    const { data: attempts } = await client.from('provider_attempt_events')
      .select('event_type').eq('job_id', fixture.job.id);
    const { data: decisions } = await client.from('decision_history')
      .select('id').eq('candidate_id', fixture.candidateId);
    expect(first.clusteredCount).toBe(1);
    expect(repeat.reusedAnalysisCount).toBe(1);
    expect(fixture.calls.count).toBe(1);
    expect(candidate?.state).toBe('Ready for API Validation');
    expect(candidate?.niche_cluster_id).toBeTruthy();
    expect(attempts?.map((event) => event.event_type).sort()).toEqual([
      'attempt_started', 'attempt_succeeded'
    ]);
    expect(decisions).toHaveLength(1);
  });

  // Break: an exhausted provider leaves an unowned candidate in AI Screening or attributes a fake winner.
  it('defers through the no-winner authority after an exhausted HTTP provider', async () => {
    const fixture = await seedExecution(client, {
      classification: 'ambiguous', canonicalNiche: null, canonicalEnglish: null,
      catalogPhrases: [], aliases: [], productFit: 'possible', riskFlags: [],
      confidence: 0.4, reason: 'unused'
    }, async () => {
      throw Object.assign(new Error('capacity'), { failureClass: 'capacity_exhausted' as const });
    });
    const result = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      {
        client,
        coordinator: fixture.coordinator,
        catalog: fixture.catalog,
        jobLease: fixture.job.leaseIdentity,
        signal: new AbortController().signal
      }
    );
    const { data: candidate } = await client.from('candidates')
      .select('state,niche_cluster_id').eq('id', fixture.candidateId).single();
    const { data: analysis } = await client.from('ai_analyses')
      .select('winning_attempt_id').eq('input_payload->>candidateId', fixture.candidateId).single();
    if (!analysis) throw new Error('Deferred analysis was not stored.');
    expect(result.deferredCount).toBe(1);
    expect(candidate).toEqual({ state: 'Waiting for AI Capacity', niche_cluster_id: null });
    expect(analysis.winning_attempt_id).toBeNull();
  });

  // Break: no routable provider leaves a valid candidate in AI Screening.
  it('defers when routing has no eligible provider before an attempt starts', async () => {
    const fixture = await seedExecution(client, {
      classification: 'ambiguous', canonicalNiche: null, canonicalEnglish: null,
      catalogPhrases: [], aliases: [], productFit: 'possible', riskFlags: [],
      confidence: 0.4, reason: 'unused'
    });

    const result = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      {
        client,
        coordinator: fixture.coordinator,
        catalog: { entries: [] },
        jobLease: fixture.job.leaseIdentity,
        signal: new AbortController().signal
      }
    );
    const { data: candidate, error } = await client.from('candidates')
      .select('state').eq('id', fixture.candidateId).single();
    if (error) throw error;

    expect(result.deferredCount).toBe(1);
    expect(candidate.state).toBe('Waiting for AI Capacity');
  });

  // Break: a stale generation payload claims or finalizes the current candidate analysis.
  it('rejects a payload generation mismatch before analysis claim', async () => {
    const fixture = await seedExecution(client, {
      classification: 'ambiguous', canonicalNiche: null, canonicalEnglish: null,
      catalogPhrases: [], aliases: [], productFit: 'possible', riskFlags: [],
      confidence: 0.4, reason: 'unused'
    });
    await expect(runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 1 },
      {
        client,
        coordinator: fixture.coordinator,
        catalog: fixture.catalog,
        jobLease: fixture.job.leaseIdentity,
        signal: new AbortController().signal
      }
    )).rejects.toThrow(/generation does not match/u);
    const { count, error } = await client
      .from('ai_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('input_payload->>candidateId', fixture.candidateId);
    if (error) throw error;
    expect(count).toBe(0);
  });

  it('completes a stale candidate-state job without claiming an analysis', async () => {
    const fixture = await seedExecution(client, {
      classification: 'ambiguous', canonicalNiche: null, canonicalEnglish: null,
      catalogPhrases: [], aliases: [], productFit: 'possible', riskFlags: [],
      confidence: 0.4, reason: 'unused'
    });
    const { error: stateError } = await client.from('candidates')
      .update({ state: 'Ready for API Validation' })
      .eq('id', fixture.candidateId);
    if (stateError) throw stateError;

    const result = await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      {
        client,
        coordinator: fixture.coordinator,
        catalog: fixture.catalog,
        jobLease: fixture.job.leaseIdentity,
        signal: new AbortController().signal
      }
    );

    expect(result).toMatchObject({
      processedCount: 1,
      clusteredCount: 0,
      deferredCount: 0,
      reusedAnalysisCount: 0
    });
    expect(fixture.calls.count).toBe(0);
    const { count, error } = await client
      .from('ai_analyses')
      .select('id', { count: 'exact', head: true })
      .eq('input_payload->>candidateId', fixture.candidateId);
    if (error) throw error;
    expect(count).toBe(0);
  });

  // Break: canonical finalization fabricates a non-null English name.
  it('preserves nullable canonical English through authority-owned cluster mutation', async () => {
    const fixture = await seedExecution(client, {
      classification: 'product_niche',
      canonicalNiche: `Nullable English ${randomUUID()}`,
      canonicalEnglish: null,
      catalogPhrases: ['nullable english niche'],
      aliases: ['nullable niche'],
      productFit: 'strong',
      riskFlags: [],
      confidence: 0.95,
      reason: 'Valid niche without an English translation.'
    });
    await runNormalizeJob(
      { candidateIds: [fixture.candidateId], locale: 'ko', normalizationGeneration: 0 },
      {
        client,
        coordinator: fixture.coordinator,
        catalog: fixture.catalog,
        jobLease: fixture.job.leaseIdentity,
        signal: new AbortController().signal
      }
    );
    const { data: candidate } = await client.from('candidates')
      .select('niche_cluster_id').eq('id', fixture.candidateId).single();
    if (!candidate?.niche_cluster_id) throw new Error('Candidate cluster was not committed.');
    const { data: cluster } = await client.from('niche_clusters')
      .select('canonical_english').eq('id', candidate.niche_cluster_id ?? '').single();
    if (!cluster) throw new Error('Candidate cluster was not found.');
    expect(cluster.canonical_english).toBeNull();
  });
});
