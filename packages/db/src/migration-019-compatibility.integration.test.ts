import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await sql.end();
});

describe('migration 019 nullable RPC compatibility', () => {
  // Break: PostgreSQL rejects explicit NULL even though the application domain legitimately needs it.
  it('database accepts explicit null daily completion and rejects omission', async () => {
    const runId = randomUUID();
    const runDate = `${3000 + (Number.parseInt(runId.slice(0, 4), 16) % 6000)}-02-01`;
    const idempotencyKey = `migration-019-null-${runId}`;

    try {
      await sql`
        insert into research_runs (
          id, source, logical_run_date, locale, status, idempotency_key, checkpoint
        ) values (
          ${runId}, 'manual', ${runDate}, 'ko', 'fanout', ${idempotencyKey},
          ${sql.json({ phase: 'fanout', enqueuedCandidateIds: [] })}
        )
      `;

      const [result] = await sql<{ accepted: boolean }[]>`
        select advance_daily_research_checkpoint(
          ${runId}::uuid,
          'completed',
          ${sql.json({ phase: 'fanout_complete', enqueuedCandidateIds: [] })},
          null::timestamptz
        ) as accepted
      `;
      const [stored] = await sql<{ completed_at: Date | null }[]>`
        select completed_at from research_runs where id = ${runId}::uuid
      `;

      expect(result?.accepted).toBe(true);
      expect(stored?.completed_at).toBeNull();
      await expect(
        sql.unsafe(
          `select advance_daily_research_checkpoint('${runId}'::uuid, 'completed', '{}'::jsonb)`
        )
      ).rejects.toThrow(/advance_daily_research_checkpoint/u);
    } finally {
      await sql`delete from research_runs where id = ${runId}::uuid`;
    }
  });

  // Break: nullable canonical English is rejected or NULL overwrites an existing translation.
  it('database accepts explicit null canonical English and rejects omission', async () => {
    const suffix = randomUUID();
    const canonicalKey = `migration 019 nullable ${suffix}`;
    const canonicalName = `Migration 019 Nullable ${suffix}`;

    try {
      const [created] = await sql<{ cluster_id: string }[]>`
        select upsert_niche_cluster(
          ${canonicalKey}, ${canonicalName}, null::text,
          '[]'::jsonb, '[]'::jsonb, 'Ready for API Validation'
        ) as cluster_id
      `;
      if (!created) {
        throw new Error('Expected nullable canonical English fixture cluster.');
      }
      const [initial] = await sql<{ canonical_english: string | null }[]>`
        select canonical_english from niche_clusters where id = ${created.cluster_id}::uuid
      `;
      expect(initial?.canonical_english).toBeNull();

      await sql`
        update niche_clusters
        set canonical_english = 'Existing English'
        where id = ${created.cluster_id}::uuid
      `;
      await sql`
        select upsert_niche_cluster(
          ${canonicalKey}, ${canonicalName}, null::text,
          '[]'::jsonb, '[]'::jsonb, 'Ready for API Validation'
        )
      `;
      const [preserved] = await sql<{ canonical_english: string | null }[]>`
        select canonical_english from niche_clusters where id = ${created.cluster_id}::uuid
      `;
      expect(preserved?.canonical_english).toBe('Existing English');

      await expect(
        sql.unsafe(
          `select upsert_niche_cluster('${canonicalKey}', '${canonicalName}', '[]'::jsonb, '[]'::jsonb, 'Ready for API Validation')`
        )
      ).rejects.toThrow(/upsert_niche_cluster/u);
    } finally {
      await sql`delete from niche_clusters where canonical_key = canonical_niche_key(${canonicalKey})`;
    }
  });
});
