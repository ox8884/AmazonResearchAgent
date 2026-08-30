import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const admin = postgres(databaseUrl, { max: 1 });
const databaseName = `provider_runtime_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${databaseName}`;
const sql = postgres(testUrl.toString(), { max: 4 });
const migrationsDirectory = resolve(import.meta.dirname, '../../../supabase/migrations');

const securityProfile = 'subscription-isolation-v1';
const readinessPolicy = 'ready-lease-v1';

type Evidence = {
  readonly securityProfileDigest: string;
  readonly termsDigest: string;
  readonly credentialSourceDigest: string;
  readonly binaryIdentityDigest: string;
  readonly capabilityDigest: string;
  readonly framingDigest: string;
  readonly boundedBehaviorDigest: string;
  readonly containmentDigest: string;
};

type Fixture = {
  readonly providerId: string;
  readonly modelId: string;
  readonly settingsRevision: number;
  readonly authGeneration: number;
  readonly fingerprint: string;
  readonly termsDigest: string;
  readonly evidence: Evidence;
};

async function seedAcceptedProvider(adapter: 'codex' | 'grok' = 'codex'): Promise<Fixture> {
  const suffix = randomUUID();
  const providerId = `${adapter}-${suffix}`;
  const modelId = `model-${suffix}`;
  const fingerprint = `fingerprint-${suffix}`;
  const termsDigest = `terms-${suffix}`;
  const evidence = {
    securityProfileDigest: suffix.replaceAll('-', '').padEnd(64, '0'),
    termsDigest,
    credentialSourceDigest: `credential-${suffix}`,
    binaryIdentityDigest: `binary-${suffix}`,
    capabilityDigest: `capability-${suffix}`,
    framingDigest: `framing-${suffix}`,
    boundedBehaviorDigest: `bounded-${suffix}`,
    containmentDigest: `containment-${suffix}`
  };
  await sql`
    insert into ai_providers (
      id, name, kind, adapter, billing_type, enabled, config, settings_revision
    ) values (
      ${providerId}, ${providerId}, 'subscription_command', ${adapter},
      'subscription', false, '{}'::jsonb, 1
    )
  `;
  await sql`
    insert into ai_models (
      provider_id, model_id, display_name, capabilities, billing_type, enabled
    ) values (
      ${providerId}, ${modelId}, ${modelId}, '["structured_json"]'::jsonb,
      'subscription', false
    )
  `;
  await sql`
    select commit_ai_provider_acceptance_probe(
      ${providerId}, ${modelId}, ${adapter}, 1, 0, ${fingerprint},
      ${securityProfile}, ${evidence.securityProfileDigest}, ${readinessPolicy},
      ${evidence.termsDigest}, ${evidence.credentialSourceDigest},
      ${evidence.binaryIdentityDigest}, ${evidence.capabilityDigest},
      ${evidence.framingDigest}, ${evidence.boundedBehaviorDigest},
      ${evidence.containmentDigest}, '{"verified":true}'::jsonb
    )
  `;
  return {
    providerId,
    modelId,
    settingsRevision: 1,
    authGeneration: 0,
    fingerprint,
    termsDigest,
    evidence
  };
}

async function activate(fixture: Fixture): Promise<{ job_id: string; probe_generation: number }> {
  const [row] = await sql<{ result: { job_id: string; probe_generation: number } }[]>`
    select activate_subscription_provider(
      ${fixture.providerId}, ${fixture.modelId}, ${fixture.settingsRevision},
      ${fixture.authGeneration}, ${fixture.fingerprint}, ${fixture.termsDigest}
    ) as result
  `;
  if (!row) throw new Error('Activation returned no result.');
  return row.result;
}

async function commitReady(fixture: Fixture, generation: number): Promise<void> {
  await sql`
    select commit_ai_provider_probe(
      ${fixture.providerId}, ${fixture.modelId}, ${fixture.settingsRevision},
      ${fixture.authGeneration}, ${fixture.fingerprint}, ${generation},
      ${fixture.evidence.termsDigest}, ${fixture.evidence.securityProfileDigest},
      ${fixture.evidence.credentialSourceDigest}, ${fixture.evidence.binaryIdentityDigest},
      ${fixture.evidence.capabilityDigest}, ${fixture.evidence.framingDigest},
      ${fixture.evidence.boundedBehaviorDigest}, ${fixture.evidence.containmentDigest}
    )
  `;
}

type RuntimeFailureAttempt = {
  readonly attemptId: string;
  readonly jobId: string;
  readonly jobLeaseOwner: string;
  readonly jobLeaseEpoch: number;
  readonly analysisId: string;
  readonly analysisLeaseOwner: string;
  readonly analysisLeaseEpoch: number;
};

async function seedRuntimeFailureAttempt(
  fixture: Fixture,
  probeGeneration: number,
  failureClass: string,
): Promise<RuntimeFailureAttempt> {
  const attemptId = randomUUID();
  const jobId = randomUUID();
  const analysisId = randomUUID();
  const jobLeaseOwner = 'worker-a';
  const analysisLeaseOwner = 'analysis-worker-a';
  const jobLeaseEpoch = 1;
  const analysisLeaseEpoch = 1;
  const isCancelled = failureClass.startsWith('cancelled_');
  const consumptionStatus = failureClass === 'schema_invalid_output' ||
      failureClass === 'business_validation_failure'
    ? 'consumed'
    : 'unknown';
  await sql`
    insert into jobs (
      id, type, payload, status, leased_until, leased_by, attempts, idempotency_key
    ) values (
      ${jobId}, 'NORMALIZE_OPPORTUNITIES', '{}'::jsonb, 'running',
      clock_timestamp() + interval '2 minutes', ${jobLeaseOwner}, ${jobLeaseEpoch},
      ${`runtime-failure:${attemptId}`}
    )
  `;
  await sql`
    insert into ai_analyses (
      id, provider_id, model_id, role, locale, entity_type, entity_id,
      input_hash, input_payload, output, usage, cost_class, prompt_version,
      status, started_at, completed_at, leased_by, leased_until, attempts
    ) values (
      ${analysisId}, ${fixture.providerId}, ${fixture.modelId},
      'niche_normalization', 'ko', 'analysis_claim', ${randomUUID()}::uuid,
      ${`runtime-failure:${attemptId}`}, '{}'::jsonb, null, '{}'::jsonb,
      'subscription', 'niche-normalization-v1', 'pending', clock_timestamp(), null,
      ${analysisLeaseOwner}, clock_timestamp() + interval '2 minutes',
      ${analysisLeaseEpoch}
    )
  `;
  await sql`
    insert into provider_attempt_events (
      attempt_id, logical_analysis_id, attempt_sequence, event_type,
      provider_id, model_id, adapter, role, billing_type,
      settings_revision, auth_generation, execution_fingerprint, probe_generation,
      request_count, job_id, job_lease_owner, job_lease_epoch,
      analysis_lease_owner, analysis_lease_epoch
    ) values (
      ${attemptId}, ${analysisId}, 1, 'attempt_started',
      ${fixture.providerId}, ${fixture.modelId}, 'codex', 'niche_normalization',
      'subscription', ${fixture.settingsRevision}, ${fixture.authGeneration},
      ${fixture.fingerprint}, ${probeGeneration}, 1, ${jobId}, ${jobLeaseOwner},
      ${jobLeaseEpoch}, ${analysisLeaseOwner}, ${analysisLeaseEpoch}
    )
  `;
  await sql`
    insert into provider_attempt_events (
      attempt_id, logical_analysis_id, attempt_sequence, event_type,
      provider_id, model_id, adapter, role, billing_type,
      settings_revision, auth_generation, execution_fingerprint, probe_generation,
      request_count, job_id, job_lease_owner, job_lease_epoch,
      analysis_lease_owner, analysis_lease_epoch, consumption_status,
      result_class, finished_at
    ) values (
      ${attemptId}, ${analysisId}, 1,
      ${isCancelled ? 'attempt_cancelled' : 'attempt_failed'},
      ${fixture.providerId}, ${fixture.modelId}, 'codex', 'niche_normalization',
      'subscription', ${fixture.settingsRevision}, ${fixture.authGeneration},
      ${fixture.fingerprint}, ${probeGeneration}, 1, ${jobId}, ${jobLeaseOwner},
      ${jobLeaseEpoch}, ${analysisLeaseOwner}, ${analysisLeaseEpoch},
      ${consumptionStatus}, ${failureClass}, clock_timestamp()
    )
  `;
  return {
    attemptId,
    jobId,
    jobLeaseOwner,
    jobLeaseEpoch,
    analysisId,
    analysisLeaseOwner,
    analysisLeaseEpoch,
  };
}

async function applyRuntimeFailure(
  attempt: RuntimeFailureAttempt,
  failureClass: string,
  retryAfterSeconds: number,
) {
  const [row] = await sql<{
    result: { mutated: boolean; allow_fallback: boolean; allow_replay: boolean };
  }[]>`
    select apply_ai_provider_runtime_failure(
      ${attempt.attemptId},
      ${attempt.jobId}, ${attempt.jobLeaseOwner}, ${attempt.jobLeaseEpoch},
      ${attempt.analysisId}, ${attempt.analysisLeaseOwner}, ${attempt.analysisLeaseEpoch},
      ${failureClass}, ${retryAfterSeconds}
    ) as result
  `;
  if (!row) throw new Error('Runtime failure mutation returned no result.');
  return row.result;
}

beforeAll(async () => {
  await admin.unsafe(`create database ${databaseName}`);
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
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql') && file <= '202608290020_subscription_ai_runtime_cas.sql')
    .sort();
  for (const file of files) {
    await sql.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
  await sql.unsafe('drop index ai_providers_subscription_adapter_unique');
}, 60_000);

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`drop database if exists ${databaseName} with (force)`);
  await admin.end();
});

describe('subscription provider runtime CAS', () => {
  it('records acceptance while disabled and activation requests one fresh probe', async () => {
    const fixture = await seedAcceptedProvider();
    const [before] = await sql<{ enabled: boolean; available: boolean; state: string }[]>`
      select p.enabled, r.available, r.state
      from ai_providers p join ai_provider_runtime_state r on r.provider_id = p.id
      where p.id = ${fixture.providerId}
    `;
    expect(before).toEqual({ enabled: false, available: false, state: 'authorization_required' });

    const first = await activate(fixture);
    const [deduped] = await sql<{ result: typeof first }[]>`
      select request_ai_provider_probe(
        ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
      ) as result
    `;
    expect(first.probe_generation).toBe(1);
    expect(deduped?.result).toEqual(first);

    await sql`update jobs set status = 'completed' where id = ${first.job_id}`;
    const [second] = await sql<{ result: typeof first }[]>`
      select request_ai_provider_probe(
        ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
      ) as result
    `;
    expect(second?.result.probe_generation).toBe(2);
    expect(second?.result.job_id).not.toBe(first.job_id);
  });

  it('issues exactly ten minutes from the database clock and is strict at expiry', async () => {
    const fixture = await seedAcceptedProvider('grok');
    const request = await activate(fixture);
    await commitReady(fixture, request.probe_generation);
    const [lease] = await sql<{
      lease_seconds: number;
      routable_before: boolean;
    }[]>`
      select
        extract(epoch from (ready_valid_until - checked_at))::integer as lease_seconds,
        is_ai_provider_routable(
          ${fixture.providerId}, ${fixture.modelId}, 1, 0, ${fixture.fingerprint}
        ) as routable_before
      from ai_provider_runtime_state where provider_id = ${fixture.providerId}
    `;
    expect(lease).toEqual({ lease_seconds: 600, routable_before: true });

    await sql`
      update ai_provider_runtime_state
      set ready_valid_until = clock_timestamp()
      where provider_id = ${fixture.providerId}
    `;
    const [expired] = await sql<{ result: boolean }[]>`
      select is_ai_provider_routable(
        ${fixture.providerId}, ${fixture.modelId}, 1, 0, ${fixture.fingerprint}
      ) as result
    `;
    expect(expired?.result).toBe(false);
  });

  it('rejects stale settings, auth, fingerprint, and probe-generation writes', async () => {
    const fixture = await seedAcceptedProvider();
    const request = await activate(fixture);
    for (const values of [
      [2, 0, fixture.fingerprint, request.probe_generation],
      [1, 1, fixture.fingerprint, request.probe_generation],
      [1, 0, 'stale-fingerprint', request.probe_generation],
      [1, 0, fixture.fingerprint, request.probe_generation + 1]
    ] as const) {
      await expect(sql`
        select commit_ai_provider_probe(
          ${fixture.providerId}, ${fixture.modelId}, ${values[0]}, ${values[1]},
          ${values[2]}, ${values[3]},
          ${fixture.evidence.termsDigest}, ${fixture.evidence.securityProfileDigest},
          ${fixture.evidence.credentialSourceDigest}, ${fixture.evidence.binaryIdentityDigest},
          ${fixture.evidence.capabilityDigest}, ${fixture.evidence.framingDigest},
          ${fixture.evidence.boundedBehaviorDigest}, ${fixture.evidence.containmentDigest}
        )
      `).rejects.toThrow(/provider_probe_cas_conflict/);
    }
    await commitReady(fixture, request.probe_generation);
  });

  // Break: stale fresh evidence can install a Ready lease while accepted bindings stay unchanged.
  it('requires exact fresh evidence inside the Ready transaction', async () => {
    const fixture = await seedAcceptedProvider();
    const request = await activate(fixture);
    const commit = (evidence: Evidence) => sql`
      select commit_ai_provider_probe(
        ${fixture.providerId}, ${fixture.modelId}, ${fixture.settingsRevision},
        ${fixture.authGeneration}, ${fixture.fingerprint}, ${request.probe_generation},
        ${evidence.termsDigest}, ${evidence.securityProfileDigest},
        ${evidence.credentialSourceDigest}, ${evidence.binaryIdentityDigest},
        ${evidence.capabilityDigest}, ${evidence.framingDigest},
        ${evidence.boundedBehaviorDigest}, ${evidence.containmentDigest}
      )
    `;
    const [acceptedRuntime] = await sql<{
      capability_attestation_id: string;
      containment_attestation_id: string;
    }[]>`
      select capability_attestation_id, containment_attestation_id
      from ai_provider_runtime_state where provider_id = ${fixture.providerId}
    `;
    for (const drift of [
      { securityProfileDigest: '0'.repeat(64) },
      { termsDigest: 'terms-drift' },
      { binaryIdentityDigest: 'binary-drift' },
      { credentialSourceDigest: 'credential-drift' },
      { capabilityDigest: 'capability-drift' },
      { containmentDigest: 'containment-drift' },
      { framingDigest: 'framing-drift' },
      { boundedBehaviorDigest: 'bounded-drift' }
    ]) {
      await expect(commit({ ...fixture.evidence, ...drift })).rejects.toThrow(
        /provider_probe_evidence_mismatch/
      );
      const [runtime] = await sql<{
        state: string;
        available: boolean;
        ready_valid_until: string | null;
        capability_attestation_id: string;
        containment_attestation_id: string;
      }[]>`
        select state, available, ready_valid_until,
          capability_attestation_id, containment_attestation_id
        from ai_provider_runtime_state where provider_id = ${fixture.providerId}
      `;
      expect(runtime).toEqual({
        state: 'authorization_required',
        available: false,
        ready_valid_until: null,
        capability_attestation_id: acceptedRuntime?.capability_attestation_id,
        containment_attestation_id: acceptedRuntime?.containment_attestation_id
      });
    }
    await expect(commit(fixture.evidence)).resolves.toBeDefined();
  });

  it('deactivation and auth fencing invalidate routing and probe ownership', async () => {
    const fixture = await seedAcceptedProvider();
    const request = await activate(fixture);
    await commitReady(fixture, request.probe_generation);
    await sql`
      select fence_ai_provider_auth(
        ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
      )
    `;
    const [fenced] = await sql<{
      auth_generation: number;
      available: boolean;
      ready_valid_until: string | null;
      current_probe_job_id: string | null;
    }[]>`
      select auth_generation::integer as auth_generation, available,
        ready_valid_until, current_probe_job_id
      from ai_provider_runtime_state where provider_id = ${fixture.providerId}
    `;
    expect(fenced).toEqual({
      auth_generation: 1,
      available: false,
      ready_valid_until: null,
      current_probe_job_id: null
    });

    await sql`select deactivate_subscription_provider(${fixture.providerId})`;
    const [provider] = await sql<{ enabled: boolean }[]>`
      select enabled from ai_providers where id = ${fixture.providerId}
    `;
    expect(provider?.enabled).toBe(false);
  });

  it.each([
    ['auth_expired', true, false, 'expired', 'auth_expired'],
    ['credential_source_mismatch', false, false, 'needs_attention', 'credential_source_mismatch'],
    ['binary_identity_mismatch', false, false, 'needs_attention', 'binary_identity_mismatch'],
    ['profile_mismatch', false, false, 'needs_attention', 'profile_mismatch'],
    ['containment_failure', false, false, 'needs_attention', 'containment_failure'],
    ['capability_failure', false, false, 'needs_attention', 'capability_failure'],
    ['capacity_exhausted', true, false, 'ready', 'temporary_capacity'],
    ['rate_limited', true, false, 'ready', 'temporary_capacity'],
    ['transient_network', true, false, 'ready', 'transient_client_failure'],
    ['client_transient', true, false, 'ready', 'transient_client_failure'],
    ['timeout', true, false, 'ready', 'transient_client_failure'],
    ['cancelled_by_caller', false, false, 'ready', null],
    ['cancelled_by_job_lease_loss', false, false, 'ready', null],
    ['cancelled_by_shutdown', false, false, 'ready', null],
    ['unsafe_unknown', false, false, 'needs_attention', 'unsafe_unknown'],
    ['schema_invalid_output', false, false, 'ready', null],
    ['business_validation_failure', false, false, 'ready', null]
  ] as const)(
    'applies canonical failure row %s',
    async (failureClass, allowFallback, allowReplay, state, reason) => {
      const fixture = await seedAcceptedProvider();
      const request = await activate(fixture);
      await commitReady(fixture, request.probe_generation);
      const attempt = await seedRuntimeFailureAttempt(
        fixture,
        request.probe_generation,
        failureClass,
      );
      const outcome = await applyRuntimeFailure(attempt, failureClass, 47);
      const [runtime] = await sql<{ state: string; reason: string | null }[]>`
        select state, reason from ai_provider_runtime_state
        where provider_id = ${fixture.providerId}
      `;
      expect(outcome.allow_fallback).toBe(allowFallback);
      expect(outcome.allow_replay).toBe(allowReplay);
      expect(runtime).toMatchObject({ state, reason });
    }
  );

  it('rejects direct subscription provider and model enable writes', async () => {
    const fixture = await seedAcceptedProvider();
    await expect(sql`
      update ai_providers set enabled = true where id = ${fixture.providerId}
    `).rejects.toThrow(/subscription_provider_requires_activation/);
    await expect(sql`
      update ai_models set enabled = true
      where provider_id = ${fixture.providerId} and model_id = ${fixture.modelId}
    `).rejects.toThrow(/subscription_model_requires_capability/);
  });

  it('keeps the legacy config probe explicit to HTTP providers', async () => {
    const fixture = await seedAcceptedProvider();
    const [subscription] = await sql<{ result: boolean }[]>`
      select record_ai_provider_execution_probe(
        ${fixture.providerId}, ${fixture.fingerprint}, '{"available":true}'::jsonb
      ) as result
    `;
    expect(subscription?.result).toBe(false);
    const httpId = `http-${randomUUID()}`;
    await sql`
      insert into ai_providers (
        id, name, kind, billing_type, enabled, config
      ) values (
        ${httpId}, ${httpId}, 'openai_http', 'free', true,
        '{"executionIdentity":"http-fingerprint"}'::jsonb
      )
    `;
    const [http] = await sql<{ result: boolean }[]>`
      select record_ai_provider_execution_probe(
        ${httpId}, 'http-fingerprint', '{"available":true}'::jsonb
      ) as result
    `;
    expect(http?.result).toBe(true);
  });

  it('deduplicates concurrent expiry observers and never restores Ready by time passage', async () => {
    const fixture = await seedAcceptedProvider();
    const request = await activate(fixture);
    await commitReady(fixture, request.probe_generation);
    await sql`
      update ai_provider_runtime_state set ready_valid_until = clock_timestamp()
      where provider_id = ${fixture.providerId}
    `;
    const results = await Promise.all([
      sql<{ result: { job_id: string; probe_generation: number } | null }[]>`
        select expire_ai_provider_ready_lease(
          ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
        ) as result
      `,
      sql<{ result: { job_id: string; probe_generation: number } | null }[]>`
        select expire_ai_provider_ready_lease(
          ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
        ) as result
      `
    ]);
    const responses = results.map((rows) => rows[0]?.result);
    expect(responses[0]).toEqual(responses[1]);
    const [runtime] = await sql<{
      state: string;
      available: boolean;
      probe_generation: number;
    }[]>`
      select state, available, probe_generation::integer as probe_generation
      from ai_provider_runtime_state
      where provider_id = ${fixture.providerId}
    `;
    expect(runtime).toEqual({ state: 'ready', available: false, probe_generation: 2 });
    const [probeCount] = await sql<{ count: number }[]>`
      select count(*)::integer as count from jobs
      where idempotency_key like ${`provider-probe:${fixture.providerId}:%`}
    `;
    expect(probeCount?.count).toBe(2);
  });

  it('requires current acceptance evidence and current activation bindings', async () => {
    const fixture = await seedAcceptedProvider();
    await expect(sql`
      select activate_subscription_provider(
        ${fixture.providerId}, ${fixture.modelId}, 2, 0,
        ${fixture.fingerprint}, ${fixture.termsDigest}
      )
    `).rejects.toThrow(/provider_activation_rejected/);
    await expect(sql`
      select activate_subscription_provider(
        ${fixture.providerId}, ${fixture.modelId}, 1, 1,
        ${fixture.fingerprint}, ${fixture.termsDigest}
      )
    `).rejects.toThrow(/provider_activation_rejected/);
    await sql`
      update ai_provider_runtime_state set capability_attestation_id = null
      where provider_id = ${fixture.providerId}
    `;
    await expect(sql`
      select activate_subscription_provider(
        ${fixture.providerId}, ${fixture.modelId}, 1, 0,
        ${fixture.fingerprint}, ${fixture.termsDigest}
      )
    `).rejects.toThrow(/provider_activation_evidence_stale/);
  });

  it('requests a new generation only after a retry delay elapses', async () => {
    const fixture = await seedAcceptedProvider();
    const first = await activate(fixture);
    await commitReady(fixture, first.probe_generation);
    const attempt = await seedRuntimeFailureAttempt(
      fixture,
      first.probe_generation,
      'capacity_exhausted',
    );
    await applyRuntimeFailure(attempt, 'capacity_exhausted', 60);
    await expect(sql`
      select request_ai_provider_probe(
        ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
      )
    `).rejects.toThrow(/provider_probe_retry_not_elapsed/);
    await sql`
      update ai_provider_runtime_state set retry_not_before = clock_timestamp()
      where provider_id = ${fixture.providerId}
    `;
    const [refreshed] = await sql<{ result: { probe_generation: number } }[]>`
      select request_ai_provider_probe(
        ${fixture.providerId}, 1, 0, ${fixture.fingerprint}
      ) as result
    `;
    expect(refreshed?.result.probe_generation).toBe(first.probe_generation + 1);
  });
});
