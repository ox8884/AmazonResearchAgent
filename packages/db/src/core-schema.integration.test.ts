import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 4 });

function requireJobId(row: { id: string } | undefined): string {
  if (!row) {
    throw new Error('Expected the fixture job insert to return an id');
  }
  return row.id;
}


describe('core research schema', () => {
  beforeEach(async () => {
    await sql`delete from jobs where idempotency_key like 'db-it-%'`;
  });

  afterAll(async () => {
    await sql`delete from jobs where idempotency_key like 'db-it-%'`;
    await sql.end();
  });

  // Break: two workers can claim the same queued job concurrently.
  it('claims a queued job exactly once', async () => {
    const [created] = await sql<{ id: string }[]>`
      insert into jobs (type, status, idempotency_key)
      values ('IMPORT_OPPORTUNITY_CSV', 'queued', 'db-it-fixture-1')
      returning id
    `;

    const first = await sql<{ id: string }[]>`
      select id from claim_jobs('worker-a', 1, 60)
    `;
    const second = await sql<{ id: string }[]>`
      select id from claim_jobs('worker-b', 1, 60)
    `;

    expect(first.map((job) => job.id)).toEqual([created?.id]);
    expect(second).toEqual([]);
  });

  // Break: a non-owner can extend or complete another worker's lease.
  it('allows only the lease owner to heartbeat and complete a job', async () => {
    const [created] = await sql<{ id: string }[]>`
      insert into jobs (type, status, idempotency_key)
      values ('IMPORT_OPPORTUNITY_CSV', 'queued', 'db-it-owned-job')
      returning id
    `;
    const jobId = requireJobId(created);

    await sql`select id from claim_jobs('worker-a', 1, 60)`;
    const [otherHeartbeat] = await sql<{ result: boolean }[]>`
      select heartbeat_job(${jobId}::uuid, 'worker-b', 60) as result
    `;
    const [ownerHeartbeat] = await sql<{ result: boolean }[]>`
      select heartbeat_job(${jobId}::uuid, 'worker-a', 60) as result
    `;
    const [otherComplete] = await sql<{ result: boolean }[]>`
      select complete_job(${jobId}::uuid, 'worker-b', '{}'::jsonb) as result
    `;
    const [ownerComplete] = await sql<{ result: boolean }[]>`
      select complete_job(
        ${jobId}::uuid,
        'worker-a',
        '{"phase":"completed"}'::jsonb
      ) as result
    `;
    const [stored] = await sql<{ status: string; checkpoint: unknown }[]>`
      select status, checkpoint from jobs where id = ${jobId}::uuid
    `;

    expect(otherHeartbeat?.result).toBe(false);
    expect(ownerHeartbeat?.result).toBe(true);
    expect(otherComplete?.result).toBe(false);
    expect(ownerComplete?.result).toBe(true);
    expect(stored).toMatchObject({
      status: 'completed',
      checkpoint: { phase: 'completed' }
    });
  });

  // Break: an expired lease strands a checkpoint instead of making the job claimable.
  it('reclaims an expired lease without losing its checkpoint', async () => {
    const [created] = await sql<{ id: string }[]>`
      insert into jobs (type, status, idempotency_key, checkpoint)
      values (
        'IMPORT_OPPORTUNITY_CSV',
        'queued',
        'db-it-expired-lease',
        '{"phase":"parsed"}'::jsonb
      )
      returning id
    `;
    const jobId = requireJobId(created);

    await sql`select id from claim_jobs('worker-a', 1, 60)`;
    await sql`
      update jobs
      set leased_until = now() - interval '1 second'
      where id = ${jobId}::uuid
    `;
    const reclaimed = await sql<
      { id: string; leased_by: string; attempts: number; checkpoint: unknown }[]
    >`select id, leased_by, attempts, checkpoint from claim_jobs('worker-b', 1, 60)`;

    expect(reclaimed).toMatchObject([
      {
        id: jobId,
        leased_by: 'worker-b',
        attempts: 2,
        checkpoint: { phase: 'parsed' }
      }
    ]);
  });

  // Break: a max-attempt failure is requeued forever instead of becoming terminal.
  it('marks a job failed when the final attempt fails', async () => {
    const [created] = await sql<{ id: string }[]>`
      insert into jobs (type, status, idempotency_key, max_attempts)
      values ('IMPORT_OPPORTUNITY_CSV', 'queued', 'db-it-terminal-failure', 1)
      returning id
    `;
    const jobId = requireJobId(created);

    await sql`select id from claim_jobs('worker-a', 1, 60)`;
    const [failed] = await sql<{ result: boolean }[]>`
      select fail_job(
        ${jobId}::uuid,
        'worker-a',
        'fixture failure',
        now(),
        '{"phase":"parsed"}'::jsonb
      ) as result
    `;
    const [stored] = await sql<
      { status: string; last_error: string; checkpoint: unknown }[]
    >`select status, last_error, checkpoint from jobs where id = ${jobId}::uuid`;

    expect(failed?.result).toBe(true);
    expect(stored).toMatchObject({
      status: 'failed',
      last_error: 'fixture failure',
      checkpoint: { phase: 'parsed' }
    });
  });
});
