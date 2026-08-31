import { randomUUID } from 'node:crypto';
import {
  createProviderAttemptRepository,
  createProviderRuntimeRepository,
  createServerDatabaseClient
} from '@ara/db';
import { createQueue, type QueueDatabaseClient } from '@ara/queue';
import type { AiProvider, AiProviderResult, ProviderCatalog } from '@ara/ai-router';
import type { KeywordNormalization } from '@ara/research-engine';
import type { SubscriptionAdapter } from '@ara/shared';
import { describe, expect, it } from 'vitest';
import { AdapterSemaphoreRegistry } from './adapter-semaphore';
import {
  NormalizationExecutionCoordinator,
  type NormalizationExecutionTarget
} from './normalization-execution-coordinator';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;


type ReadyProvider = {
  readonly providerId: string;
  readonly modelId: string;
  readonly adapter: SubscriptionAdapter;
  readonly fingerprint: string;
};

type ExecutionProvider = {
  readonly providerId: string;
  readonly modelId: string;
  readonly fingerprint: string;
};

async function seedHttpProvider(client: QueueDatabaseClient): Promise<ExecutionProvider> {
  const suffix = randomUUID();
  const providerId = `http-integration-${suffix}`;
  const modelId = `http-model-${suffix}`;
  const fingerprint = `http-fingerprint-${suffix}`;
  const { error: providerError } = await client.from('ai_providers').insert({
    id: providerId,
    name: providerId,
    kind: 'openai_http',
    adapter: null,
    billing_type: 'free',
    enabled: true,
    priority: 0,
    config: {
      baseUrl: 'https://provider.example/v1',
      networkScope: 'public',
      roles: ['niche_normalization'],
      executionIdentity: fingerprint
    },
    settings_revision: 1
  });
  if (providerError) throw providerError;
  const { error: modelError } = await client.from('ai_models').insert({
    provider_id: providerId,
    model_id: modelId,
    display_name: modelId,
    capabilities: ['structured_json'],
    billing_type: 'free',
    enabled: true,
    priority: 0
  });
  if (modelError) throw modelError;
  return { providerId, modelId, fingerprint };
}

const normalizationOutput: KeywordNormalization = {
  classification: 'product_niche',
  canonicalNiche: 'Batter / Pancake Dispenser',
  canonicalEnglish: 'Batter / Pancake Dispenser',
  catalogPhrases: ['pancake dispenser'],
  aliases: ['batter bottle'],
  productFit: 'strong',
  riskFlags: ['food_contact'],
  confidence: 0.91,
  reason: 'A distinct kitchen product niche.'
};

function databaseClient() {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

async function seedReadyProvider(
  client: QueueDatabaseClient,
  adapter: SubscriptionAdapter
): Promise<ReadyProvider> {
  const providerId = `${adapter}-restart-integration`;
  const modelId = `${adapter}-model-restart-integration`;
  const fingerprint = `${adapter}-fingerprint-restart-integration`;
  const { data: existing, error: existingError } = await client.from('ai_providers')
    .select('id')
    .eq('id', providerId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { providerId, modelId, adapter, fingerprint };

  const securityProfileDigest = adapter === 'codex' ? 'c'.repeat(64) : '9'.repeat(64);
  const termsDigest = `terms-${adapter}-restart-integration`;
  const credentialSourceDigest = `credential-${adapter}-restart-integration`;
  const binaryIdentityDigest = `binary-${adapter}-restart-integration`;
  const capabilityDigest = `capability-${adapter}-restart-integration`;
  const framingDigest = `framing-${adapter}-restart-integration`;
  const boundedBehaviorDigest = `bounded-${adapter}-restart-integration`;
  const containmentDigest = `containment-${adapter}-restart-integration`;
  const { error: providerError } = await client.from('ai_providers').insert({
    id: providerId,
    name: providerId,
    kind: 'subscription_command',
    adapter,
    billing_type: 'subscription',
    enabled: false,
    config: {},
    settings_revision: 1
  });
  if (providerError) throw providerError;
  const { error: modelError } = await client.from('ai_models').insert({
    provider_id: providerId,
    model_id: modelId,
    display_name: modelId,
    capabilities: ['structured_json'],
    billing_type: 'subscription',
    enabled: false
  });
  if (modelError) throw modelError;

  const runtime = createProviderRuntimeRepository(client);
  const bindings = {
    providerId,
    modelId,
    expectedSettingsRevision: 1,
    expectedAuthGeneration: 0,
    expectedExecutionFingerprint: fingerprint
  };
  await runtime.commitAcceptanceProbe({
    ...bindings,
    adapter,
    securityProfileVersion: 'subscription-isolation-v1',
    securityProfileDigest,
    readinessPolicyVersion: 'ready-lease-v1',
    termsDigest,
    credentialSourceDigest,
    binaryIdentityDigest,
    capabilityDigest,
    framingDigest,
    boundedBehaviorDigest,
    containmentDigest,
    evidence: { verified: true }
  });
  const probe = await runtime.activate({ ...bindings, termsDigest });
  await runtime.commitProbe({
    ...bindings,
    expectedProbeGeneration: probe.probe_generation,
    securityProfileDigest,
    termsDigest,
    credentialSourceDigest,
    binaryIdentityDigest,
    capabilityDigest,
    framingDigest,
    boundedBehaviorDigest,
    containmentDigest
  });
  const { error: probeJobError } = await client.from('jobs')
    .update({ status: 'completed' })
    .eq('id', probe.job_id);
  if (probeJobError) throw probeJobError;
  return { providerId, modelId, adapter, fingerprint };
}

function executionCatalog(
  providers: readonly {
    readonly providerId: string;
    readonly modelId: string;
    readonly billingType: 'free' | 'subscription' | 'payg';
    readonly priority: number;
  }[]
): ProviderCatalog {
  return {
    entries: providers.map(({ providerId, modelId, billingType, priority }) => {
      const provider: AiProvider = {
        id: providerId,
        billingType,
        async health() {
          return {
            available: true,
            checkedAt: new Date(0).toISOString(),
            reason: null,
            retryAfterSeconds: null
          };
        },
        async listModels() { return []; },
        async runStructured() {
          throw new Error('Coordinator target must own execution.');
        }
      };
      return {
        provider,
        enabled: true,
        priority,
        roles: ['niche_normalization'],
        health: {
          available: true,
          checkedAt: new Date(0).toISOString(),
          reason: null,
          retryAfterSeconds: null
        },
        models: [{
          providerId,
          id: modelId,
          displayName: modelId,
          capabilities: ['structured_json'],
          billingType,
          qualityRank: priority
        }]
      };
    })
  };
}

function catalog(
  codex: ReadyProvider,
  grok: ReadyProvider,
  paygProviderId: string
): ProviderCatalog {
  return executionCatalog([
    { ...codex, billingType: 'subscription', priority: 0 },
    { ...grok, billingType: 'subscription', priority: 1 },
    {
      providerId: paygProviderId,
      modelId: `${paygProviderId}-model`,
      billingType: 'payg',
      priority: 0
    }
  ]);
}

async function seedExecution(client: QueueDatabaseClient, selected: ExecutionProvider) {
  const suffix = randomUUID();
  const importRunId = randomUUID();
  const rawId = randomUUID();
  const candidateId = randomUUID();
  const { error: importError } = await client.from('import_runs').insert({
    id: importRunId,
    submission_hash: `restart-${suffix}`,
    file_count: 1,
    total_row_count: 1,
    unique_keyword_count: 1,
    source_files: []
  });
  if (importError) throw importError;
  const { error: rawError } = await client.from('raw_opportunity_keywords').insert({
    id: rawId,
    import_run_id: importRunId,
    source_file_name: 'restart-fixture.csv',
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
    eligible_for_ai_normalization: true,
    normalization_generation: 0
  });
  if (candidateError) throw candidateError;

  const queue = createQueue(client);
  await queue.enqueueJob({
    type: 'NORMALIZE_OPPORTUNITIES',
    payload: { candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 },
    idempotencyKey: `normalize:${candidateId}:0`
  });
  const jobOwner = `restart-job-${suffix}`;
  const jobs = await queue.claimJobs(jobOwner, 100, 120);
  const job = jobs.find((candidate) => candidate.idempotencyKey === `normalize:${candidateId}:0`);
  if (!job) throw new Error('Restart fixture job was not claimed.');

  const analysisOwner = `restart-analysis-${suffix}`;
  const inputHash = `restart-input-${suffix}`;
  const { data: claims, error: claimError } = await client.rpc('claim_ai_analysis', {
    analysis_role: 'niche_normalization',
    analysis_input_hash: inputHash,
    worker_id: analysisOwner,
    lease_seconds: 120,
    provider_id: selected.providerId,
    model_id: selected.modelId,
    analysis_locale: 'ko',
    prompt_version: 'niche-normalization-v1',
    input_payload: {
      candidateId,
      normalizationGeneration: 0,
      keyword: 'batter dispenser',
      normalizedExactKeyword: `batter dispenser ${suffix}`
    }
  });
  if (claimError) throw claimError;
  const claim = claims?.[0];
  if (!claim || claim.claim_status !== 'claimed') {
    throw new Error('Restart fixture analysis was not claimed.');
  }
  return {
    candidateId,
    inputHash,
    jobLease: job.leaseIdentity,
    analysisLease: {
      analysisId: claim.analysis_id,
      owner: analysisOwner,
      epoch: claim.analysis_lease_epoch
    }
  };
}

integration('normalization coordinator authority cutover', () => {
  // Break: service_role keeps the temporary legacy cluster mutation capability after Task 10.
  it('denies the legacy cluster helper to service_role', async () => {
    const client = createServerDatabaseClient({
      url: supabaseUrl ?? '',
      serviceRoleKey: serviceRoleKey ?? ''
    });
    const { error } = await client.rpc('upsert_niche_cluster', {
      canonical_key: 'task-10-legacy-helper-must-fail',
      canonical_name: 'Task 10 Legacy Helper Must Fail',
      canonical_english: 'Task 10 Legacy Helper Must Fail',
      aliases: [],
      catalog_phrases: [],
      cluster_state: 'Ready for API Validation'
    });
    expect(error?.message).toMatch(/permission denied/u);
  });

  // Break: a restarted coordinator defers or replays Codex instead of using the DB-derived unknown parent.
  it('routes one distinct unpaid fallback after reconciling a crash-unknown attempt', async () => {
    const client = databaseClient();
    const codex = await seedReadyProvider(client, 'codex');
    const grok = await seedReadyProvider(client, 'grok');
    const fixture = await seedExecution(client, codex);
    const attempts = createProviderAttemptRepository(client);
    const first = await attempts.begin({
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      providerId: codex.providerId,
      modelId: codex.modelId,
      expectedSettingsRevision: 1,
      expectedAuthGeneration: 0,
      expectedExecutionFingerprint: codex.fingerprint,
      fallbackParentAttemptId: null
    });

    const calls = { codex: 0, grok: 0, payg: 0 };
    const paygProviderId = `payg-restart-${randomUUID()}`;
    const freshCoordinator = new NormalizationExecutionCoordinator({
      attempts: createProviderAttemptRepository(client),
      runtime: createProviderRuntimeRepository(client),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async (selection): Promise<NormalizationExecutionTarget> => {
        if (selection.providerId === codex.providerId) {
          calls.codex += 1;
          throw new Error('Codex must remain excluded after crash-unknown.');
        }
        if (selection.providerId === paygProviderId) {
          calls.payg += 1;
          throw new Error('PAYG must remain excluded by routing policy.');
        }
        if (selection.providerId !== grok.providerId) {
          throw new Error('Unexpected provider selection.');
        }
        return {
          providerId: grok.providerId,
          modelId: grok.modelId,
          adapter: grok.adapter,
          expectedSettingsRevision: 1,
          expectedAuthGeneration: 0,
          expectedExecutionFingerprint: grok.fingerprint,
          execute: async (_attemptId, request) => {
            calls.grok += 1;
            return {
              output: request.schema.parse(normalizationOutput),
              providerId: grok.providerId,
              modelId: grok.modelId,
              role: request.role,
              inputHash: request.inputHash,
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                requestCount: 1
              },
              costClass: 'subscription',
              startedAt: new Date(0).toISOString(),
              completedAt: new Date(1).toISOString()
            } satisfies AiProviderResult<KeywordNormalization>;
          }
        };
      }
    });

    await expect(freshCoordinator.execute({
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      candidateId: fixture.candidateId,
      expectedCandidateState: 'AI Screening',
      normalizationGeneration: 0,
      locale: 'ko',
      prompt: 'normalize this keyword',
      inputHash: fixture.inputHash,
      catalog: catalog(codex, grok, paygProviderId),
      signal: new AbortController().signal
    })).resolves.toEqual({
      kind: 'finalized',
      targetState: 'Ready for API Validation'
    });

    expect(calls).toEqual({ codex: 0, grok: 1, payg: 0 });
    const { data: events, error: eventsError } = await client
      .from('provider_attempt_events')
      .select('attempt_id,attempt_sequence,event_type,provider_id,fallback_parent_attempt_id,consumption_status,result_class,input_tokens,output_tokens,safe_metadata')
      .eq('logical_analysis_id', fixture.analysisLease.analysisId)
      .order('attempt_sequence')
      .order('created_at');
    if (eventsError) throw eventsError;
    expect(events).toHaveLength(4);
    expect(events?.map((event) => ({
      attemptId: event.attempt_id,
      sequence: event.attempt_sequence,
      eventType: event.event_type,
      providerId: event.provider_id,
      parent: event.fallback_parent_attempt_id,
      consumption: event.consumption_status,
      resultClass: event.result_class
    }))).toEqual([
      {
        attemptId: first.attemptId,
        sequence: 1,
        eventType: 'attempt_started',
        providerId: codex.providerId,
        parent: null,
        consumption: null,
        resultClass: null
      },
      {
        attemptId: first.attemptId,
        sequence: 1,
        eventType: 'attempt_unknown_after_crash',
        providerId: codex.providerId,
        parent: null,
        consumption: 'unknown',
        resultClass: 'worker_process_loss'
      },
      {
        attemptId: expect.any(String),
        sequence: 2,
        eventType: 'attempt_started',
        providerId: grok.providerId,
        parent: first.attemptId,
        consumption: null,
        resultClass: null
      },
      {
        attemptId: expect.any(String),
        sequence: 2,
        eventType: 'attempt_succeeded',
        providerId: grok.providerId,
        parent: first.attemptId,
        consumption: 'consumed',
        resultClass: 'success'
      }
    ]);
    const unknown = events?.find((event) => event.event_type === 'attempt_unknown_after_crash');
    expect(unknown).toMatchObject({
      consumption_status: 'unknown',
      input_tokens: null,
      output_tokens: null,
      safe_metadata: { reason: 'worker_process_loss' }
    });
    const winnerAttemptId = events?.find((event) => event.event_type === 'attempt_succeeded')?.attempt_id;
    const { data: analysis, error: analysisError } = await client.from('ai_analyses')
      .select('status,winning_attempt_id,provider_id,cost_class')
      .eq('id', fixture.analysisLease.analysisId)
      .single();
    if (analysisError) throw analysisError;
    expect(analysis).toEqual({
      status: 'completed',
      winning_attempt_id: winnerAttemptId,
      provider_id: grok.providerId,
      cost_class: 'subscription'
    });
    const { data: candidate, error: candidateError } = await client.from('candidates')
      .select('state,niche_cluster_id')
      .eq('id', fixture.candidateId)
      .single();
    if (candidateError) throw candidateError;
    expect(candidate?.state).toBe('Ready for API Validation');
    expect(candidate?.niche_cluster_id).toBeTruthy();
  });

  // Break: an HTTP failure is lost, replayed, or attributed as the winner instead of the Codex fallback.
  it('finalizes HTTP failure then Codex winner with immutable accounting', async () => {
    const client = databaseClient();
    const http = await seedHttpProvider(client);
    const codex = await seedReadyProvider(client, 'codex');
    const fixture = await seedExecution(client, http);
    const paygProviderId = `payg-http-fallback-${randomUUID()}`;
    const calls = { http: 0, codex: 0, payg: 0 };
    const coordinator = new NormalizationExecutionCoordinator({
      attempts: createProviderAttemptRepository(client),
      runtime: createProviderRuntimeRepository(client),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async (selection): Promise<NormalizationExecutionTarget> => {
        if (selection.providerId === http.providerId) {
          return {
            ...http,
            adapter: null,
            expectedSettingsRevision: 1,
            expectedAuthGeneration: 0,
            expectedExecutionFingerprint: http.fingerprint,
            execute: async () => {
              calls.http += 1;
              throw Object.assign(new Error('HTTP transient failure'), {
                failureClass: 'transient_network' as const
              });
            }
          };
        }
        if (selection.providerId === paygProviderId) {
          calls.payg += 1;
          throw new Error('PAYG must remain excluded.');
        }
        if (selection.providerId !== codex.providerId) {
          throw new Error('Unexpected provider selection.');
        }
        return {
          providerId: codex.providerId,
          modelId: codex.modelId,
          adapter: codex.adapter,
          expectedSettingsRevision: 1,
          expectedAuthGeneration: 0,
          expectedExecutionFingerprint: codex.fingerprint,
          execute: async (_attemptId, request) => {
            calls.codex += 1;
            return {
              output: request.schema.parse(normalizationOutput),
              providerId: codex.providerId,
              modelId: codex.modelId,
              role: request.role,
              inputHash: request.inputHash,
              usage: {
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                requestCount: 1
              },
              costClass: 'subscription',
              startedAt: new Date(0).toISOString(),
              completedAt: new Date(1).toISOString()
            } satisfies AiProviderResult<KeywordNormalization>;
          }
        };
      }
    });

    await expect(coordinator.execute({
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      candidateId: fixture.candidateId,
      expectedCandidateState: 'AI Screening',
      normalizationGeneration: 0,
      locale: 'ko',
      prompt: 'normalize this keyword',
      inputHash: fixture.inputHash,
      catalog: executionCatalog([
        { ...http, billingType: 'free', priority: 0 },
        { ...codex, billingType: 'subscription', priority: 1 },
        {
          providerId: paygProviderId,
          modelId: `${paygProviderId}-model`,
          billingType: 'payg',
          priority: 0
        }
      ]),
      signal: new AbortController().signal
    })).resolves.toEqual({
      kind: 'finalized',
      targetState: 'Ready for API Validation'
    });

    expect(calls).toEqual({ http: 1, codex: 1, payg: 0 });
    const { data: events, error: eventsError } = await client
      .from('provider_attempt_events')
      .select('attempt_id,attempt_sequence,event_type,provider_id,model_id,billing_type,fallback_parent_attempt_id,consumption_status,result_class')
      .eq('logical_analysis_id', fixture.analysisLease.analysisId)
      .order('attempt_sequence')
      .order('created_at');
    if (eventsError) throw eventsError;
    expect(events?.map((event) => ({
      sequence: event.attempt_sequence,
      eventType: event.event_type,
      providerId: event.provider_id,
      modelId: event.model_id,
      billingType: event.billing_type,
      parent: event.fallback_parent_attempt_id,
      consumption: event.consumption_status,
      resultClass: event.result_class
    }))).toEqual([
      {
        sequence: 1,
        eventType: 'attempt_started',
        providerId: http.providerId,
        modelId: http.modelId,
        billingType: 'free',
        parent: null,
        consumption: null,
        resultClass: null
      },
      {
        sequence: 1,
        eventType: 'attempt_failed',
        providerId: http.providerId,
        modelId: http.modelId,
        billingType: 'free',
        parent: null,
        consumption: 'unknown',
        resultClass: 'transient_network'
      },
      {
        sequence: 2,
        eventType: 'attempt_started',
        providerId: codex.providerId,
        modelId: codex.modelId,
        billingType: 'subscription',
        parent: events?.[0]?.attempt_id,
        consumption: null,
        resultClass: null
      },
      {
        sequence: 2,
        eventType: 'attempt_succeeded',
        providerId: codex.providerId,
        modelId: codex.modelId,
        billingType: 'subscription',
        parent: events?.[0]?.attempt_id,
        consumption: 'consumed',
        resultClass: 'success'
      }
    ]);
    const winnerAttemptId = events?.find((event) => event.event_type === 'attempt_succeeded')?.attempt_id;
    const { data: analysis, error: analysisError } = await client
      .from('ai_analyses')
      .select('status,winning_attempt_id,provider_id,model_id,cost_class,usage')
      .eq('id', fixture.analysisLease.analysisId)
      .single();
    if (analysisError) throw analysisError;
    expect(analysis).toEqual({
      status: 'completed',
      winning_attempt_id: winnerAttemptId,
      provider_id: codex.providerId,
      model_id: codex.modelId,
      cost_class: 'subscription',
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }
    });
    const { data: usageRows, error: usageError } = await client
      .from('ai_usage')
      .select('provider_id,model_id,cost_class,usage')
      .eq('analysis_id', fixture.analysisLease.analysisId);
    if (usageError) throw usageError;
    expect(usageRows).toEqual([{
      provider_id: codex.providerId,
      model_id: codex.modelId,
      cost_class: 'subscription',
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }
    }]);
  });

  // Break: restart replays a provider or finalizes domain values other than the durable staged output.
  it('reclaims a staged winner without provider replay or fake USD', async () => {
    const client = databaseClient();
    const codex = await seedReadyProvider(client, 'codex');
    const fixture = await seedExecution(client, codex);
    const http = await seedHttpProvider(client);
    const grok = await seedReadyProvider(client, 'grok');
    const stagedNormalizationOutput: KeywordNormalization = {
      classification: 'product_niche',
      canonicalNiche: 'Crash-Recovered Copper Batter Funnel 9137',
      canonicalEnglish: 'Crash-Recovered Copper Batter Funnel 9137 EN',
      catalogPhrases: ['durable batter funnel 9137'],
      aliases: ['staged copper funnel 9137'],
      productFit: 'strong',
      riskFlags: ['food_contact'],
      confidence: 0.97,
      reason: 'Durable staged winner 9137 supplied this exact decision.'
    };
    const attempts = createProviderAttemptRepository(client);
    const staged = await attempts.begin({
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      providerId: codex.providerId,
      modelId: codex.modelId,
      expectedSettingsRevision: 1,
      expectedAuthGeneration: 0,
      expectedExecutionFingerprint: codex.fingerprint,
      fallbackParentAttemptId: null
    });
    await attempts.appendOutcome({
      attemptId: staged.attemptId,
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      eventType: 'attempt_succeeded',
      consumptionStatus: 'consumed',
      resultClass: 'success',
      proofCategory: null,
      latencyMs: 1,
      inputTokens: null,
      outputTokens: null,
      providerRequestCount: 1,
      safeMetadata: {},
      output: stagedNormalizationOutput,
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }
    });
    const calls = { resolver: 0, http: 0, codex: 0, grok: 0 };
    const freshCoordinator = new NormalizationExecutionCoordinator({
      attempts: createProviderAttemptRepository(client),
      runtime: createProviderRuntimeRepository(client),
      semaphores: new AdapterSemaphoreRegistry(),
      resolveTarget: async (selection) => {
        calls.resolver += 1;
        if (selection.providerId === http.providerId) calls.http += 1;
        if (selection.providerId === codex.providerId) calls.codex += 1;
        if (selection.providerId === grok.providerId) calls.grok += 1;
        throw new Error('A staged winner must bypass provider resolution.');
      }
    });

    await expect(freshCoordinator.execute({
      jobLease: fixture.jobLease,
      analysisLease: fixture.analysisLease,
      candidateId: fixture.candidateId,
      expectedCandidateState: 'AI Screening',
      normalizationGeneration: 0,
      locale: 'ko',
      prompt: 'normalize this keyword',
      inputHash: fixture.inputHash,
      catalog: executionCatalog([
        { ...http, billingType: 'free', priority: 0 },
        { ...codex, billingType: 'subscription', priority: 1 },
        { ...grok, billingType: 'subscription', priority: 2 }
      ]),
      signal: new AbortController().signal
    })).resolves.toEqual({
      kind: 'finalized',
      targetState: 'Ready for API Validation'
    });

    expect(calls).toEqual({ resolver: 0, http: 0, codex: 0, grok: 0 });
    const { data: events, error: eventsError } = await client
      .from('provider_attempt_events')
      .select('attempt_id,attempt_sequence,event_type,provider_id,billing_type')
      .eq('logical_analysis_id', fixture.analysisLease.analysisId)
      .order('created_at');
    if (eventsError) throw eventsError;
    expect(events).toEqual([
      {
        attempt_id: staged.attemptId,
        attempt_sequence: 1,
        event_type: 'attempt_started',
        provider_id: codex.providerId,
        billing_type: 'subscription'
      },
      {
        attempt_id: staged.attemptId,
        attempt_sequence: 1,
        event_type: 'attempt_succeeded',
        provider_id: codex.providerId,
        billing_type: 'subscription'
      }
    ]);
    const { data: analysis, error: analysisError } = await client
      .from('ai_analyses')
      .select('status,winning_attempt_id,provider_id,cost_class,usage')
      .eq('id', fixture.analysisLease.analysisId)
      .single();
    if (analysisError) throw analysisError;
    expect(analysis).toMatchObject({
      status: 'completed',
      winning_attempt_id: staged.attemptId,
      provider_id: codex.providerId,
      cost_class: 'subscription',
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        requestCount: 1
      }
    });
    const { data: candidate, error: candidateError } = await client
      .from('candidates')
      .select('state,niche_cluster_id,rule_reasons')
      .eq('id', fixture.candidateId)
      .single();
    if (candidateError) throw candidateError;
    expect(candidate).toMatchObject({
      state: 'Ready for API Validation',
      rule_reasons: [
        { code: 'RULE_PASS', detail: 'rule accepted' },
        {
          code: 'AI_PRODUCT_NICHE',
          detail: 'Durable staged winner 9137 supplied this exact decision.'
        }
      ]
    });
    const { data: cluster, error: clusterError } = await client
      .from('niche_clusters')
      .select('canonical_key,canonical_name,canonical_english,aliases,catalog_phrases,state')
      .eq('id', candidate.niche_cluster_id ?? '')
      .single();
    if (clusterError) throw clusterError;
    expect(cluster).toEqual({
      canonical_key: 'crash recovered copper batter funnel 9137',
      canonical_name: 'Crash-Recovered Copper Batter Funnel 9137',
      canonical_english: 'Crash-Recovered Copper Batter Funnel 9137 EN',
      aliases: ['staged copper funnel 9137'],
      catalog_phrases: ['durable batter funnel 9137'],
      state: 'Ready for API Validation'
    });
    const { data: decision, error: decisionError } = await client
      .from('decision_history')
      .select('from_state,to_state,reasons,decided_by')
      .eq('candidate_id', fixture.candidateId)
      .single();
    if (decisionError) throw decisionError;
    expect(decision).toEqual({
      from_state: 'AI Screening',
      to_state: 'Ready for API Validation',
      reasons: [
        { code: 'RULE_PASS', detail: 'rule accepted' },
        {
          code: 'AI_PRODUCT_NICHE',
          detail: 'Durable staged winner 9137 supplied this exact decision.'
        }
      ],
      decided_by: 'niche-normalization-v1'
    });
  });
});
