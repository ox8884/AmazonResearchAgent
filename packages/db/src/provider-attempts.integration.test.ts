import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const admin = postgres(databaseUrl, { max: 1 });
const databaseName = `provider_attempts_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${databaseName}`;
const sql = postgres(testUrl.toString(), { max: 8 });
const migrationsDirectory = resolve(import.meta.dirname, '../../../supabase/migrations');

type NormalizationOutput = {
  readonly classification: string;
  readonly canonicalNiche: string;
  readonly canonicalEnglish: string;
  readonly catalogPhrases: readonly string[];
  readonly aliases: readonly string[];
  readonly productFit: string;
  readonly riskFlags: readonly string[];
  readonly confidence: number;
  readonly reason: string;
};
const normalizationOutput: NormalizationOutput = {
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
const usage = {
  inputTokens: 20,
  outputTokens: 30,
  totalTokens: 50,
  requestCount: 1
} as const;

type Lease = { job_id: string; job_lease_owner: string; job_lease_epoch: number };
type ProviderFixture = {
  providerId: string;
  modelId: string;
  fingerprint: string;
  probeGeneration: number;
};
type AnalysisLease = {
  analysis_id: string;
  analysis_lease_owner: string;
  analysis_lease_epoch: number;
};
type Fixture = {
  candidateId: string;
  job: Lease;
  analysis: AnalysisLease;
  providerId: string;
  modelId: string;
  fingerprint: string;
  probeGeneration: number;
};

async function seedReadyProvider(adapter: 'codex' | 'grok' = 'codex'): Promise<ProviderFixture> {
  const suffix = randomUUID();
  const providerId = `${adapter}-${suffix}`;
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
      'subscription-isolation-v1', ${securityProfileDigest}, 'ready-lease-v1',
      ${termsDigest}, ${credentialDigest}, ${binaryDigest}, ${capabilityDigest},
      ${framingDigest}, ${boundedDigest}, ${containmentDigest},
      '{"verified":true}'::jsonb
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
  return { providerId, modelId, fingerprint, probeGeneration: activated.result.probe_generation };
}

async function seedCandidateAndLeases(
  selectedProvider?: ProviderFixture
): Promise<Fixture> {
  const provider = selectedProvider ?? await seedReadyProvider();
  const suffix = randomUUID();
  const importRunId = randomUUID();
  const rawId = randomUUID();
  const candidateId = randomUUID();
  await sql`
    insert into import_runs (id, submission_hash) values (${importRunId}, ${suffix})
  `;
  await sql`
    insert into raw_opportunity_keywords (
      id, import_run_id, source_file_name, source_hash, source_row_number,
      row_hash, raw_row_text, raw_row, keyword, normalized_exact_keyword
    ) values (
      ${rawId}, ${importRunId}, 'fixture.csv', ${suffix}, 1,
      ${suffix}, 'batter dispenser', '{}'::jsonb,
      'batter dispenser', ${`batter dispenser ${suffix}`}
    )
  `;
  await sql`
    insert into candidates (
      id, import_run_id, representative_raw_keyword_id, keyword,
      normalized_exact_keyword, state, rule_passed, eligible_for_ai_normalization,
      rule_reasons, normalization_generation
    ) values (
      ${candidateId}, ${importRunId}, ${rawId}, 'batter dispenser',
      ${`batter dispenser ${suffix}`}, 'AI Screening', true, true,
      '[{"code":"RULE_PASS","detail":"rule accepted"}]'::jsonb, 0
    )
  `;
  const jobId = randomUUID();
  await sql`
    insert into jobs (id, type, payload, status, idempotency_key)
    values (
      ${jobId}, 'NORMALIZE_OPPORTUNITIES',
      ${sql.json({ candidateIds: [candidateId], locale: 'ko' })},
      'queued', ${`normalize:${candidateId}`}
    )
  `;
  const [job] = await sql<{ id: string; leased_by: string; attempts: number }[]>`
    select id, leased_by, attempts from claim_jobs('worker-a', 100, 120)
    where id = ${jobId}
  `;
  if (!job) throw new Error('Normalization job was not claimed.');
  const inputHash = `hash-${suffix}`;
  const [analysis] = await sql<{
    analysis_id: string;
    claim_status: string;
    analysis_lease_epoch: number;
  }[]>`
    select analysis_id, claim_status, analysis_lease_epoch from claim_ai_analysis(
      'niche_normalization', ${inputHash}, 'analysis-worker-a', 120,
      ${provider.providerId}, ${provider.modelId}, 'ko', 'niche-normalization-v1',
      ${sql.json({
        candidateId,
        normalizationGeneration: 0,
        keyword: 'batter dispenser',
        normalizedExactKeyword: `batter dispenser ${suffix}`
      })}
    )
  `;
  if (!analysis || analysis.claim_status !== 'claimed') {
    throw new Error('Normalization analysis was not claimed.');
  }
  return {
    candidateId,
    job: {
      job_id: job.id,
      job_lease_owner: job.leased_by,
      job_lease_epoch: job.attempts
    },
    analysis: {
      analysis_id: analysis.analysis_id,
      analysis_lease_owner: 'analysis-worker-a',
      analysis_lease_epoch: analysis.analysis_lease_epoch
    },
    ...provider
  };
}

async function beginAttempt(fixture: Fixture, fallbackParentAttemptId: string | null = null) {
  const [row] = await sql<{ result: {
    attempt_id: string;
    attempt_sequence: number;
    provider_id: string;
  } }[]>`
    select begin_ai_provider_attempt(
      ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
      ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
      ${fixture.analysis.analysis_lease_epoch}, ${fixture.providerId}, ${fixture.modelId},
      1, 0, ${fixture.fingerprint}, ${fallbackParentAttemptId}::uuid
    ) as result
  `;
  if (!row) throw new Error('Provider attempt authorization returned no row.');
  return row.result;
}

async function appendSuccess(fixture: Fixture, attemptId: string, output = normalizationOutput) {
  const [row] = await sql<{ result: { event_type: string } }[]>`
    select append_ai_provider_attempt_outcome(
      ${attemptId}::uuid,
      ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
      ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
      ${fixture.analysis.analysis_lease_epoch},
      'attempt_succeeded', 'consumed', 'success', null,
      75, 20, 30, 1, '{}'::jsonb,
      ${sql.json(output)}, ${sql.json(usage)}
    ) as result
  `;
  if (!row) throw new Error('Provider attempt outcome returned no row.');
  return row.result;
}

async function finalizeAnalysis(fixture: Fixture, attemptId: string) {
  const [row] = await sql<{ result: { status: string; output_sha256: string } }[]>`
    select finalize_ai_analysis_from_attempt(
      ${attemptId}::uuid,
      ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
      ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
      ${fixture.analysis.analysis_lease_epoch}
    ) as result
  `;
  if (!row) throw new Error('Analysis finalization returned no row.');
  return row.result;
}
async function appendOutcome(
  fixture: Fixture,
  attemptId: string,
  eventType: 'attempt_failed' | 'attempt_cancelled' | 'attempt_not_consumed' | 'attempt_unknown_after_crash',
  consumptionStatus: 'consumed' | 'not_consumed' | 'unknown',
  resultClass: string,
  proofCategory: string | null = null,
): Promise<void> {
  await sql`
    select append_ai_provider_attempt_outcome(
      ${attemptId}::uuid,
      ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
      ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
      ${fixture.analysis.analysis_lease_epoch},
      ${eventType}, ${consumptionStatus}, ${resultClass}, ${proofCategory},
      40, null, null, 1, '{}'::jsonb, null, null
    )
  `;
}

async function asServiceRole<T>(
  operation: (connection: postgres.TransactionSql<Record<string, postgres.PostgresType>>) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await sql.begin(async (connection) => {
    await connection.unsafe('set local role service_role');
    result = await operation(connection);
  });
  if (result === undefined) throw new Error('Service-role operation returned no result.');
  return result;
}
async function applyRuntimeFailure(
  fixture: Fixture,
  attemptId: string,
  failureClass: string,
): Promise<void> {
  await sql`
    select apply_ai_provider_runtime_failure(
      ${attemptId}::uuid,
      ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
      ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
      ${fixture.analysis.analysis_lease_epoch}, ${failureClass}, 60
    )
  `;
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
  await sql.unsafe(`alter default privileges in schema public grant all on tables to service_role`);
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql') && file <= '202608290021_provider_attempt_transactions.sql')
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

describe('provider attempt transactions', () => {
  it('rejects old epochs even when the same worker IDs reclaim both leases', async () => {
    const fixture = await seedCandidateAndLeases();
    await sql`update jobs set leased_until = clock_timestamp() - interval '1 second' where id = ${fixture.job.job_id}`;
    const [job] = await sql<{ id: string; attempts: number }[]>`
      select id, attempts from claim_jobs(${fixture.job.job_lease_owner}, 1, 120)
      where id = ${fixture.job.job_id}
    `;
    expect(job?.attempts).toBe(fixture.job.job_lease_epoch + 1);
    const [oldJob] = await sql<{ result: boolean }[]>`
      select heartbeat_job(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner},
        ${fixture.job.job_lease_epoch}, 120
      ) as result
    `;
    const [newJob] = await sql<{ result: boolean }[]>`
      select heartbeat_job(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner},
        ${job?.attempts ?? 0}, 120
      ) as result
    `;
    expect(oldJob?.result).toBe(false);
    expect(newJob?.result).toBe(true);

    await sql`update ai_analyses set leased_until = clock_timestamp() - interval '1 second' where id = ${fixture.analysis.analysis_id}`;
    const [analysis] = await sql<{ analysis_lease_epoch: number }[]>`
      select analysis_lease_epoch from claim_ai_analysis(
        'niche_normalization',
        (select input_hash from ai_analyses where id = ${fixture.analysis.analysis_id}),
        ${fixture.analysis.analysis_lease_owner}, 120,
        ${fixture.providerId}, ${fixture.modelId}, 'ko', 'niche-normalization-v1',
        (select input_payload from ai_analyses where id = ${fixture.analysis.analysis_id})
      )
    `;
    expect(analysis?.analysis_lease_epoch).toBe(fixture.analysis.analysis_lease_epoch + 1);
    const [oldAnalysis] = await sql<{ result: boolean }[]>`
      select renew_ai_analysis_lease(
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, 120
      ) as result
    `;
    expect(oldAnalysis?.result).toBe(false);
    await expect(beginAttempt(fixture)).rejects.toThrow(/lease/i);
  });

  it('allocates monotonic sequences only after an eligible completed outcome', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    await appendOutcome(fixture, first.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    const grok = await seedReadyProvider('grok');
    const second = await beginAttempt({ ...fixture, ...grok }, first.attempt_id);
    expect([first.attempt_sequence, second.attempt_sequence]).toEqual([1, 2]);
    const starts = await sql<{ attempt_id: string; event_type: string }[]>`
      select attempt_id, event_type from provider_attempt_events
      where logical_analysis_id = ${fixture.analysis.analysis_id}
        and event_type = 'attempt_started'
      order by attempt_sequence
    `;
    expect(starts.map((event) => event.attempt_id)).toEqual([
      first.attempt_id,
      second.attempt_id,
    ]);
  });

  it('stages one winner and finalizes analysis and usage exactly once', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    const outcomes = await Promise.all([
      appendSuccess(fixture, attempt.attempt_id),
      appendSuccess(fixture, attempt.attempt_id)
    ]);
    expect(outcomes).toEqual([
      { event_type: 'attempt_succeeded' },
      { event_type: 'attempt_succeeded' }
    ]);
    const first = await finalizeAnalysis(fixture, attempt.attempt_id);
    const second = await finalizeAnalysis(fixture, attempt.attempt_id);
    expect(first).toEqual(second);
    expect(first.status).toBe('completed');
    expect(first.output_sha256).toMatch(/^[a-f0-9]{64}$/u);
    const [usageCount] = await sql<{ count: number }[]>`
      select count(*)::integer as count from ai_usage
      where analysis_id = ${fixture.analysis.analysis_id}
    `;
    expect(usageCount?.count).toBe(1);
  });

  it('derives and commits candidate domain state atomically from stored output', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendSuccess(fixture, attempt.attempt_id);
    await finalizeAnalysis(fixture, attempt.attempt_id);
    const [first] = await sql<{ result: { kind: string; target_state: string } }[]>`
      select finalize_normalized_candidate(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, ${fixture.candidateId},
        'AI Screening', 0
      ) as result
    `;
    const [repeat] = await sql<{ result: { kind: string; target_state: string } }[]>`
      select finalize_normalized_candidate(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, ${fixture.candidateId},
        'AI Screening', 0
      ) as result
    `;
    expect(first?.result).toMatchObject({ kind: 'committed', target_state: 'Ready for API Validation' });
    expect(repeat?.result).toMatchObject({ kind: 'already_committed', target_state: 'Ready for API Validation' });
    const [candidate] = await sql<{ state: string; niche_cluster_id: string; rule_reasons: unknown[] }[]>`
      select state, niche_cluster_id, rule_reasons from candidates where id = ${fixture.candidateId}
    `;
    expect(candidate?.state).toBe('Ready for API Validation');
    expect(candidate?.niche_cluster_id).toBeTruthy();
    expect(candidate?.rule_reasons).toEqual([
      { code: 'RULE_PASS', detail: 'rule accepted' },
      { code: 'AI_PRODUCT_NICHE', detail: normalizationOutput.reason }
    ]);
    const [counts] = await sql<{ entities: number; decisions: number; ledgers: number; links: number }[]>`
      select
        (select count(*) from ai_analysis_entities where analysis_id = ${fixture.analysis.analysis_id})::integer as entities,
        (select count(*) from decision_history where candidate_id = ${fixture.candidateId})::integer as decisions,
        (select count(*) from normalized_candidate_finalizations where candidate_id = ${fixture.candidateId})::integer as ledgers,
        (select count(*) from niche_cluster_keywords where niche_cluster_id = ${candidate?.niche_cluster_id ?? null})::integer as links
    `;
    expect(counts).toEqual({ entities: 1, decisions: 1, ledgers: 1, links: 1 });
    await expect(sql`
      select claim_completed_ai_analysis_finalization(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner},
        ${fixture.job.job_lease_epoch}, ${randomUUID()}::uuid,
        'analysis-worker-b', 120, ${fixture.candidateId},
        'Ready for API Validation', 0
      )
    `).rejects.toThrow(/conflict/i);
  });

  it('rejects stale candidate-domain lease epochs without partial writes', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendSuccess(fixture, attempt.attempt_id);
    await finalizeAnalysis(fixture, attempt.attempt_id);
    await expect(sql`
      select finalize_normalized_candidate(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner},
        ${fixture.job.job_lease_epoch - 1},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, ${fixture.candidateId},
        'AI Screening', 0
      )
    `).rejects.toThrow(/job_lease_rejected/i);
    const [state] = await sql<{ state: string; decisions: number; ledgers: number }[]>`
      select state,
        (select count(*) from decision_history where candidate_id = ${fixture.candidateId})::integer as decisions,
        (select count(*) from normalized_candidate_finalizations
          where candidate_id = ${fixture.candidateId})::integer as ledgers
      from candidates where id = ${fixture.candidateId}
    `;
    expect(state).toEqual({ state: 'AI Screening', decisions: 0, ledgers: 0 });
  });

  it('rejects a new start after a successful winner is staged', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    await appendSuccess(fixture, first.attempt_id);
    const grok = await seedReadyProvider('grok');
    await expect(beginAttempt({ ...fixture, ...grok }, first.attempt_id))
      .rejects.toThrow(/winner_exists/i);
    const [state] = await sql<{ winner: string; starts: number }[]>`
      select pending_winner_attempt_id as winner,
        (select count(*) from provider_attempt_events
          where logical_analysis_id = ${fixture.analysis.analysis_id}
            and event_type = 'attempt_started')::integer as starts
      from ai_analyses where id = ${fixture.analysis.analysis_id}
    `;
    expect(state).toEqual({ winner: first.attempt_id, starts: 1 });
  });

  it('rejects malformed winner output without an outcome or staged winner', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await expect(appendSuccess(fixture, attempt.attempt_id, {
      ...normalizationOutput,
      confidence: 2
    })).rejects.toThrow(/output/i);
    const [state] = await sql<{ outcomes: number; pending_winner_attempt_id: string | null }[]>`
      select
        (select count(*) from provider_attempt_events
          where attempt_id = ${attempt.attempt_id} and event_type <> 'attempt_started')::integer as outcomes,
        pending_winner_attempt_id
      from ai_analyses where id = ${fixture.analysis.analysis_id}
    `;
    expect(state).toEqual({ outcomes: 0, pending_winner_attempt_id: null });
  });

  it('rejects null required output enums without staging evidence', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await expect(sql`
      select append_ai_provider_attempt_outcome(
        ${attempt.attempt_id}::uuid,
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch},
        'attempt_succeeded', 'consumed', 'success', null,
        75, 20, 30, 1, '{}'::jsonb,
        ${sql.json({ ...normalizationOutput, classification: null })},
        ${sql.json(usage)}
      )
    `).rejects.toThrow(/output/i);
    const [state] = await sql<{ outcomes: number; winner: string | null }[]>`
      select
        (select count(*) from provider_attempt_events
          where attempt_id = ${attempt.attempt_id} and event_type <> 'attempt_started')::integer as outcomes,
        pending_winner_attempt_id as winner
      from ai_analyses where id = ${fixture.analysis.analysis_id}
    `;
    expect(state).toEqual({ outcomes: 0, winner: null });
  });

  it('reclaims completed analysis finalization without replaying the provider', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendSuccess(fixture, attempt.attempt_id);
    await finalizeAnalysis(fixture, attempt.attempt_id);
    await sql`update ai_analyses set leased_until = clock_timestamp() - interval '1 second' where id = ${fixture.analysis.analysis_id}`;
    const [reclaimed] = await sql<{ result: { kind: string; analysis_lease_epoch: number } }[]>`
      select claim_completed_ai_analysis_finalization(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, 'analysis-worker-b', 120,
        ${fixture.candidateId}, 'AI Screening', 0
      ) as result
    `;
    expect(reclaimed?.result).toEqual({
      kind: 'claimed',
      analysis_lease_epoch: fixture.analysis.analysis_lease_epoch + 1
    });
    const [attemptCount] = await sql<{ count: number }[]>`
      select count(*)::integer as count from provider_attempt_events
      where logical_analysis_id = ${fixture.analysis.analysis_id} and event_type = 'attempt_started'
    `;
    expect(attemptCount?.count).toBe(1);
  });

  it('fences no-winner defer and never consumes the finalization ledger', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await sql`
      select append_ai_provider_attempt_outcome(
        ${attempt.attempt_id}::uuid,
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch},
        'attempt_failed', 'unknown', 'capacity_exhausted', null,
        40, null, null, 1, '{}'::jsonb, null, null
      )
    `;
    const [deferred] = await sql<{ result: { kind: string; target_state: string } }[]>`
      select defer_candidate_normalization(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.candidateId}, 'AI Screening', 0
      ) as result
    `;
    expect(deferred?.result).toEqual({ kind: 'deferred', target_state: 'Waiting for AI Capacity' });
    const [state] = await sql<{ state: string; ledgers: number }[]>`
      select state,
        (select count(*) from normalized_candidate_finalizations
          where candidate_id = ${fixture.candidateId})::integer as ledgers
      from candidates where id = ${fixture.candidateId}
    `;
    expect(state).toEqual({ state: 'Waiting for AI Capacity', ledgers: 0 });
  });

  it('rejects defer evidence owned by a different candidate analysis', async () => {
    const target = await seedCandidateAndLeases();
    const evidence = await seedCandidateAndLeases();
    const attempt = await beginAttempt(evidence);
    await sql`
      select append_ai_provider_attempt_outcome(
        ${attempt.attempt_id}::uuid,
        ${evidence.job.job_id}, ${evidence.job.job_lease_owner}, ${evidence.job.job_lease_epoch},
        ${evidence.analysis.analysis_id}, ${evidence.analysis.analysis_lease_owner},
        ${evidence.analysis.analysis_lease_epoch},
        'attempt_failed', 'unknown', 'capacity_exhausted', null,
        40, null, null, 1, '{}'::jsonb, null, null
      )
    `;
    await expect(sql`
      select defer_candidate_normalization(
        ${target.job.job_id}, ${target.job.job_lease_owner}, ${target.job.job_lease_epoch},
        ${evidence.analysis.analysis_id}, ${target.candidateId}, 'AI Screening', 0
      )
    `).rejects.toThrow(/defer_rejected/i);
    const [candidate] = await sql<{ state: string }[]>`
      select state from candidates where id = ${target.candidateId}
    `;
    expect(candidate?.state).toBe('AI Screening');
  });

  // Break: pre-spawn authorization combines independently valid job and analysis leases
  // that belong to different candidate executions.
  it('rejects mismatched job and analysis candidate identity before recording a start', async () => {
    const jobOwner = await seedCandidateAndLeases();
    const analysisOwner = await seedCandidateAndLeases();
    const mixed = { ...analysisOwner, job: jobOwner.job };
    await expect(beginAttempt(mixed)).rejects.toThrow(/logical_execution/i);
    const [count] = await sql<{ count: number }[]>`
      select count(*)::integer as count from provider_attempt_events
      where logical_analysis_id = ${analysisOwner.analysis.analysis_id}
    `;
    expect(count?.count).toBe(0);
  });

  // Break: pre-spawn authorization accepts the same candidate under a different
  // normalization generation than the running job.
  it('rejects mismatched job and analysis normalization generation', async () => {
    const fixture = await seedCandidateAndLeases();
    await sql`
      update jobs set payload = payload || '{"normalizationGeneration":1}'::jsonb
      where id = ${fixture.job.job_id}
    `;
    await expect(beginAttempt(fixture)).rejects.toThrow(/logical_execution/i);
    const [count] = await sql<{ count: number }[]>`
      select count(*)::integer as count from provider_attempt_events
      where logical_analysis_id = ${fixture.analysis.analysis_id}
    `;
    expect(count?.count).toBe(0);
  });

  // Break: candidate finalization applies another candidate's completed analysis.
  it('rejects finalization with another candidate analysis without domain writes', async () => {
    const target = await seedCandidateAndLeases();
    const evidence = await seedCandidateAndLeases();
    const attempt = await beginAttempt(evidence);
    await appendSuccess(evidence, attempt.attempt_id);
    await finalizeAnalysis(evidence, attempt.attempt_id);
    await expect(sql`
      select finalize_normalized_candidate(
        ${target.job.job_id}, ${target.job.job_lease_owner}, ${target.job.job_lease_epoch},
        ${evidence.analysis.analysis_id}, ${evidence.analysis.analysis_lease_owner},
        ${evidence.analysis.analysis_lease_epoch}, ${target.candidateId},
        'AI Screening', 0
      )
    `).rejects.toThrow(/logical_execution/i);
    const [state] = await sql<{
      state: string;
      entities: number;
      decisions: number;
      ledgers: number;
      links: number;
    }[]>`
      select c.state,
        (select count(*) from ai_analysis_entities where entity_id = c.id)::integer as entities,
        (select count(*) from decision_history where candidate_id = c.id)::integer as decisions,
        (select count(*) from normalized_candidate_finalizations where candidate_id = c.id)::integer as ledgers,
        (select count(*) from niche_cluster_keywords where raw_opportunity_keyword_id = c.representative_raw_keyword_id)::integer as links
      from candidates c where c.id = ${target.candidateId}
    `;
    expect(state).toEqual({ state: 'AI Screening', entities: 0, decisions: 0, ledgers: 0, links: 0 });
  });

  // Break: candidate finalization ignores the completed analysis generation.
  it('rejects finalization with the same candidate from a stale generation', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendSuccess(fixture, attempt.attempt_id);
    await finalizeAnalysis(fixture, attempt.attempt_id);
    await sql`update candidates set normalization_generation = 1 where id = ${fixture.candidateId}`;
    await sql`
      update jobs set payload = payload || '{"normalizationGeneration":1}'::jsonb
      where id = ${fixture.job.job_id}
    `;
    await expect(sql`
      select finalize_normalized_candidate(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, ${fixture.candidateId},
        'AI Screening', 1
      )
    `).rejects.toThrow(/logical_execution/i);
    const [state] = await sql<{ state: string; ledgers: number }[]>`
      select state,
        (select count(*) from normalized_candidate_finalizations where candidate_id = ${fixture.candidateId})::integer as ledgers
      from candidates where id = ${fixture.candidateId}
    `;
    expect(state).toEqual({ state: 'AI Screening', ledgers: 0 });
  });

  // Break: an already staged or finalized winner does not stop another external attempt.
  it.each([
    ['staged', /winner/i],
    ['finalized', /analysis_lease_rejected/i],
  ] as const)(
    'rejects a new attempt after a %s successful winner',
    async (winnerState, expectedError) => {
      const fixture = await seedCandidateAndLeases();
      const first = await beginAttempt(fixture);
      await appendSuccess(fixture, first.attempt_id);
      if (winnerState === 'finalized') await finalizeAnalysis(fixture, first.attempt_id);
      const fallback = await seedReadyProvider('grok');
      await expect(beginAttempt({ ...fixture, ...fallback }, first.attempt_id))
        .rejects.toThrow(expectedError);
      const [count] = await sql<{ count: number }[]>`
        select count(*)::integer as count from provider_attempt_events
        where logical_analysis_id = ${fixture.analysis.analysis_id}
          and event_type = 'attempt_started'
      `;
      expect(count?.count).toBe(1);
    },
  );

  // Break: durable consumed and unknown outcomes do not exclude same-provider replay.
  it.each([
    ['attempt_failed', 'consumed', 'capacity_exhausted', null],
    ['attempt_unknown_after_crash', 'unknown', 'worker_process_loss', null],
  ] as const)(
    'rejects same-provider replay after %s with %s consumption',
    async (eventType, consumptionStatus, resultClass, proofCategory) => {
      const fixture = await seedCandidateAndLeases();
      const first = await beginAttempt(fixture);
      await appendOutcome(
        fixture,
        first.attempt_id,
        eventType,
        consumptionStatus,
        resultClass,
        proofCategory,
      );
      await expect(beginAttempt(fixture, first.attempt_id)).rejects.toThrow(/provider_replay/i);
    },
  );

  // Break: attempt authorization admits a fourth distinct externally consumable provider.
  it('rejects a fourth distinct externally consumable provider', async () => {
    const fixture = await seedCandidateAndLeases();
    const providers = [
      { providerId: fixture.providerId, modelId: fixture.modelId, fingerprint: fixture.fingerprint, probeGeneration: fixture.probeGeneration },
      await seedReadyProvider('grok'),
      await seedReadyProvider('codex'),
      await seedReadyProvider('grok'),
    ];
    let parent: string | null = null;
    for (const provider of providers.slice(0, 3)) {
      const scoped = { ...fixture, ...provider };
      const attempt = await beginAttempt(scoped, parent);
      await appendOutcome(scoped, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
      parent = attempt.attempt_id;
    }
    await expect(beginAttempt({ ...fixture, ...providers[3] }, parent)).rejects.toThrow(/provider_limit/i);
  });

  // Break: any prior outcome is accepted as a fallback parent even when policy forbids fallback.
  it('rejects a fallback parent whose outcome is not fallback eligible', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    await appendOutcome(fixture, first.attempt_id, 'attempt_failed', 'unknown', 'unsafe_unknown');
    const fallback = await seedReadyProvider('grok');
    await expect(beginAttempt({ ...fixture, ...fallback }, first.attempt_id)).rejects.toThrow(/fallback_parent/i);
  });

  it('allows exactly one proven pre-consumption same-provider replacement', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    await appendOutcome(
      fixture,
      first.attempt_id,
      'attempt_not_consumed',
      'not_consumed',
      'pre_spawn_failure',
      'sandbox_not_started',
    );
    await expect(beginAttempt(fixture, first.attempt_id)).resolves.toMatchObject({
      attempt_sequence: 2,
      provider_id: fixture.providerId,
    });
  });

  // Break: repeated proven-not-consumed outcomes permit unbounded replacement.
  it('rejects a second same-provider replacement', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    await appendOutcome(
      fixture,
      first.attempt_id,
      'attempt_not_consumed',
      'not_consumed',
      'pre_spawn_failure',
      'sandbox_not_started',
    );
    const second = await beginAttempt(fixture, first.attempt_id);
    await appendOutcome(
      fixture,
      second.attempt_id,
      'attempt_not_consumed',
      'not_consumed',
      'pre_spawn_failure',
      'sandbox_not_started',
    );
    await expect(beginAttempt(fixture, second.attempt_id)).rejects.toThrow(/provider_replacement/i);
  });

  // Break: failed/cancelled outcomes accept arbitrary or contradictory result classes.
  it.each([
    ['attempt_failed', 'unknown', 'invented_failure', null],
    ['attempt_failed', 'not_consumed', 'capacity_exhausted', null],
    ['attempt_cancelled', 'not_consumed', 'cancelled_by_caller', null],
    ['attempt_cancelled', 'unknown', 'capacity_exhausted', null],
    ['attempt_not_consumed', 'not_consumed', 'pre_spawn_failure', 'invented_proof'],
    ['attempt_succeeded', 'unknown', 'success', null],
  ] as const)(
    'rejects invalid outcome matrix row %s/%s/%s/%s',
    async (eventType, consumptionStatus, resultClass, proofCategory) => {
      const fixture = await seedCandidateAndLeases();
      const attempt = await beginAttempt(fixture);
      if (eventType === 'attempt_succeeded') {
        await expect(sql`
          select append_ai_provider_attempt_outcome(
            ${attempt.attempt_id}::uuid,
            ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
            ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
            ${fixture.analysis.analysis_lease_epoch},
            ${eventType}, ${consumptionStatus}, ${resultClass}, ${proofCategory},
            40, 20, 30, 1, '{}'::jsonb, ${sql.json(normalizationOutput)}, ${sql.json(usage)}
          )
        `).rejects.toThrow(/outcome|success|check/i);
      } else {
        await expect(appendOutcome(
          fixture,
          attempt.attempt_id,
          eventType,
          consumptionStatus,
          resultClass,
          proofCategory,
        )).rejects.toThrow(/outcome|check/i);
      }
    },
  );

  it.each([
    ['attempt_failed', 'unknown', 'auth_expired'],
    ['attempt_failed', 'unknown', 'credential_source_mismatch'],
    ['attempt_failed', 'unknown', 'binary_identity_mismatch'],
    ['attempt_failed', 'unknown', 'profile_mismatch'],
    ['attempt_failed', 'unknown', 'containment_failure'],
    ['attempt_failed', 'unknown', 'capability_failure'],
    ['attempt_failed', 'consumed', 'capacity_exhausted'],
    ['attempt_failed', 'unknown', 'capacity_exhausted'],
    ['attempt_failed', 'consumed', 'rate_limited'],
    ['attempt_failed', 'unknown', 'rate_limited'],
    ['attempt_failed', 'consumed', 'transient_network'],
    ['attempt_failed', 'unknown', 'transient_network'],
    ['attempt_failed', 'consumed', 'client_transient'],
    ['attempt_failed', 'unknown', 'client_transient'],
    ['attempt_failed', 'consumed', 'timeout'],
    ['attempt_failed', 'unknown', 'timeout'],
    ['attempt_failed', 'unknown', 'unsafe_unknown'],
    ['attempt_failed', 'consumed', 'schema_invalid_output'],
    ['attempt_failed', 'consumed', 'business_validation_failure'],
    ['attempt_cancelled', 'unknown', 'cancelled_by_caller'],
    ['attempt_cancelled', 'unknown', 'cancelled_by_job_lease_loss'],
    ['attempt_cancelled', 'unknown', 'cancelled_by_shutdown'],
  ] as const)(
    'accepts canonical outcome matrix row %s/%s/%s',
    async (eventType, consumptionStatus, resultClass) => {
      const fixture = await seedCandidateAndLeases();
      const attempt = await beginAttempt(fixture);
      await expect(appendOutcome(
        fixture,
        attempt.attempt_id,
        eventType,
        consumptionStatus,
        resultClass,
      )).resolves.toBeUndefined();
    },
  );
  // Break: runtime failure writeback accepts an obsolete same-owner job epoch.
  it('rejects runtime failure writeback from a stale job epoch', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendOutcome(fixture, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    await sql`
      update jobs set leased_until = clock_timestamp() - interval '1 second'
      where id = ${fixture.job.job_id}
    `;
    await sql`
      select * from claim_jobs(${fixture.job.job_lease_owner}, 1, 120)
      where id = ${fixture.job.job_id}
    `;
    await expect(applyRuntimeFailure(
      fixture,
      attempt.attempt_id,
      'capacity_exhausted',
    )).rejects.toThrow(/job_lease_rejected/i);
    await sql`update jobs set status = 'completed' where id = ${fixture.job.job_id}`;
  });

  // Break: runtime failure writeback accepts an obsolete same-owner analysis epoch.
  it('rejects runtime failure writeback from a stale analysis epoch', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendOutcome(fixture, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    await sql`
      update ai_analyses set leased_until = clock_timestamp() - interval '1 second'
      where id = ${fixture.analysis.analysis_id}
    `;
    await sql`
      select * from claim_ai_analysis(
        'niche_normalization',
        (select input_hash from ai_analyses where id = ${fixture.analysis.analysis_id}),
        ${fixture.analysis.analysis_lease_owner}, 120,
        ${fixture.providerId}, ${fixture.modelId}, 'ko', 'niche-normalization-v1',
        (select input_payload from ai_analyses where id = ${fixture.analysis.analysis_id})
      )
    `;
    await expect(applyRuntimeFailure(
      fixture,
      attempt.attempt_id,
      'capacity_exhausted',
    )).rejects.toThrow(/analysis_lease_rejected/i);
    await sql`
      update ai_analyses set leased_until = clock_timestamp() - interval '1 second'
      where id = ${fixture.analysis.analysis_id}
    `;
  });

  // Break: failure from probe generation N mutates runtime generation N+1.
  it('rejects runtime failure writeback from a stale probe generation', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendOutcome(fixture, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    await sql`
      select request_ai_provider_probe(${fixture.providerId}, 1, 0, ${fixture.fingerprint})
    `;
    await expect(applyRuntimeFailure(
      fixture,
      attempt.attempt_id,
      'capacity_exhausted',
    )).rejects.toThrow(/provider_runtime_cas_conflict/i);
    const [runtime] = await sql<{ reason: string | null; probe_generation: number }[]>`
      select reason, probe_generation::integer as probe_generation
      from ai_provider_runtime_state where provider_id = ${fixture.providerId}
    `;
    expect(runtime).toEqual({ reason: null, probe_generation: fixture.probeGeneration + 1 });
  });

  // Break: caller-forged current bindings detach a failure from its stored attempt bindings.
  it('rejects runtime failure after provider bindings change', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendOutcome(fixture, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    const currentFingerprint = `${fixture.fingerprint}-next`;
    await sql`update ai_providers set settings_revision = 2 where id = ${fixture.providerId}`;
    await sql`
      update ai_provider_runtime_state
      set settings_revision = 2, auth_generation = 1,
          execution_fingerprint = ${currentFingerprint}, probe_generation = probe_generation + 1
      where provider_id = ${fixture.providerId}
    `;
    await expect(applyRuntimeFailure(
      fixture,
      attempt.attempt_id,
      'capacity_exhausted',
    )).rejects.toThrow(/provider_runtime_cas_conflict/i);
  });

  it('allows current attempt and lease identities to apply canonical runtime failure', async () => {
    const fixture = await seedCandidateAndLeases();
    const attempt = await beginAttempt(fixture);
    await appendOutcome(fixture, attempt.attempt_id, 'attempt_failed', 'unknown', 'capacity_exhausted');
    await expect(applyRuntimeFailure(
      fixture,
      attempt.attempt_id,
      'capacity_exhausted',
    )).resolves.toBeUndefined();
    const [runtime] = await sql<{ available: boolean; reason: string | null }[]>`
      select available, reason from ai_provider_runtime_state
      where provider_id = ${fixture.providerId}
    `;
    expect(runtime).toEqual({ available: false, reason: 'temporary_capacity' });
  });


  // Break: service_role directly mutates protected provider authority surfaces.
  it('denies service_role direct protected-table writes and GUC forgery', async () => {
    const fixture = await seedCandidateAndLeases();
    await expect(asServiceRole((connection) => connection`
      insert into provider_attempt_events (
        attempt_id, logical_analysis_id, attempt_sequence, event_type,
        provider_id, model_id, adapter, role, billing_type,
        settings_revision, auth_generation, execution_fingerprint, probe_generation,
        request_count, job_id, job_lease_owner, job_lease_epoch,
        analysis_lease_owner, analysis_lease_epoch
      ) values (
        ${randomUUID()}::uuid, ${fixture.analysis.analysis_id}, 1, 'attempt_started',
        ${fixture.providerId}, ${fixture.modelId}, 'codex', 'niche_normalization', 'subscription',
        1, 0, ${fixture.fingerprint}, ${fixture.probeGeneration}, 1,
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_lease_owner}, ${fixture.analysis.analysis_lease_epoch}
      )
    `)).rejects.toThrow(/permission denied/i);
    await expect(asServiceRole((connection) => connection`
      update ai_provider_runtime_state set available = false, reason = 'forged'
      where provider_id = ${fixture.providerId}
    `)).rejects.toThrow(/permission denied/i);
    await expect(asServiceRole((connection) => connection`
      insert into ai_provider_capability_attestations (
        provider_id, adapter, model_id, role, settings_revision, auth_generation,
        execution_fingerprint, capability_digest, framing_digest, bounded_behavior_digest
      ) values (
        ${fixture.providerId}, 'codex', ${fixture.modelId}, 'niche_normalization',
        1, 0, ${fixture.fingerprint}, ${randomUUID()}, 'forged', 'forged'
      )
    `)).rejects.toThrow(/permission denied/i);
    await expect(asServiceRole(async (connection) => {
      await connection`select set_config('app.provider_attempt_tx', 'on', true)`;
      return connection`
        update ai_analyses set pending_winner_attempt_id = ${randomUUID()}::uuid,
          pending_output = ${sql.json(normalizationOutput)}, pending_usage = ${sql.json(usage)}
        where id = ${fixture.analysis.analysis_id}
      `;
    })).rejects.toThrow(/permission denied|protected/i);
    await expect(sql.begin(async (connection) => {
      await connection.unsafe('set local session authorization service_role');
      await connection.unsafe('set local role ara_provider_authority');
    })).rejects.toThrow(/permission denied/i);
    const [membership] = await sql<{ is_member: boolean }[]>`
      select pg_has_role('service_role', 'ara_provider_authority', 'member') as is_member
    `;
    expect(membership?.is_member).toBe(false);
    await expect(asServiceRole((connection) => connection`
      select assert_current_job_lease(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch}
      )
    `)).rejects.toThrow(/permission denied/i);

    const [privileges] = await sql<{
      protected_mutation_denied: boolean;
      internal_execute_denied: boolean;
      authority_schema_create_denied: boolean;
    }[]>`
      select
        bool_and(not has_table_privilege('service_role', table_name, privilege))
          as protected_mutation_denied,
        (
          select bool_and(not has_function_privilege('service_role', signature, 'execute'))
          from unnest(array[
            'public.assert_normalization_output(jsonb)',
            'public.assert_ai_usage(jsonb)',
            'public.assert_current_job_lease(uuid,text,integer)',
            'public.assert_current_analysis_lease(uuid,text,integer,text)',
            'public.append_candidate_reason(jsonb,text,text)',
            'public.assert_normalization_job_payload(jsonb,uuid,bigint)'
          ]) as helpers(signature)
        ) as internal_execute_denied,
        not has_schema_privilege('ara_provider_authority', 'public', 'create')
          as authority_schema_create_denied
      from unnest(array[
        'public.ai_provider_runtime_state',
        'public.ai_provider_capability_attestations',
        'public.ai_provider_containment_attestations',
        'public.provider_attempt_events'
      ]) as protected(table_name)
      cross join unnest(array['insert', 'update', 'delete']) as mutations(privilege)
    `;
    expect(privileges).toEqual({
      protected_mutation_denied: true,
      internal_execute_denied: true,
      authority_schema_create_denied: true,
    });

    const disabled = await seedReadyProvider('grok');
    await sql`select deactivate_subscription_provider(${disabled.providerId})`;
    await expect(asServiceRole(async (connection) => {
      await connection`select set_config('app.subscription_activation', 'on', true)`;
      return connection`update ai_providers set enabled = true where id = ${disabled.providerId}`;
    })).rejects.toThrow(/requires_activation|permission denied/i);
  });

  // Break: service_role bypasses canonical finalization and writes the immutable ledger directly.
  it('allows authoritative finalization but denies direct service_role ledger mutations', async () => {
    const authorized = await seedCandidateAndLeases();
    const authorizedAttempt = await beginAttempt(authorized);
    await appendSuccess(authorized, authorizedAttempt.attempt_id);
    await finalizeAnalysis(authorized, authorizedAttempt.attempt_id);
    const [finalization] = await asServiceRole((connection) => connection<{
      result: { kind: string; target_state: string };
    }[]>`
      select finalize_normalized_candidate(
        ${authorized.job.job_id}, ${authorized.job.job_lease_owner},
        ${authorized.job.job_lease_epoch}, ${authorized.analysis.analysis_id},
        ${authorized.analysis.analysis_lease_owner},
        ${authorized.analysis.analysis_lease_epoch}, ${authorized.candidateId},
        'AI Screening', 0
      ) as result
    `);
    expect(finalization?.result).toMatchObject({
      kind: 'committed',
      target_state: 'Ready for API Validation',
    });

    const direct = await seedCandidateAndLeases();
    const directAttempt = await beginAttempt(direct);
    await appendSuccess(direct, directAttempt.attempt_id);
    await finalizeAnalysis(direct, directAttempt.attempt_id);
    const [decision] = await sql<{ id: string }[]>`
      insert into decision_history (
        candidate_id, from_state, to_state, reasons, decided_by, idempotency_key
      ) values (
        ${direct.candidateId}, 'AI Screening', 'Needs Review', '[]'::jsonb,
        'direct-ledger-attack', ${`direct-ledger-attack:${direct.candidateId}`}
      ) returning id
    `;
    if (!decision) throw new Error('Direct-ledger fixture decision was not created.');

    await expect(asServiceRole((connection) => connection`
      insert into normalized_candidate_finalizations (
        candidate_id, normalization_generation, analysis_id, winning_attempt_id,
        finalized_output_sha256, target_state, decision_id, niche_cluster_id
      ) select
        ${direct.candidateId}, 0, id, winning_attempt_id, output_sha256,
        'Needs Review', ${decision.id}, null
      from ai_analyses where id = ${direct.analysis.analysis_id}
    `)).rejects.toThrow(/permission denied/i);
    await expect(asServiceRole((connection) => connection`
      update normalized_candidate_finalizations set target_state = 'Reject'
      where candidate_id = ${authorized.candidateId} and normalization_generation = 0
    `)).rejects.toThrow(/permission denied|immutable/i);
    await expect(asServiceRole((connection) => connection`
      delete from normalized_candidate_finalizations
      where candidate_id = ${authorized.candidateId} and normalization_generation = 0
    `)).rejects.toThrow(/permission denied|immutable/i);

    const [privileges] = await sql<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }[]>`
      select
        has_table_privilege('service_role', 'public.normalized_candidate_finalizations', 'select') as can_select,
        has_table_privilege('service_role', 'public.normalized_candidate_finalizations', 'insert') as can_insert,
        has_table_privilege('service_role', 'public.normalized_candidate_finalizations', 'update') as can_update,
        has_table_privilege('service_role', 'public.normalized_candidate_finalizations', 'delete') as can_delete
    `;
    expect(privileges).toEqual({
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
  });

  // Break: the pre-Task-10 cluster exception broadens to another authority-owned helper.
  it('keeps one narrow pre-Task-10 cluster legacy exception', async () => {
    const canonicalKey = `legacy exception ${randomUUID().replaceAll('-', '')}`;
    const [created] = await asServiceRole((connection) => connection<{ cluster_id: string }[]>`
      select upsert_niche_cluster(
        ${canonicalKey}, 'Legacy Exception Cluster', null,
        '["legacy alias"]'::jsonb, '["legacy phrase"]'::jsonb,
        'Ready for API Validation'
      ) as cluster_id
    `);
    const [cluster] = await sql<{
      id: string;
      canonical_key: string;
      canonical_name: string;
      aliases: string[];
      catalog_phrases: string[];
      state: string;
    }[]>`
      select id, canonical_key, canonical_name, aliases, catalog_phrases, state
      from niche_clusters where canonical_key = ${canonicalKey}
    `;
    expect(cluster).toEqual({
      id: created?.cluster_id,
      canonical_key: canonicalKey,
      canonical_name: 'Legacy Exception Cluster',
      aliases: ['legacy alias'],
      catalog_phrases: ['legacy phrase'],
      state: 'Ready for API Validation',
    });

    const [legacyPrivileges] = await sql<{
      service_role_execute: boolean;
      public_execute: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
    }[]>`
      select
        has_function_privilege(
          'service_role',
          'public.upsert_niche_cluster(text,text,text,jsonb,jsonb,text)',
          'execute'
        ) as service_role_execute,
        has_function_privilege(
          'public',
          'public.upsert_niche_cluster(text,text,text,jsonb,jsonb,text)',
          'execute'
        ) as public_execute,
        has_function_privilege(
          'anon',
          'public.upsert_niche_cluster(text,text,text,jsonb,jsonb,text)',
          'execute'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.upsert_niche_cluster(text,text,text,jsonb,jsonb,text)',
          'execute'
        ) as authenticated_execute
    `;
    expect(legacyPrivileges).toEqual({
      service_role_execute: true,
      public_execute: false,
      anon_execute: false,
      authenticated_execute: false,
    });

    const authorityFunctions = await sql<{ function_name: string }[]>`
      select p.proname as function_name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles owner_role on owner_role.oid = p.proowner
      where n.nspname = 'public'
        and owner_role.rolname = 'ara_provider_authority'
        and p.prosecdef
        and has_function_privilege('service_role', p.oid, 'execute')
      order by p.proname
    `;
    expect(authorityFunctions.map(({ function_name }) => function_name)).toEqual([
      'activate_subscription_provider',
      'append_ai_provider_attempt_outcome',
      'apply_ai_provider_runtime_failure',
      'begin_ai_provider_attempt',
      'claim_completed_ai_analysis_finalization',
      'commit_ai_provider_acceptance_probe',
      'commit_ai_provider_probe',
      'deactivate_subscription_provider',
      'defer_candidate_normalization',
      'expire_ai_provider_ready_lease',
      'fence_ai_provider_auth',
      'finalize_ai_analysis_from_attempt',
      'finalize_normalized_candidate',
      'is_ai_provider_routable',
      'reconcile_ai_provider_attempts',
      'request_ai_provider_probe',
      'upsert_niche_cluster',
    ]);
  });

  it('allows service_role to use a predicate-valid authoritative RPC', async () => {
    const fixture = await seedCandidateAndLeases();
    const [result] = await asServiceRole((connection) => connection<{ result: { attempt_sequence: number } }[]>`
      select begin_ai_provider_attempt(
        ${fixture.job.job_id}, ${fixture.job.job_lease_owner}, ${fixture.job.job_lease_epoch},
        ${fixture.analysis.analysis_id}, ${fixture.analysis.analysis_lease_owner},
        ${fixture.analysis.analysis_lease_epoch}, ${fixture.providerId}, ${fixture.modelId},
        1, 0, ${fixture.fingerprint}, null
      ) as result
    `);
    expect(result?.result.attempt_sequence).toBe(1);
  });

type EnqueuedNormalization = {
  readonly job_id: string;
  readonly idempotency_key: string;
};

  it('keeps the initial normalization writer in immutable legacy mode', async () => {
    const fixture = await seedCandidateAndLeases();
    const [mode] = await sql<{ mode: string }[]>`select read_normalization_writer_capability() as mode`;
    expect(mode?.mode).toBe('legacy');
    await expect(sql`
      select enqueue_initial_candidate_normalization(
        ${fixture.candidateId}, 'ko', 'canonical'
      )
    `).rejects.toThrow(/writer_mode/i);
    await sql`delete from jobs where id = ${fixture.job.job_id}`;
    const [first] = await sql<{ result: EnqueuedNormalization }[]>`
      select enqueue_initial_candidate_normalization(
        ${fixture.candidateId}, 'ko', 'legacy'
      ) as result
    `;
    const [second] = await sql<{ result: EnqueuedNormalization }[]>`
      select enqueue_initial_candidate_normalization(
        ${fixture.candidateId}, 'ko', 'legacy'
      ) as result
    `;
    expect(second?.result).toEqual(first?.result);
    expect(first?.result.idempotency_key).toBe(`normalize:${fixture.candidateId}`);
    const [job] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from jobs where id = ${first?.result.job_id ?? null}
    `;
    expect(job?.payload).toEqual({ candidateIds: [fixture.candidateId], locale: 'ko' });
  });
});
