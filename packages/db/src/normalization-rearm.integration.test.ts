import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertDatabaseIdentifier,
  assertRunId,
  createDatabase,
  dropDatabase as dropHarnessDatabase,
  withGlobalDdlLock,
} from '../../../test-harness/harness-boundaries.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const harnessRunId = process.env.ARA_TEST_RUN_ID === undefined
  ? undefined
  : assertRunId(process.env.ARA_TEST_RUN_ID);
const deferDatabaseCleanup = harnessRunId !== undefined;
const admin = postgres(databaseUrl, { max: 1 });
const migrationsDirectory = resolve(import.meta.dirname, '../../../supabase/migrations');
const databases: string[] = [];

async function provisionThrough021() {
  return withGlobalDdlLock(admin, async () => {
    const name = assertDatabaseIdentifier(
      `${harnessRunId ?? 'normalization_rearm'}_normalization_rearm_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    );
    databases.push(name);
    await createDatabase(admin, name);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    const sql = postgres(url.toString(), { max: 4 });
    try {
      await sql.unsafe('create schema extensions');
      await sql.unsafe(`
        create schema storage;
        create table storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
      `);
      await sql.unsafe(`
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        end $$;
        grant service_role, anon, authenticated to current_user;
        alter default privileges in schema public grant all on tables to service_role;
      `);
      const files = (await readdir(migrationsDirectory))
        .filter((file) => file.endsWith('.sql') && file <= '202608290021_provider_attempt_transactions.sql')
        .sort();
      for (const file of files) {
        await sql.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
      }
      return sql;
    } catch (error) {
      await sql.end();
      throw error;
    }
  });
}

async function apply022(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql.unsafe(await readFile(
    resolve(migrationsDirectory, '202608290022_rearm_normalization_generation.sql'),
    'utf8'
  ));
}

async function seedCandidate(
  sql: ReturnType<typeof postgres>,
  state: 'AI Screening' | 'Waiting for AI Capacity' = 'AI Screening'
): Promise<string> {
  const suffix = randomUUID();
  const importRunId = randomUUID();
  const candidateId = randomUUID();
  await sql`insert into import_runs (id, submission_hash) values (${importRunId}, ${suffix})`;
  await sql`
    insert into candidates (
      id, import_run_id, keyword, normalized_exact_keyword, state,
      rule_passed, eligible_for_ai_normalization, normalization_generation
    ) values (
      ${candidateId}, ${importRunId}, 'batter dispenser', ${suffix}, ${state},
      true, true, 0
    )
  `;
  return candidateId;
}

type InvalidCanonicalPrestate = {
  readonly label: string;
  readonly keyGeneration: string;
  readonly payloadGeneration: number;
  readonly candidateGeneration: number;
  readonly expectedError: RegExp;
};

async function expectCanonicalPrestateRejected(fixture: InvalidCanonicalPrestate): Promise<void> {
  const sql = await provisionThrough021();
  const legacyCandidateId = await seedCandidate(sql);
  const canonicalCandidateId = await seedCandidate(sql);
  await sql`
    update candidates set normalization_generation = ${fixture.candidateGeneration}
    where id = ${canonicalCandidateId}
  `;
  await sql`
    insert into jobs (type, payload, status, idempotency_key) values
    (
      'NORMALIZE_OPPORTUNITIES',
      ${sql.json({ candidateIds: [legacyCandidateId], locale: 'ko' })},
      'queued', ${`normalize:${legacyCandidateId}`}
    ),
    (
      'NORMALIZE_OPPORTUNITIES',
      ${sql.json({
        candidateIds: [canonicalCandidateId],
        locale: 'ko',
        normalizationGeneration: fixture.payloadGeneration
      })},
      'queued', ${`normalize:${canonicalCandidateId}:${fixture.keyGeneration}`}
    )
  `;
  const before = await sql<{ idempotency_key: string; payload: unknown }[]>`
    select idempotency_key, payload from jobs
    where idempotency_key like ${`normalize:${legacyCandidateId}%`}
       or idempotency_key like ${`normalize:${canonicalCandidateId}%`}
    order by idempotency_key
  `;

  await expect(apply022(sql)).rejects.toThrow(fixture.expectedError);

  const after = await sql<{ idempotency_key: string; payload: unknown }[]>`
    select idempotency_key, payload from jobs
    where idempotency_key like ${`normalize:${legacyCandidateId}%`}
       or idempotency_key like ${`normalize:${canonicalCandidateId}%`}
    order by idempotency_key
  `;
  expect(after).toEqual(before);
  const [capability] = await sql<{ mode: string }[]>`
    select mode from normalization_writer_capability
  `;
  expect(capability?.mode).toBe('legacy');
  const [migrationColumn] = await sql<{ count: number }[]>`
    select count(*)::integer as count from information_schema.columns
    where table_schema = 'public'
      and table_name = 'normalization_writer_capability'
      and column_name = 'migration_identity'
  `;
  expect(migrationColumn?.count).toBe(0);
  await sql.end();
}


async function seedReadyProvider(sql: ReturnType<typeof postgres>): Promise<{
  readonly providerId: string;
  readonly modelId: string;
}> {
  const suffix = randomUUID();
  const providerId = `provider-${suffix}`;
  const modelId = `model-${suffix}`;
  const fingerprint = `fingerprint-${suffix}`;
  const termsDigest = `terms-${suffix}`;
  const credentialDigest = `credential-${suffix}`;
  const binaryDigest = `binary-${suffix}`;
  const capabilityDigest = `capability-${suffix}`;
  const framingDigest = `framing-${suffix}`;
  const boundedDigest = `bounded-${suffix}`;
  const containmentDigest = `containment-${suffix}`;
  const securityProfileDigest = suffix.replaceAll('-', '').padEnd(64, '0');
  await sql`
    insert into ai_providers (id, name, kind, adapter, billing_type, enabled, config, settings_revision)
    values (${providerId}, ${providerId}, 'subscription_command', 'codex', 'subscription', false, '{}', 1)
  `;
  await sql`
    insert into ai_models (provider_id, model_id, display_name, capabilities, billing_type, enabled)
    values (${providerId}, ${modelId}, ${modelId}, '["structured_json"]', 'subscription', false)
  `;
  await sql`
    select commit_ai_provider_acceptance_probe(
      ${providerId}, ${modelId}, 'codex', 1, 0, ${fingerprint},
      'subscription-isolation-v1', ${securityProfileDigest}, 'ready-lease-v1',
      ${termsDigest}, ${credentialDigest}, ${binaryDigest}, ${capabilityDigest},
      ${framingDigest}, ${boundedDigest}, ${containmentDigest}, '{"verified":true}'::jsonb
    )
  `;
  const [activated] = await sql<{ result: { job_id: string; probe_generation: number } }[]>`
    select activate_subscription_provider(
      ${providerId}, ${modelId}, 1, 0, ${fingerprint}, ${termsDigest}
    ) as result
  `;
  if (!activated) throw new Error('Provider activation returned no row.');
  await sql`
    select commit_ai_provider_probe(
      ${providerId}, ${modelId}, 1, 0, ${fingerprint},
      ${activated.result.probe_generation}, ${termsDigest}, ${securityProfileDigest},
      ${credentialDigest}, ${binaryDigest}, ${capabilityDigest}, ${framingDigest},
      ${boundedDigest}, ${containmentDigest}
    )
  `;
  await sql`update jobs set status = 'completed' where id = ${activated.result.job_id}`;
  return { providerId, modelId };
}
async function dropDatabase(name: string): Promise<void> {
  await withGlobalDdlLock(admin, async () => dropHarnessDatabase(admin, name));
}

afterAll(async () => {
  if (!deferDatabaseCleanup) {
    for (const name of databases) {
      await dropDatabase(name);
    }
  }
  await admin.end();
}, 60_000);

describe('normalization generation cutover', () => {
  // Break: migration creates a second job or loses lifecycle/lease/checkpoint state.
  it('rewrites every legacy lifecycle in place and flips one canonical capability', async () => {
    const sql = await provisionThrough021();
    const statuses = ['queued', 'running', 'completed', 'failed'] as const;
    const rows: { id: string; candidateId: string; status: string }[] = [];
    for (const status of statuses) {
      const candidateId = await seedCandidate(sql);
      const id = randomUUID();
      rows.push({ id, candidateId, status });
      await sql`
        insert into jobs (
          id, type, payload, status, idempotency_key, attempts, checkpoint,
          leased_by, leased_until, last_error
        ) values (
          ${id}, 'NORMALIZE_OPPORTUNITIES',
          ${sql.json({ candidateIds: [candidateId], locale: 'ko' })},
          ${status}, ${`normalize:${candidateId}`}, 3, '{"phase":"kept"}'::jsonb,
          ${status === 'running' ? 'worker-a' : null},
          ${status === 'running' ? new Date(Date.now() + 60_000) : null},
          ${status === 'failed' ? 'kept failure' : null}
        )
      `;
    }

    await apply022(sql);

    const jobs = await sql<{
      id: string; status: string; idempotency_key: string; payload: unknown;
      attempts: number; checkpoint: unknown; leased_by: string | null; last_error: string | null;
    }[]>`select id, status, idempotency_key, payload, attempts, checkpoint, leased_by, last_error from jobs order by id`;
    for (const seeded of rows) {
      const job = jobs.find(({ id }) => id === seeded.id);
      expect(job).toMatchObject({
        id: seeded.id,
        status: seeded.status,
        idempotency_key: `normalize:${seeded.candidateId}:0`,
        payload: { candidateIds: [seeded.candidateId], locale: 'ko', normalizationGeneration: 0 },
        attempts: 3,
        checkpoint: { phase: 'kept' }
      });
    }
    const [capability] = await sql<{ mode: string; migration_identity: string }[]>`
      select mode, migration_identity from normalization_writer_capability
    `;
    expect(capability).toEqual({ mode: 'canonical', migration_identity: '202608290022' });
    const [projectedCapability] = await sql<{ capability: unknown }[]>`
      select read_normalization_writer_capability() as capability
    `;
    expect(projectedCapability?.capability).toEqual({
      mode: 'canonical',
      migration_identity: '202608290022'
    });
    const [legacy] = await sql<{ count: number }[]>`
      select count(*)::integer as count
      from jobs
      where type = 'NORMALIZE_OPPORTUNITIES'
        and idempotency_key ~ '^normalize:[0-9a-f-]{36}$'
    `;
    expect(legacy?.count).toBe(0);
    await sql.end();
  }, 60_000);

  // Break: a collision partially rewrites jobs or flips capability despite aborting.

  // Break: migration overtakes an in-flight old writer or misses its legacy job.
  it('fences a shared-lock old writer and rewrites its committed job', async () => {
    const sql = await provisionThrough021();
    const candidateId = await seedCandidate(sql);
    let releaseWriter: (() => void) | undefined;
    const writerGate = new Promise<void>((resolveWriter) => {
      releaseWriter = resolveWriter;
    });
    let writerLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolveLocked) => {
      writerLocked = resolveLocked;
    });
    const oldWriter = sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock_shared(7241304022)`;
      writerLocked?.();
      await writerGate;
      await transaction`
        select enqueue_initial_candidate_normalization(${candidateId}, 'ko', 'legacy')
      `;
    });
    await locked;
    const [probe] = await sql<{ acquired: boolean }[]>`
      select pg_try_advisory_xact_lock(7241304022) as acquired
    `;
    expect(probe?.acquired).toBe(false);
    releaseWriter?.();
    await oldWriter;
    await apply022(sql);
    const [job] = await sql<{ idempotency_key: string; payload: unknown }[]>`
      select idempotency_key, payload
      from jobs where idempotency_key = ${`normalize:${candidateId}:0`}
    `;
    expect(job).toEqual({
      idempotency_key: `normalize:${candidateId}:0`,
      payload: { candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 }
    });
    await sql.end();
  }, 60_000);
  it('rolls back the rewrite and capability flip on a legacy/canonical collision', async () => {
    const sql = await provisionThrough021();
    const candidateId = await seedCandidate(sql);
    await sql`
      insert into jobs (type, payload, status, idempotency_key) values
      ('NORMALIZE_OPPORTUNITIES', ${sql.json({ candidateIds: [candidateId], locale: 'ko' })}, 'queued', ${`normalize:${candidateId}`}),
      ('NORMALIZE_OPPORTUNITIES', ${sql.json({ candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 })}, 'queued', ${`normalize:${candidateId}:0`})
    `;
    await expect(apply022(sql)).rejects.toThrow(/normalization_cutover_collision/u);
    const jobs = await sql<{ idempotency_key: string }[]>`
      select idempotency_key from jobs where idempotency_key like ${`normalize:${candidateId}%`} order by idempotency_key
    `;
    expect(jobs.map(({ idempotency_key }) => idempotency_key)).toEqual([
      `normalize:${candidateId}`,
      `normalize:${candidateId}:0`
    ]);
    const [capability] = await sql<{ mode: string }[]>`select mode from normalization_writer_capability`;
    expect(capability?.mode).toBe('legacy');
    await sql.end();
  }, 60_000);

  // Break: duplicate rearm callers increment twice, rearm without Ready evidence, or mutate candidate before insert.
  it('atomically rearms one Waiting generation only with current routability', async () => {
    const sql = await provisionThrough021();
    await apply022(sql);
    const candidateId = await seedCandidate(sql, 'Waiting for AI Capacity');
    await seedReadyProvider(sql);
    const [first] = await sql<{ result: { job_id: string; idempotency_key: string; normalization_generation: number } }[]>`
      select rearm_candidate_normalization(${candidateId}, 'Waiting for AI Capacity', 0, 'ko') as result
    `;
    const [second] = await sql<{ result: { job_id: string; idempotency_key: string; normalization_generation: number } }[]>`
      select rearm_candidate_normalization(${candidateId}, 'Waiting for AI Capacity', 0, 'ko') as result
    `;
    expect(second?.result).toEqual(first?.result);
    expect(first?.result).toMatchObject({
      idempotency_key: `normalize:${candidateId}:1`,
      normalization_generation: 1
    });
    const [candidate] = await sql<{ state: string; normalization_generation: number }[]>`
      select state, normalization_generation::integer as normalization_generation
      from candidates where id = ${candidateId}
    `;
    expect(candidate).toEqual({ state: 'Waiting for AI Capacity', normalization_generation: 1 });
    await sql.end();
  }, 60_000);

  // Break: malformed legacy payloads partially rewrite or flip capability.
  it('rolls back malformed legacy payloads without flipping capability', async () => {
    const sql = await provisionThrough021();
    const candidateId = await seedCandidate(sql);
    await sql`
      insert into jobs (type, payload, status, idempotency_key)
      values (
        'NORMALIZE_OPPORTUNITIES',
        ${sql.json({ candidateIds: [randomUUID()], locale: 'ko' })},
        'queued', ${`normalize:${candidateId}`}
      )
    `;
    await expect(apply022(sql)).rejects.toThrow(/legacy_payload_rejected/u);
    const [capability] = await sql<{ mode: string }[]>`
      select mode from normalization_writer_capability
    `;
    expect(capability?.mode).toBe('legacy');
    await sql.end();
  }, 60_000);

  // Break: migration 022 accepts post-cutover generations or inconsistent canonical generation state.
  it.each([
    {
      label: 'future generation one',
      keyGeneration: '1',
      payloadGeneration: 1,
      candidateGeneration: 0,
      expectedError: /canonical_payload_rejected/u
    },
    {
      label: 'future generation seven',
      keyGeneration: '7',
      payloadGeneration: 7,
      candidateGeneration: 0,
      expectedError: /canonical_payload_rejected/u
    },
    {
      label: 'candidate generation mismatch',
      keyGeneration: '0',
      payloadGeneration: 0,
      candidateGeneration: 1,
      expectedError: /canonical_payload_rejected/u
    },
    {
      label: 'key and payload mismatch',
      keyGeneration: '0',
      payloadGeneration: 1,
      candidateGeneration: 0,
      expectedError: /canonical_payload_rejected/u
    },
    {
      label: 'negative generation',
      keyGeneration: '-1',
      payloadGeneration: -1,
      candidateGeneration: 0,
      expectedError: /normalization_cutover_malformed/u
    },
    {
      label: 'fractional generation',
      keyGeneration: '0',
      payloadGeneration: 0.5,
      candidateGeneration: 0,
      expectedError: /canonical_payload_rejected/u
    },
    {
      label: 'unsafe integer generation',
      keyGeneration: '9007199254740992',
      payloadGeneration: 9_007_199_254_740_992,
      candidateGeneration: 0,
      expectedError: /canonical_payload_rejected/u
    }
  ] satisfies readonly InvalidCanonicalPrestate[])(
    'rejects canonical prestate: $label',
    expectCanonicalPrestateRejected,
    60_000
  );

  // Break: exact canonical generation zero is rejected along with malformed prestates.
  it('accepts exact canonical generation zero when candidate state agrees', async () => {
    const sql = await provisionThrough021();
    const candidateId = await seedCandidate(sql);
    await sql`
      insert into jobs (type, payload, status, idempotency_key)
      values (
        'NORMALIZE_OPPORTUNITIES',
        ${sql.json({ candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 })},
        'queued', ${`normalize:${candidateId}:0`}
      )
    `;
    await expect(apply022(sql)).resolves.toBeUndefined();
    const [capability] = await sql<{ mode: string; migration_identity: string }[]>`
      select mode, migration_identity from normalization_writer_capability
    `;
    expect(capability).toEqual({ mode: 'canonical', migration_identity: '202608290022' });
    await sql.end();
  }, 60_000);


  // Break: no Ready provider, ineligibility, or an advanced state consumes a generation.
  it('rejects unavailable providers and ineligible or advanced candidates', async () => {
    const sql = await provisionThrough021();
    await apply022(sql);
    const waitingId = await seedCandidate(sql, 'Waiting for AI Capacity');
    await expect(sql`
      select rearm_candidate_normalization(${waitingId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/provider_unavailable/u);
    await sql`
      update candidates
      set eligible_for_ai_normalization = false
      where id = ${waitingId}
    `;
    await seedReadyProvider(sql);
    await expect(sql`
      select rearm_candidate_normalization(${waitingId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/candidate_rejected/u);
    await sql`
      update candidates
      set eligible_for_ai_normalization = true, state = 'Ready for API Validation'
      where id = ${waitingId}
    `;
    await expect(sql`
      select rearm_candidate_normalization(${waitingId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/candidate_rejected/u);
    const [candidate] = await sql<{ generation: number }[]>`
      select normalization_generation::integer as generation
      from candidates where id = ${waitingId}
    `;
    expect(candidate?.generation).toBe(0);
    await sql.end();
  }, 60_000);

  // Break: active job or analysis ownership is bypassed during rearm.
  it('rejects active generation ownership', async () => {
    const sql = await provisionThrough021();
    await apply022(sql);
    await seedReadyProvider(sql);
    const candidateId = await seedCandidate(sql, 'Waiting for AI Capacity');
    await sql`
      insert into jobs (type, payload, status, idempotency_key)
      values (
        'NORMALIZE_OPPORTUNITIES',
        ${sql.json({ candidateIds: [candidateId], locale: 'ko', normalizationGeneration: 0 })},
        'queued', ${`active:${candidateId}`}
      )
    `;
    await expect(sql`
      select rearm_candidate_normalization(${candidateId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/active_job/u);
    await sql`delete from jobs where idempotency_key = ${`active:${candidateId}`}`;
    const [readyProvider] = await sql<{ provider_id: string; model_id: string }[]>`
      select p.id as provider_id, m.model_id
      from ai_providers p join ai_models m on m.provider_id = p.id
      where p.enabled order by p.id limit 1
    `;
    if (!readyProvider) throw new Error('Ready provider fixture was not found.');
    const { provider_id: providerId, model_id: modelId } = readyProvider;
    await sql`
      insert into ai_analyses (
        provider_id, model_id, role, locale, entity_type, entity_id, input_hash,
        input_payload, cost_class, prompt_version, status, started_at, leased_by, leased_until
      ) values (
        ${providerId}, ${modelId}, 'niche_normalization', 'ko', 'candidate', ${candidateId},
        ${randomUUID().replaceAll('-', '')},
        ${sql.json({ candidateId, normalizationGeneration: 0 })},
        'subscription', 'test', 'pending', clock_timestamp(), 'worker-a',
        clock_timestamp() + interval '1 minute'
      )
    `;
    await expect(sql`
      select rearm_candidate_normalization(${candidateId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/active_analysis/u);
    await sql.end();
  }, 60_000);

  // Break: concurrent callers create two jobs, or insert failure consumes generation.
  it('converges concurrent callers and rolls back a failed insert', async () => {
    const sql = await provisionThrough021();
    await apply022(sql);
    await seedReadyProvider(sql);
    const candidateId = await seedCandidate(sql, 'Waiting for AI Capacity');
    const calls = await Promise.all([1, 2].map(async () => {
      const [row] = await sql<{ result: { job_id: string } }[]>`
        select rearm_candidate_normalization(
          ${candidateId}, 'Waiting for AI Capacity', 0, 'ko'
        ) as result
      `;
      return row?.result;
    }));
    expect(calls[0]).toEqual(calls[1]);
    const failedId = await seedCandidate(sql, 'Waiting for AI Capacity');
    await sql`
      insert into jobs (type, payload, status, idempotency_key)
      values ('SEND_DIGEST', '{}', 'queued', ${`normalize:${failedId}:1`})
    `;
    await expect(sql`
      select rearm_candidate_normalization(${failedId}, 'Waiting for AI Capacity', 0, 'ko')
    `).rejects.toThrow(/unique constraint/u);
    const [failedCandidate] = await sql<{ generation: number }[]>`
      select normalization_generation::integer as generation from candidates where id = ${failedId}
    `;
    expect(failedCandidate?.generation).toBe(0);
    await sql.end();
  }, 60_000);
});
