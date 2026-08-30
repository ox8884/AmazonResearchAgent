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
};

async function seedReadyProvider(adapter: 'codex' | 'grok' = 'codex'): Promise<ProviderFixture> {
  const suffix = randomUUID();
  const providerId = `${adapter}-${suffix}`;
  const modelId = `model-${suffix}`;
  const fingerprint = `fingerprint-${suffix}`;
  const termsDigest = `terms-${suffix}`;
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
      'subscription-isolation-v1', 'ready-lease-v1', ${termsDigest},
      ${`credential-${suffix}`}, ${`binary-${suffix}`}, ${`capability-${suffix}`},
      ${`framing-${suffix}`}, ${`bounded-${suffix}`}, ${`containment-${suffix}`},
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
      ${activated.result.probe_generation}
    )
  `;
  await sql`update jobs set status = 'completed' where id = ${activated.result.job_id}`;
  return { providerId, modelId, fingerprint };
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
    select id, leased_by, attempts from claim_jobs('worker-a', 1, 120)
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

  it('allocates concurrent sequences and persists start before authorization returns', async () => {
    const fixture = await seedCandidateAndLeases();
    const grok = await seedReadyProvider('grok');
    const second = { ...fixture, ...grok };
    const attempts = await Promise.all([beginAttempt(fixture), beginAttempt(second)]);
    expect(attempts.map((attempt) => attempt.attempt_sequence).sort()).toEqual([1, 2]);
    const starts = await sql<{ attempt_id: string; event_type: string }[]>`
      select attempt_id, event_type from provider_attempt_events
      where logical_analysis_id = ${fixture.analysis.analysis_id}
      order by attempt_sequence
    `;
    expect(starts).toHaveLength(2);
    expect(starts.every((event) => event.event_type === 'attempt_started')).toBe(true);
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

  it('rejects a conflicting successful winner and preserves the first staging row', async () => {
    const fixture = await seedCandidateAndLeases();
    const first = await beginAttempt(fixture);
    const grok = await seedReadyProvider('grok');
    const second = await beginAttempt({ ...fixture, ...grok });
    await appendSuccess(fixture, first.attempt_id);
    await expect(
      appendSuccess({ ...fixture, ...grok }, second.attempt_id)
    ).rejects.toThrow(/winner_conflict/i);
    const [state] = await sql<{ winner: string; outcomes: number }[]>`
      select pending_winner_attempt_id as winner,
        (select count(*) from provider_attempt_events
          where attempt_id = ${second.attempt_id} and event_type <> 'attempt_started')::integer as outcomes
      from ai_analyses where id = ${fixture.analysis.analysis_id}
    `;
    expect(state).toEqual({ winner: first.attempt_id, outcomes: 0 });
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
