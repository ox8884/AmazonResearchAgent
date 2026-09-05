import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServerDatabaseClient, type Database } from '@ara/db';
import {
  createQueue,
  type Job,
  type QueueDatabaseClient
} from '@ara/queue';
import { DEFAULT_CACHE_TTL_MS } from '@ara/api-budget';
import { makeApiCacheKey, ScheduledMarketProbePayloadSchema } from '@ara/shared';
import {
  enqueueDailyResearch,
  runDailyResearch,
  type DailyResearchQueue
} from './daily-research';
import { runDeepValidation } from './deep-validation';
import { PostgresApiBudget } from './postgres-api-budget';
import { appendResearchBusinessEvidence } from './research-business-test-support';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;
const fixturePrefix = `worker-it-daily-${randomUUID()}`;
const fixtureEntropy = Number.parseInt(fixturePrefix.replaceAll('-', '').slice(-8), 16);
const fixtureYear = 2000 + (fixtureEntropy % 8_000);
const fixtureRunDates = [`${fixtureYear}-01-01`, `${fixtureYear}-01-02`] as const;
type AppSettingsRow = Database['public']['Tables']['app_settings']['Row'];
function database(): QueueDatabaseClient {
  return createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
}

function queueFor(client: QueueDatabaseClient): DailyResearchQueue {
  const queue = createQueue(client);
  return {
    enqueueJob: (input) => queue.enqueueJob(input)
  };
}

function makeOrchestratorJob(
  id: string,
  runId: string,
  logicalRunDate: string
): Job {
  return {
    id,
    type: 'DAILY_RESEARCH',
    payload: { researchRunId: runId, logicalRunDate, locale: 'ko' },
    status: 'running',
    priority: 100,
    availableAt: '2099-01-01T00:00:00.000Z',
    leasedUntil: '2099-01-01T00:02:00.000Z',
    leasedBy: 'integration-worker',
    leaseIdentity: { jobId: id, owner: 'integration-worker', epoch: 1 },
    attempts: 1,
    maxAttempts: 5,
    idempotencyKey: `daily-research:${logicalRunDate}`,
    checkpoint: {},
    lastError: null,
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z'
  };
}
async function cleanupDailyFixtures(
  client: QueueDatabaseClient,
  runDates: readonly string[]
): Promise<void> {
  const runKeys = runDates.map((date) => `daily-research:${date}`);
  const { data: runs, error: runError } = await client
    .from('research_runs')
    .select('id')
    .in('idempotency_key', runKeys);
  if (runError) throw runError;
  for (const run of runs ?? []) {
    const { error } = await client
      .from('jobs')
      .delete()
      .like('idempotency_key', `daily-research:${run.id}:%`);
    if (error) throw error;
  }
  const { error: digestJobError } = await client
    .from('jobs')
    .delete()
    .in(
      'idempotency_key',
      (runs ?? []).map((run) => `send-digest:${run.id}`)
    );
  if (digestJobError) throw digestJobError;
  const { error: parentJobError } = await client
    .from('jobs')
    .delete()
    .in('idempotency_key', runKeys);
  if (parentJobError) throw parentJobError;
  const fixtureRunIds = (runs ?? []).map((run) => run.id);
  if (fixtureRunIds.length > 0) {
    const { error: lockError } = await client
      .from('scheduled_run_locks')
      .delete()
      .in('research_run_id', fixtureRunIds);
    if (lockError) throw lockError;
  }
  const { error: researchRunError } = await client
    .from('research_runs')
    .delete()
    .in('idempotency_key', runKeys);
  if (researchRunError) throw researchRunError;
}


async function restoreDailyResearchSettingsIfOwned(
  client: QueueDatabaseClient,
  originalSettings: AppSettingsRow | null,
  fixtureSettings: AppSettingsRow | null
): Promise<void> {
  if (!fixtureSettings) return;

  if (originalSettings) {
    const restoredValues = {
      locale: originalSettings.locale,
      timezone: originalSettings.timezone,
      daily_api_budget: originalSettings.daily_api_budget,
      manual_api_reserve: originalSettings.manual_api_reserve,
      manual_reserve_enabled: originalSettings.manual_reserve_enabled,
      new_percent: originalSettings.new_percent,
      watch_percent: originalSettings.watch_percent,
      strong_percent: originalSettings.strong_percent,
      new_freshness_hours: originalSettings.new_freshness_hours,
      watch_freshness_hours: originalSettings.watch_freshness_hours,
      strong_freshness_hours: originalSettings.strong_freshness_hours
    };
    const { error } = await client
      .from('app_settings')
      .update(restoredValues)
      .eq('id', true)
      .eq('updated_at', fixtureSettings.updated_at);
    if (error) throw error;
    return;
  }

  const { error } = await client
    .from('app_settings')
    .delete()
    .eq('id', true)
    .eq('updated_at', fixtureSettings.updated_at);
  if (error) throw error;
}
integration('daily research orchestration', () => {
  const client = database();
  const candidateIds: string[] = [];
  const importRunIds: string[] = [];
  const runDates = [...fixtureRunDates];
  let originalSettings: AppSettingsRow | null = null;
  let fixtureSettings: AppSettingsRow | null = null;

  beforeAll(async () => {
    const { data: settings, error: readSettingsError } = await client
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (readSettingsError) throw readSettingsError;
    originalSettings = settings;
    await cleanupDailyFixtures(client, runDates);

    const { error: settingsError } = await client.from('app_settings').upsert({
      id: true,
      locale: 'ko',
      timezone: 'America/Chicago',
      daily_api_budget: 2,
      manual_api_reserve: 1,
      manual_reserve_enabled: true,
      new_percent: 50,
      watch_percent: 0,
      strong_percent: 50,
      new_freshness_hours: 168,
      watch_freshness_hours: 168,
      strong_freshness_hours: 24
    });
    if (settingsError) throw settingsError;
    const { data: installedSettings, error: installedSettingsError } = await client
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .single();
    if (installedSettingsError) throw installedSettingsError;
    fixtureSettings = installedSettings;

    for (const state of ['Ready for API Validation', 'Watch']) {
      const importRunId = randomUUID();
      const candidateId = randomUUID();
      importRunIds.push(importRunId);
      candidateIds.push(candidateId);
      const { error: importError } = await client.from('import_runs').insert({
        id: importRunId,
        submission_hash: `${fixturePrefix}-${importRunId}`
      });
      if (importError) throw importError;
      const { error: candidateError } = await client.from('candidates').insert({
        id: candidateId,
        import_run_id: importRunId,
        keyword: `${fixturePrefix}-${state}`,
        normalized_exact_keyword: `${fixturePrefix}-${state}`,
        state,
        preliminary_score: 100,
        rule_passed: true
      });
      if (candidateError) throw candidateError;
      await appendResearchBusinessEvidence(client, candidateId, {
        requestedApiPurposes: ['product_database']
      });
    }

    const strongCandidateId = candidateIds[1];
    if (!strongCandidateId) throw new Error('Strong candidate fixture was not created.');
    const { error: evidenceError } = await client.from('candidate_evidence').insert({
      candidate_id: strongCandidateId,
      kind: 'analysis_verdict',
      payload: { verdict: 'strong_potential' }
    });
    if (evidenceError) throw evidenceError;
  });

  afterAll(async () => {
    await cleanupDailyFixtures(client, runDates);
    const { error: evidenceError } = await client
      .from('candidate_evidence')
      .delete()
      .in('candidate_id', candidateIds);
    if (evidenceError) throw evidenceError;
    const { error: candidateError } = await client
      .from('candidates')
      .delete()
      .in('id', candidateIds);
    if (candidateError) throw candidateError;
    const { error: importError } = await client
      .from('import_runs')
      .delete()
      .in('id', importRunIds);
    if (importError) throw importError;
    await restoreDailyResearchSettingsIfOwned(client, originalSettings, fixtureSettings);
  });

  it('deduplicates a date, checkpoints selection before fanout, resumes safely, and preserves strong revalidation', async () => {
    const date = runDates[0] ?? '2099-01-01';
    const first = await enqueueDailyResearch(client, { logicalRunDate: date });
    const second = await enqueueDailyResearch(client, { logicalRunDate: date });
    expect(second).toEqual(first);

    const { data: runs, error: runError } = await client
      .from('research_runs')
      .select('id')
      .eq('logical_run_date', date)
      .eq('source', 'scheduled');
    if (runError) throw runError;
    expect(runs).toHaveLength(1);

    const { data: dailyJobs, error: dailyError } = await client
      .from('jobs')
      .select('id')
      .eq('idempotency_key', `daily-research:${date}`);
    if (dailyError) throw dailyError;
    expect(dailyJobs).toHaveLength(1);

    const runId = first.researchRunId;
    const job = makeOrchestratorJob(randomUUID(), runId, date);
    const crashingQueue: DailyResearchQueue = {
      enqueueJob: async () => {
        throw new Error('simulated fanout crash');
      }
    };
    await expect(
      runDailyResearch(job, { client, queue: crashingQueue, now: () => new Date('2099-01-01T12:00:00.000Z') })
    ).rejects.toThrow('simulated fanout crash');

    const { data: selectedRun, error: selectedError } = await client
      .from('research_runs')
      .select('selected_candidate_ids, checkpoint, status')
      .eq('id', runId)
      .single();
    if (selectedError) throw selectedError;
    expect(selectedRun.selected_candidate_ids).toEqual(expect.arrayContaining(candidateIds));
    expect(selectedRun.checkpoint).toMatchObject({ phase: 'fanout' });
    expect(selectedRun.status).toBe('fanout');

    await runDailyResearch(job, {
      client,
      queue: queueFor(client),
      now: () => new Date('2099-01-01T12:00:00.000Z')
    });
    await runDailyResearch(job, {
      client,
      queue: queueFor(client),
      now: () => new Date('2099-01-01T12:00:00.000Z')
    });
    const { data: completedRun, error: completedError } = await client
      .from('research_runs')
      .select('status, completed_at, checkpoint')
      .eq('id', runId)
      .single();
    if (completedError) throw completedError;
    expect(completedRun.status).toBe('completed');
    expect(completedRun.completed_at).not.toBeNull();
    expect(completedRun.checkpoint).toMatchObject({ phase: 'fanout_complete' });

    const { data: childJobs, error: childError } = await client
      .from('jobs')
      .select('id, payload, idempotency_key')
      .like('idempotency_key', `daily-research:${runId}:%`);
    if (childError) throw childError;
    expect(childJobs).toHaveLength(2);
    expect(new Set(childJobs.map((child) => child.idempotency_key)).size).toBe(2);

    const childPayloads = childJobs.map((child) => ({
      child,
      payload: ScheduledMarketProbePayloadSchema.parse(child.payload)
    }));
    const strongJob = childPayloads.find(
      ({ payload }) => payload.candidateId === candidateIds[1]
    );
    expect(strongJob?.payload).toMatchObject({
      candidateId: candidateIds[1],
      purpose: 'strong_revalidation',
      researchRunId: runId
    });
  });

  it('preserves settings changed after the fixture snapshot during cleanup', async () => {
    const fixture = fixtureSettings;
    if (!fixture) throw new Error('Daily research settings fixture was not installed.');

    const changedTelegramEnabled = !fixture.telegram_enabled;
    const { error: concurrentModificationError } = await client
      .from('app_settings')
      .update({ telegram_enabled: changedTelegramEnabled })
      .eq('id', true);
    if (concurrentModificationError) throw concurrentModificationError;

    await restoreDailyResearchSettingsIfOwned(client, originalSettings, fixture);

    const { data: preserved, error: preservedError } = await client
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .single();
    if (preservedError) throw preservedError;
    expect(preserved.telegram_enabled).toBe(changedTelegramEnabled);
    expect(preserved.daily_api_budget).toBe(fixture.daily_api_budget);

    const { error: repairError } = await client
      .from('app_settings')
      .update({ telegram_enabled: fixture.telegram_enabled })
      .eq('id', true);
    if (repairError) throw repairError;
    const { data: repaired, error: repairedError } = await client
      .from('app_settings')
      .select('*')
      .eq('id', true)
      .single();
    if (repairedError) throw repairedError;
    fixtureSettings = repaired;
  });

  it('records a completed no-work run when only a candidate without business endpoint intent remains actionable by state', async () => {
    const date = `${fixtureYear}-01-04`;
    const importRunId = randomUUID();
    const candidateId = randomUUID();
    await cleanupDailyFixtures(client, [date]);
    await client.from('candidates').update({ state: 'Reject' }).in('id', candidateIds);
    try {
      const { error: importError } = await client.from('import_runs').insert({
        id: importRunId,
        submission_hash: `${fixturePrefix}-no-business-${importRunId}`
      });
      if (importError) throw importError;
      const { error: candidateError } = await client.from('candidates').insert({
        id: candidateId,
        import_run_id: importRunId,
        keyword: `${fixturePrefix}-no-business`,
        normalized_exact_keyword: `${fixturePrefix}-no-business`,
        state: 'Ready for API Validation',
        rule_passed: true,
        preliminary_score: 100
      });
      if (candidateError) throw candidateError;
      const scheduled = await enqueueDailyResearch(client, { logicalRunDate: date });
      await runDailyResearch(
        makeOrchestratorJob(randomUUID(), scheduled.researchRunId, date),
        { client, queue: queueFor(client), now: () => new Date('2099-01-04T12:00:00.000Z') }
      );
      const { data: run, error: runError } = await client
        .from('research_runs')
        .select('status,selected_candidate_ids')
        .eq('id', scheduled.researchRunId)
        .single();
      if (runError) throw runError;
      const { data: children, error: childrenError } = await client
        .from('jobs')
        .select('id')
        .like('idempotency_key', `daily-research:${scheduled.researchRunId}:%`);
      if (childrenError) throw childrenError;
      expect(run).toMatchObject({ status: 'completed', selected_candidate_ids: [] });
      expect(children).toHaveLength(0);
    } finally {
      await cleanupDailyFixtures(client, [date]);
      await client.from('candidates').delete().eq('id', candidateId);
      await client.from('import_runs').delete().eq('id', importRunId);
      const [readyCandidateId, watchCandidateId] = candidateIds;
      if (readyCandidateId) {
        await client.from('candidates').update({ state: 'Ready for API Validation' }).eq('id', readyCandidateId);
      }
      if (watchCandidateId) {
        await client.from('candidates').update({ state: 'Watch' }).eq('id', watchCandidateId);
      }
    }
  });

  it('routes a keyword-only business request straight to deep validation without Product Database', async () => {
    const date = `${fixtureYear}-01-05`;
    const importRunId = randomUUID();
    const candidateId = randomUUID();
    await cleanupDailyFixtures(client, [date]);
    await client.from('candidates').update({ state: 'Reject' }).in('id', candidateIds);
    try {
      const { error: importError } = await client.from('import_runs').insert({
        id: importRunId,
        submission_hash: `${fixturePrefix}-keyword-only-${importRunId}`
      });
      if (importError) throw importError;
      const { error: candidateError } = await client.from('candidates').insert({
        id: candidateId,
        import_run_id: importRunId,
        keyword: `${fixturePrefix}-keyword-only`,
        normalized_exact_keyword: `${fixturePrefix}-keyword-only`,
        state: 'Ready for API Validation',
        rule_passed: true,
        preliminary_score: 100
      });
      if (candidateError) throw candidateError;
      await appendResearchBusinessEvidence(client, candidateId, {
        requestedApiPurposes: ['keywords_by_keyword']
      });
      const scheduled = await enqueueDailyResearch(client, { logicalRunDate: date });
      await runDailyResearch(
        makeOrchestratorJob(randomUUID(), scheduled.researchRunId, date),
        { client, queue: queueFor(client), now: () => new Date('2099-01-05T12:00:00.000Z') }
      );
      const { data: children, error: childrenError } = await client
        .from('jobs')
        .select('type,payload')
        .like('idempotency_key', `daily-research:${scheduled.researchRunId}:%`);
      if (childrenError) throw childrenError;
      expect(children).toHaveLength(1);
      expect(children?.[0]).toMatchObject({
        type: 'DEEP_VALIDATION',
        payload: { candidateId, locale: 'ko' }
      });
    } finally {
      await cleanupDailyFixtures(client, [date]);
      await client.from('candidate_evidence').delete().eq('candidate_id', candidateId);
      await client.from('candidates').delete().eq('id', candidateId);
      await client.from('import_runs').delete().eq('id', importRunId);
      const [readyCandidateId, watchCandidateId] = candidateIds;
      if (readyCandidateId) {
        await client.from('candidates').update({ state: 'Ready for API Validation' }).eq('id', readyCandidateId);
      }
      if (watchCandidateId) {
        await client.from('candidates').update({ state: 'Watch' }).eq('id', watchCandidateId);
      }
    }
  });

  it('selects a missing requested keyword despite fresh Product Database evidence and skips an already-fresh keyword', async () => {
    const date = `${fixtureYear}-01-06`;
    const missingImportRunId = randomUUID();
    const freshImportRunId = randomUUID();
    const missingCandidateId = randomUUID();
    const freshCandidateId = randomUUID();
    const now = new Date();
    await cleanupDailyFixtures(client, [date]);
    await client.from('candidates').update({ state: 'Reject' }).in('id', candidateIds);
    try {
      for (const [importRunId, candidateId, keyword] of [
        [missingImportRunId, missingCandidateId, `${fixturePrefix}-keyword-gap`],
        [freshImportRunId, freshCandidateId, `${fixturePrefix}-keyword-fresh`]
      ] as const) {
        const { error: importError } = await client.from('import_runs').insert({
          id: importRunId,
          submission_hash: `${fixturePrefix}-${importRunId}`
        });
        if (importError) throw importError;
        const { error: candidateError } = await client.from('candidates').insert({
          id: candidateId,
          import_run_id: importRunId,
          keyword,
          normalized_exact_keyword: keyword,
          state: 'Ready for API Validation',
          rule_passed: true,
          preliminary_score: 100
        });
        if (candidateError) throw candidateError;
        await appendResearchBusinessEvidence(client, candidateId, {
          requestedApiPurposes: ['product_database', 'keywords_by_keyword']
        });
      }
      const { error: snapshotError } = await client.from('market_snapshots').insert([
        {
          candidate_id: missingCandidateId,
          captured_at: now.toISOString(),
          metrics: { observation: { cacheCapturedAt: now.toISOString() } }
        },
        {
          candidate_id: freshCandidateId,
          captured_at: now.toISOString(),
          metrics: { observation: { cacheCapturedAt: now.toISOString() } }
        }
      ]);
      if (snapshotError) throw snapshotError;
      const { error: keywordEvidenceError } = await client.from('candidate_evidence').insert({
        candidate_id: freshCandidateId,
        kind: 'keyword_metrics',
        payload: {
          keyword: `${fixturePrefix}-keyword-fresh`,
          observation: { cacheCapturedAt: now.toISOString() }
        },
        created_at: now.toISOString()
      });
      if (keywordEvidenceError) throw keywordEvidenceError;

      const scheduled = await enqueueDailyResearch(client, { logicalRunDate: date });
      await runDailyResearch(
        makeOrchestratorJob(randomUUID(), scheduled.researchRunId, date),
        { client, queue: queueFor(client), now: () => now }
      );
      const { data: children, error: childrenError } = await client
        .from('jobs')
        .select('type,payload')
        .like('idempotency_key', `daily-research:${scheduled.researchRunId}:%`);
      if (childrenError) throw childrenError;
      expect(children).toHaveLength(1);
      expect(children?.[0]).toMatchObject({
        type: 'DEEP_VALIDATION',
        payload: { candidateId: missingCandidateId, locale: 'ko' }
      });
    } finally {
      await cleanupDailyFixtures(client, [date]);
      await client
        .from('candidate_evidence')
        .delete()
        .in('candidate_id', [missingCandidateId, freshCandidateId]);
      await client.from('candidates').delete().in('id', [missingCandidateId, freshCandidateId]);
      await client.from('import_runs').delete().in('id', [missingImportRunId, freshImportRunId]);
      const [readyCandidateId, watchCandidateId] = candidateIds;
      if (readyCandidateId) {
        await client.from('candidates').update({ state: 'Ready for API Validation' }).eq('id', readyCandidateId);
      }
      if (watchCandidateId) {
        await client.from('candidates').update({ state: 'Watch' }).eq('id', watchCandidateId);
      }
    }
  });

  it('does not extend keyword freshness after a near-expiry shared cache hit', async () => {
    const date = `${fixtureYear}-01-07`;
    const importRunId = randomUUID();
    const candidateId = randomUUID();
    const keyword = `${fixturePrefix}-near-expiry-cache`;
    const cacheKey = makeApiCacheKey({
      endpoint: 'keywords_by_keyword',
      marketplace: 'us',
      phrases: [keyword]
    });
    const cacheCapturedAt = new Date(
      Date.now() - DEFAULT_CACHE_TTL_MS.keywords_by_keyword + 60_000
    );
    const cacheExpiresAt = new Date(Date.now() + 60_000);
    const plannerNow = new Date(Date.now() + 120_000);
    await cleanupDailyFixtures(client, [date]);
    await client.from('candidates').update({ state: 'Reject' }).in('id', candidateIds);
    try {
      const { error: importError } = await client.from('import_runs').insert({
        id: importRunId,
        submission_hash: `${fixturePrefix}-near-expiry-${importRunId}`
      });
      if (importError) throw importError;
      const { error: candidateError } = await client.from('candidates').insert({
        id: candidateId,
        import_run_id: importRunId,
        keyword,
        normalized_exact_keyword: keyword,
        state: 'Ready for API Validation',
        rule_passed: true,
        preliminary_score: 100
      });
      if (candidateError) throw candidateError;
      await appendResearchBusinessEvidence(client, candidateId, {
        requestedApiPurposes: ['keywords_by_keyword']
      });
      const { error: cacheError } = await client.from('api_cache').upsert({
        cache_key: cacheKey,
        endpoint: 'keywords_by_keyword',
        response: { keyword, monthlySearchVolume: 880, isUpperBound: false },
        captured_at: cacheCapturedAt.toISOString(),
        expires_at: cacheExpiresAt.toISOString()
      });
      if (cacheError) throw cacheError;

      let queryCalls = 0;
      const restored = await runDeepValidation(candidateId, 'ko', {
        client,
        budget: new PostgresApiBudget(
          client,
          { dailyLimit: 20, reservedLimit: 5 },
          `daily-near-expiry-${candidateId}`
        ),
        queryKeyword: async () => {
          queryCalls += 1;
          return { keyword, monthlySearchVolume: 1, isUpperBound: false };
        }
      });
      expect(restored).toMatchObject({ completed: true, keywordCalls: 0 });
      expect(queryCalls).toBe(0);

      const scheduled = await enqueueDailyResearch(client, { logicalRunDate: date });
      await runDailyResearch(
        makeOrchestratorJob(randomUUID(), scheduled.researchRunId, date),
        { client, queue: queueFor(client), now: () => plannerNow }
      );
      const { data: children, error: childrenError } = await client
        .from('jobs')
        .select('type,payload')
        .like('idempotency_key', `daily-research:${scheduled.researchRunId}:%`);
      if (childrenError) throw childrenError;
      expect(children).toHaveLength(1);
      expect(children?.[0]).toMatchObject({
        type: 'DEEP_VALIDATION',
        payload: { candidateId, locale: 'ko' }
      });
      const { data: keywordEvidence, error: keywordEvidenceError } = await client
        .from('candidate_evidence')
        .select('payload')
        .eq('candidate_id', candidateId)
        .eq('kind', 'keyword_metrics')
        .maybeSingle();
      if (keywordEvidenceError) throw keywordEvidenceError;
      expect(keywordEvidence?.payload).toMatchObject({
        observation: { cacheCapturedAt: expect.any(String) }
      });
    } finally {
      await cleanupDailyFixtures(client, [date]);
      await client.from('candidate_evidence').delete().eq('candidate_id', candidateId);
      await client.from('api_cache').delete().eq('cache_key', cacheKey);
      await client.from('candidates').delete().eq('id', candidateId);
      await client.from('import_runs').delete().eq('id', importRunId);
      const [readyCandidateId, watchCandidateId] = candidateIds;
      if (readyCandidateId) {
        await client.from('candidates').update({ state: 'Ready for API Validation' }).eq('id', readyCandidateId);
      }
      if (watchCandidateId) {
        await client.from('candidates').update({ state: 'Watch' }).eq('id', watchCandidateId);
      }
    }
  });

  // Break: fixture cleanup deletes another run’s scheduled lock just because the dates overlap.
  it('does not delete scheduled locks owned by another research run', async () => {
    const foreignDate = `${fixtureYear}-12-31`;
    const { data: foreignRun, error: foreignRunError } = await client
      .from('research_runs')
      .insert({
        source: 'scheduled',
        logical_run_date: foreignDate,
        idempotency_key: `${fixturePrefix}-foreign-lock`,
        locale: 'ko'
      })
      .select('id')
      .single();
    if (foreignRunError) throw foreignRunError;
    const { error: foreignLockError } = await client.from('scheduled_run_locks').insert({
      run_date: foreignDate,
      research_run_id: foreignRun.id
    });
    if (foreignLockError) throw foreignLockError;

    try {
      await cleanupDailyFixtures(client, [foreignDate]);
      const { data: remainingLock, error: remainingError } = await client
        .from('scheduled_run_locks')
        .select('research_run_id')
        .eq('run_date', foreignDate)
        .maybeSingle();
      if (remainingError) throw remainingError;
      expect(remainingLock?.research_run_id).toBe(foreignRun.id);
    } finally {
      await client
        .from('scheduled_run_locks')
        .delete()
        .eq('research_run_id', foreignRun.id);
      await client.from('research_runs').delete().eq('id', foreignRun.id);
    }
  });

  it('enqueues one normalization job for eligible AI Screening candidates only', async () => {
    const date = `${fixtureYear}-01-03`;
    const screeningEligibleId = randomUUID();
    const screeningIneligibleId = randomUUID();
    const rejectedId = randomUUID();
    const extraImportIds = [randomUUID(), randomUUID(), randomUUID()];
    const extraCandidateIds = [screeningEligibleId, screeningIneligibleId, rejectedId];
    const readyId = candidateIds[0];
    if (!readyId) {
      throw new Error('Ready-for-API fixture was not created.');
    }

    const seed = [
      {
        id: screeningEligibleId,
        importRunId: extraImportIds[0],
        state: 'AI Screening',
        eligible: true,
        keyword: `${fixturePrefix}-screen-eligible`
      },
      {
        id: screeningIneligibleId,
        importRunId: extraImportIds[1],
        state: 'AI Screening',
        eligible: false,
        keyword: `${fixturePrefix}-screen-ineligible`
      },
      {
        id: rejectedId,
        importRunId: extraImportIds[2],
        state: 'Reject',
        eligible: false,
        keyword: `${fixturePrefix}-rejected`
      }
    ] as const;

    try {
      for (const row of seed) {
        const importRunId = row.importRunId;
        if (!importRunId) {
          throw new Error('Import fixture id was missing.');
        }
        const { error: importError } = await client.from('import_runs').insert({
          id: importRunId,
          submission_hash: `${fixturePrefix}-${importRunId}`
        });
        if (importError) throw importError;
        const { error: candidateError } = await client.from('candidates').insert({
          id: row.id,
          import_run_id: importRunId,
          keyword: row.keyword,
          normalized_exact_keyword: row.keyword,
          state: row.state,
          preliminary_score: 80,
          rule_passed: row.eligible,
          eligible_for_ai_normalization: row.eligible
        });
        if (candidateError) throw candidateError;
      }

      const first = await enqueueDailyResearch(client, { logicalRunDate: date });
      const job = makeOrchestratorJob(randomUUID(), first.researchRunId, date);
      await runDailyResearch(job, {
        client,
        queue: queueFor(client),
        now: () => new Date('2099-01-03T12:00:00.000Z')
      });
      await runDailyResearch(job, {
        client,
        queue: queueFor(client),
        now: () => new Date('2099-01-03T12:00:00.000Z')
      });

      const canonicalKeys = extraCandidateIds.map((id) => `normalize:${id}:0`);
      const { data: normalizeJobs, error: normalizeError } = await client
        .from('jobs')
        .select('id, type, payload, idempotency_key')
        .eq('type', 'NORMALIZE_OPPORTUNITIES')
        .in('idempotency_key', canonicalKeys);
      if (normalizeError) throw normalizeError;
      expect(normalizeJobs).toHaveLength(1);
      expect(normalizeJobs?.[0]?.idempotency_key).toBe(`normalize:${screeningEligibleId}:0`);
      expect(normalizeJobs?.[0]?.payload).toEqual({
        candidateIds: [screeningEligibleId],
        locale: 'ko',
        normalizationGeneration: 0
      });

      const { data: readyNormalize, error: readyNormalizeError } = await client
        .from('jobs')
        .select('id')
        .eq('idempotency_key', `normalize:${readyId}:0`);
      if (readyNormalizeError) throw readyNormalizeError;
      expect(readyNormalize ?? []).toHaveLength(0);

      const { data: probeJobs, error: probeError } = await client
        .from('jobs')
        .select('id, type, payload')
        .like('idempotency_key', `daily-research:${first.researchRunId}:%`);
      if (probeError) throw probeError;
      expect(probeJobs).toHaveLength(2);
      expect(probeJobs?.every((child) => child.type === 'MARKET_PROBE')).toBe(true);
      expect(
        probeJobs?.some((child) =>
          JSON.stringify(child.payload).includes(screeningEligibleId)
        )
      ).toBe(false);
    } finally {
      await client
        .from('jobs')
        .delete()
        .in('idempotency_key', extraCandidateIds.map((id) => `normalize:${id}:0`));
      await cleanupDailyFixtures(client, [date]);
      await client.from('candidates').delete().in('id', extraCandidateIds);
      await client.from('import_runs').delete().in('id', extraImportIds);
    }
  });

});
