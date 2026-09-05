import { createServerDatabaseClient } from '@ara/db';
import postgres from 'postgres';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueue } from './queue';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const integration = supabaseUrl && serviceRoleKey ? describe : describe.skip;

integration('Supabase queue adapter', () => {
  const client = createServerDatabaseClient({
    url: supabaseUrl ?? 'http://127.0.0.1:54321',
    serviceRoleKey: serviceRoleKey ?? 'integration-test-not-configured'
  });
  const queue = createQueue(client);

  beforeAll(async () => {
    const { error } = await client.from('jobs').delete().like('idempotency_key', 'queue-it-%');
    if (error) {
      throw error;
    }
  });

  afterEach(async () => {
    const { error } = await client.from('jobs').delete().like('idempotency_key', 'queue-it-%');
    if (error) {
      throw error;
    }
  });

  // Break: concurrent retries create two rows despite the unique idempotency key.
  it('returns one durable job for concurrent duplicate enqueues', async () => {
    const key = `queue-it-enqueue-${crypto.randomUUID()}`;
    const [first, second] = await Promise.all([
      queue.enqueueJob({
        type: 'IMPORT_OPPORTUNITY_CSV',
        payload: { fixture: true },
        idempotencyKey: key
      }),
      queue.enqueueJob({
        type: 'IMPORT_OPPORTUNITY_CSV',
        payload: { fixture: true },
        idempotencyKey: key
      })
    ]);

    expect(second).toBe(first);
  });

  it('uses the database timestamp when an enqueue has no explicit availability time', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for the queue integration harness.');
    }
    const sql = postgres(databaseUrl, { max: 1 });
    const key = `queue-it-database-time-${crypto.randomUUID()}`;

    try {
      const jobId = await queue.enqueueJob({
        type: 'IMPORT_OPPORTUNITY_CSV',
        payload: {},
        idempotencyKey: key
      });
      const [stored] = await sql<{
        available_at: Date;
        created_at: Date;
        database_now: Date;
      }[]>`
        select available_at, created_at, clock_timestamp() as database_now
        from jobs
        where id = ${jobId}::uuid
      `;

      expect(stored?.available_at).toEqual(stored?.created_at);
      expect(stored?.available_at.getTime()).toBeLessThanOrEqual(
        stored?.database_now.getTime() ?? Number.NaN
      );
    } finally {
      await sql.end();
    }
  });

  // Break: two worker RPC calls both receive the same queued job.
  it('lets only one of two workers claim a queued job', async () => {
    const key = `queue-it-claim-${crypto.randomUUID()}`;
    const jobId = await queue.enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload: {},
      idempotencyKey: key
    });

    const [workerA, workerB] = await Promise.all([
      queue.claimJobs('integration-worker-a', 1, 60),
      queue.claimJobs('integration-worker-b', 1, 60)
    ]);
    const claimed = [...workerA, ...workerB];

    expect(claimed.map((job) => job.id)).toEqual([jobId]);
  });

  it('fails an expired final lease without allowing another claim', async () => {
    const key = `queue-it-expired-${crypto.randomUUID()}`;
    const { data: inserted, error: insertError } = await client
      .from('jobs')
      .insert({
        type: 'TEST_AI_PROVIDER_CONNECTION',
        payload: {},
        status: 'running',
        attempts: 5,
        max_attempts: 5,
        leased_by: 'expired-worker',
        leased_until: new Date(Date.now() - 1_000).toISOString(),
        idempotency_key: key
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      throw insertError ?? new Error('Expected the final lease fixture to be created.');
    }

    await expect(queue.terminalizeExpiredExhaustedJobs()).resolves.toBe(1);
    const { data: stored, error: storedError } = await client
      .from('jobs')
      .select('status, leased_by, leased_until, last_error')
      .eq('id', inserted.id)
      .single();
    if (storedError) {
      throw storedError;
    }
    const claimed = await queue.claimJobs('recovery-worker', 1, 60);

    expect(stored).toEqual({
      status: 'failed',
      leased_by: null,
      leased_until: null,
      last_error: 'queue_lease_expired_after_final_attempt'
    });
    expect(claimed.map((job) => job.id)).not.toContain(inserted.id);
  });


  // Break: a running owner cannot durably persist a phase checkpoint.
  it('persists a checkpoint only through the active lease owner', async () => {
    const key = `queue-it-checkpoint-${crypto.randomUUID()}`;
    const jobId = await queue.enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload: {},
      idempotencyKey: key
    });
    const [claimed] = await queue.claimJobs('integration-worker-a', 1, 60);
    if (!claimed) {
      throw new Error('Expected the job to be claimed.');
    }

    await queue.checkpointJob(
      claimed.leaseIdentity,
      { phase: 'persisted_raw' },
      60
    );
    const { data, error } = await client
      .from('jobs')
      .select('checkpoint, leased_by')
      .eq('id', jobId)
      .single();
    if (error) {
      throw error;
    }

    expect(data).toMatchObject({
      checkpoint: { phase: 'persisted_raw' },
      leased_by: 'integration-worker-a'
    });
  });
});
