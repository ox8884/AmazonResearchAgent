import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServerDatabaseClient } from '@ara/db';
import {
  createQueue,
  type Job,
  type QueueDatabaseClient
} from '@ara/queue';
import { ScheduledMarketProbePayloadSchema } from '@ara/shared';
import {
  enqueueDailyResearch,
  runDailyResearch,
  type DailyResearchQueue
} from './daily-research';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;
const fixturePrefix = `worker-it-daily-${randomUUID()}`;
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
    attempts: 1,
    maxAttempts: 5,
    idempotencyKey: `daily-research:${logicalRunDate}`,
    checkpoint: {},
    lastError: null,
    createdAt: '2099-01-01T00:00:00.000Z',
    updatedAt: '2099-01-01T00:00:00.000Z'
  };
}

integration('daily research orchestration', () => {
  const client = database();
  const candidateIds: string[] = [];
  const importRunIds: string[] = [];
  const runDates = ['2099-01-01', '2099-01-02'];

  beforeAll(async () => {
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

    await client.from('jobs').delete().like('idempotency_key', `${fixturePrefix}%`);
    await client.from('research_runs').delete().like('idempotency_key', `${fixturePrefix}%`);

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
    await client.from('jobs').delete().like('idempotency_key', `${fixturePrefix}%`);
    await client.from('scheduled_run_locks').delete().in('run_date', runDates);
    await client.from('research_runs').delete().like('idempotency_key', `${fixturePrefix}%`);
    await client.from('candidate_evidence').delete().in('candidate_id', candidateIds);
    await client.from('candidates').delete().in('id', candidateIds);
    await client.from('import_runs').delete().in('id', importRunIds);
    await client.from('app_settings').delete().eq('id', true);
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
      .select('selected_candidate_ids, checkpoint')
      .eq('id', runId)
      .single();
    if (selectedError) throw selectedError;
    expect(selectedRun.selected_candidate_ids).toEqual(expect.arrayContaining(candidateIds));
    expect(selectedRun.checkpoint).toMatchObject({ phase: 'fanout' });

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
      purpose: 'strong_revalidation'
    });
  });
});
