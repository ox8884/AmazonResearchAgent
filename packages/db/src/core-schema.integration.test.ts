import { randomUUID } from 'node:crypto';
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

describe('AI analysis and cluster hardening RPCs', () => {
  beforeEach(async () => {
    await sql`delete from ai_usage where provider_id like 'db-it-ai-%'`;
    await sql`delete from ai_analyses where provider_id like 'db-it-ai-%'`;
    await sql`delete from ai_providers where id like 'db-it-ai-%'`;
    await sql`delete from niche_clusters where canonical_key like 'db-it-cluster-%'`;
  });

  afterAll(async () => {
    await sql`delete from ai_usage where provider_id like 'db-it-ai-%'`;
    await sql`delete from ai_analyses where provider_id like 'db-it-ai-%'`;
    await sql`delete from ai_providers where id like 'db-it-ai-%'`;
    await sql`delete from niche_clusters where canonical_key like 'db-it-cluster-%'`;
    await sql.end();
  });

  async function seedProvider(): Promise<string> {
    const providerId = `db-it-ai-${randomUUID()}`;
    await sql`
      insert into ai_providers (id, name, kind, billing_type, enabled, config)
      values (${providerId}, ${providerId}, 'command', 'free', true, '{}'::jsonb)
    `;
    return providerId;
  }

  // Break: two workers can run the same analysis, or a failed analysis is retried before available_at.
  it('leases an analysis once and keeps failed rows busy until they are available', async () => {
    const providerId = await seedProvider();
    const hash = 'a'.repeat(64);

    const first = await sql<{ analysis_id: string; claim_status: string }[]>`
      select analysis_id, claim_status from claim_ai_analysis(
        'niche_normalization',
        ${hash},
        'worker-a',
        60,
        ${providerId},
        'model-1',
        'ko',
        'v1',
        '{}'::jsonb
      )
    `;
    const busy = await sql<{ claim_status: string }[]>`
      select claim_status from claim_ai_analysis(
        'niche_normalization',
        ${hash},
        'worker-b',
        60,
        ${providerId},
        'model-1',
        'ko',
        'v1',
        '{}'::jsonb
      )
    `;

    expect(first[0]?.claim_status).toBe('claimed');
    expect(busy[0]?.claim_status).toBe('busy');

    const analysisId = first[0]?.analysis_id;
    if (!analysisId) {
      throw new Error('Expected a claimed analysis id');
    }

    await sql`
      select fail_ai_analysis(
        ${analysisId}::uuid,
        'worker-a',
        'provider_execution_failed',
        now() + interval '2 minutes'
      )
    `;
    const retryBusy = await sql<{ claim_status: string }[]>`
      select claim_status from claim_ai_analysis(
        'niche_normalization',
        ${hash},
        'worker-b',
        60,
        ${providerId},
        'model-1',
        'ko',
        'v1',
        '{}'::jsonb
      )
    `;
    expect(retryBusy[0]?.claim_status).toBe('busy');

    await sql`
      update ai_analyses
      set available_at = now() - interval '1 second'
      where id = ${analysisId}::uuid
    `;
    const reclaimed = await sql<{ claim_status: string }[]>`
      select claim_status from claim_ai_analysis(
        'niche_normalization',
        ${hash},
        'worker-b',
        60,
        ${providerId},
        'model-1',
        'ko',
        'v1',
        '{}'::jsonb
      )
    `;
    expect(reclaimed[0]?.claim_status).toBe('claimed');
  });

  // Break: concurrent cluster upserts create duplicates or drop aliases.
  it('upserts one canonical cluster and unions aliases concurrently', async () => {
    const canonicalKey = `db-it-cluster-${randomUUID()}`;

    await Promise.all([
      sql`
        select upsert_niche_cluster(
          ${canonicalKey},
          'Batter / Pancake Dispenser',
          'Batter / Pancake Dispenser',
          ${sql.json(['alpha'])},
          ${sql.json(['phrase-a'])},
          'Ready for API Validation'
        )
      `,
      sql`
        select upsert_niche_cluster(
          ${canonicalKey},
          'Batter / Pancake Dispenser',
          'Batter / Pancake Dispenser',
          ${sql.json(['beta'])},
          ${sql.json(['phrase-b'])},
          'Ready for API Validation'
        )
      `
    ]);

    const rows = await sql<{ aliases: unknown; catalog_phrases: unknown }[]>`
      select aliases, catalog_phrases
      from niche_clusters
      where canonical_key = ${canonicalKey}
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.aliases).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(rows[0]?.catalog_phrases).toEqual(
      expect.arrayContaining(['phrase-a', 'phrase-b'])
    );
  });

  it('rolls back provider config and secret when a later model write fails', async () => {
    const providerId = await seedProvider();
    await sql`
      insert into provider_secrets (provider_id, ciphertext, iv, auth_tag, last4)
      values (${providerId}, 'old-cipher', 'old-iv', 'old-tag', 'old4')
    `;
    await sql`
      update ai_providers
      set config = '{"baseUrl":"https://old.example/v1"}'::jsonb
      where id = ${providerId}
    `;

    await expect(
      sql`
        select save_ai_provider_settings(
          jsonb_build_object(
            'id', ${providerId},
            'name', ${providerId},
            'kind', 'openai_http',
            'billing_type', 'subscription',
            'enabled', true,
            'priority', 10,
            'config', jsonb_build_object('baseUrl', 'https://new.example/v1')
          ),
          jsonb_build_object(
            'ciphertext', 'new-cipher',
            'iv', 'new-iv',
            'auth_tag', 'new-tag',
            'last4', 'new4'
          ),
          jsonb_build_array(
            jsonb_build_object(
              'model_id', 'broken-model',
              'display_name', 'broken-model',
              'capabilities', '[]'::jsonb,
              'billing_type', 'not-a-billing-type'
            )
          ),
          'manual'
        )
      `
    ).rejects.toThrow();

    const [provider] = await sql<{ config: unknown }[]>`
      select config from ai_providers where id = ${providerId}
    `;
    const [secret] = await sql<{ ciphertext: string; last4: string }[]>`
      select ciphertext, last4 from provider_secrets where provider_id = ${providerId}
    `;
    const models = await sql<{ model_id: string }[]>`
      select model_id from ai_models where provider_id = ${providerId}
    `;

    expect(provider?.config).toEqual({ baseUrl: 'https://old.example/v1' });
    expect(secret).toEqual({ ciphertext: 'old-cipher', last4: 'old4' });
    expect(models).toEqual([]);
  });

  it('lets only the current analysis owner renew the lease', async () => {
    const providerId = await seedProvider();
    const hash = 'b'.repeat(64);
    const claimed = await sql<{ analysis_id: string }[]>`
      select analysis_id from claim_ai_analysis(
        'niche_normalization',
        ${hash},
        'worker-a',
        30,
        ${providerId},
        'model-1',
        'ko',
        'v1',
        '{}'::jsonb
      )
    `;
    const analysisId = claimed[0]?.analysis_id;
    if (!analysisId) {
      throw new Error('Expected claimed analysis');
    }
    const [owner] = await sql<{ result: boolean }[]>`
      select renew_ai_analysis_lease(${analysisId}::uuid, 'worker-a', 30) as result
    `;
    const [other] = await sql<{ result: boolean }[]>`
      select renew_ai_analysis_lease(${analysisId}::uuid, 'worker-b', 30) as result
    `;
    expect(owner?.result).toBe(true);
    expect(other?.result).toBe(false);
  });

  it('disables obsolete manual models and preserves priority on edit', async () => {
    const providerId = await seedProvider();
    await sql`
      select save_ai_provider_settings(
        jsonb_build_object(
          'id', ${providerId},
          'name', ${providerId},
          'kind', 'command',
          'billing_type', 'free',
          'enabled', true,
          'priority', 7,
          'config', '{}'::jsonb
        ),
        null,
        jsonb_build_array(
          jsonb_build_object(
            'model_id', 'old-model',
            'display_name', 'old-model',
            'capabilities', '["structured_json"]'::jsonb,
            'billing_type', 'free',
            'enabled', true,
            'priority', 3,
            'origin', 'manual'
          )
        ),
        'manual'
      )
    `;
    await sql`
      select save_ai_provider_settings(
        jsonb_build_object(
          'id', ${providerId},
          'name', ${providerId},
          'kind', 'command',
          'billing_type', 'free',
          'enabled', true,
          'priority', 7,
          'config', '{}'::jsonb
        ),
        null,
        jsonb_build_array(
          jsonb_build_object(
            'model_id', 'new-model',
            'display_name', 'new-model',
            'capabilities', '["structured_json"]'::jsonb,
            'billing_type', 'free',
            'enabled', true,
            'priority', 4,
            'origin', 'manual'
          )
        ),
        'manual'
      )
    `;
    const models = await sql<{ model_id: string; enabled: boolean; priority: number }[]>`
      select model_id, enabled, priority from ai_models where provider_id = ${providerId}
      order by model_id
    `;
    const [provider] = await sql<{ priority: number }[]>`
      select priority from ai_providers where id = ${providerId}
    `;
    expect(provider?.priority).toBe(7);
    expect(models).toEqual([
      { model_id: 'new-model', enabled: true, priority: 4 },
      { model_id: 'old-model', enabled: false, priority: 3 }
    ]);
  });

  it('rate-limits admin login attempts in postgres', async () => {
    await sql`update admin_login_guard set attempts = 0, scrypt_inflight = false, window_started_at = now() where bucket = 'admin-login'`;
    const allowed = await sql<{ result: boolean }[]>`
      select consume_admin_login_attempt(2, 300) as result
    `;
    const second = await sql<{ result: boolean }[]>`
      select consume_admin_login_attempt(2, 300) as result
    `;
    const blocked = await sql<{ result: boolean }[]>`
      select consume_admin_login_attempt(2, 300) as result
    `;
    expect(allowed[0]?.result).toBe(true);
    expect(second[0]?.result).toBe(true);
    expect(blocked[0]?.result).toBe(false);
  });
});
