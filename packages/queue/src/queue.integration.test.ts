import { createServerDatabaseClient } from '@ara/db';
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

  // Break: a running owner cannot durably persist a phase checkpoint.
  it('persists a checkpoint only through the active lease owner', async () => {
    const key = `queue-it-checkpoint-${crypto.randomUUID()}`;
    const jobId = await queue.enqueueJob({
      type: 'IMPORT_OPPORTUNITY_CSV',
      payload: {},
      idempotencyKey: key
    });
    await queue.claimJobs('integration-worker-a', 1, 60);

    await queue.checkpointJob(
      jobId,
      'integration-worker-a',
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
