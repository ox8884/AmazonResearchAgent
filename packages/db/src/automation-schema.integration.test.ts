import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 4 });

async function clearAutomationFixtures(): Promise<void> {
  await sql`delete from notifications where idempotency_key like 'db-it-automation-%'`;
  await sql`
    delete from scheduled_run_locks
    where research_run_id in (
      select id from research_runs where idempotency_key like 'db-it-automation-%'
    )
  `;
  await sql`delete from research_runs where idempotency_key like 'db-it-automation-%'`;
}

describe('automation schema', () => {
  beforeEach(clearAutomationFixtures);
  afterAll(async () => {
    await clearAutomationFixtures();
    await sql.end();
  });

  // Break: a test fixture can overwrite or remove a preexisting singleton settings row.
  it('enforces one personal settings record without mutating a preexisting row', async () => {
    const [existing] = await sql<{ id: boolean }[]>`select id from app_settings where id`;
    let createdFixture = false;
    if (!existing) {
      await sql`insert into app_settings (id) values (true)`;
      createdFixture = true;
    }

    try {
      await expect(sql`insert into app_settings (id) values (true)`).rejects.toThrow();
    } finally {
      if (createdFixture) {
        await sql`delete from app_settings where id`;
      }
    }
  });
  // Break: duplicate scheduler ticks create duplicate logical research runs for one Chicago date.
  it('creates one scheduled run for one logical date', async () => {
    await sql`
      insert into research_runs (source, logical_run_date, idempotency_key)
      values ('scheduled', date '2099-01-01', 'db-it-automation-daily-1')
    `;

    await expect(sql`
      insert into research_runs (source, logical_run_date, idempotency_key)
      values ('scheduled', date '2099-01-01', 'db-it-automation-daily-2')
    `).rejects.toThrow();
  });
  // Break: concurrent planners can replace a previously published daily plan.
  it('publishes a daily plan only once and preserves the winning candidate set', async () => {
    const [run] = await sql<{ id: string }[]>`
      insert into research_runs (source, logical_run_date, idempotency_key)
      values ('scheduled', date '2099-01-03', 'db-it-automation-plan')
      returning id
    `;
    if (!run) throw new Error('Daily plan fixture was not created.');
    const first = await sql<{ published: boolean }[]>`
      select publish_daily_research_plan(
        ${run.id}::uuid,
        ${sql.json(['candidate-a'])},
        ${sql.json({ phase: 'fanout' })},
        now()
      ) as published
    `;
    const second = await sql<{ published: boolean }[]>`
      select publish_daily_research_plan(
        ${run.id}::uuid,
        ${sql.json(['candidate-b'])},
        ${sql.json({ phase: 'fanout' })},
        now()
      ) as published
    `;
    const [stored] = await sql<{ selected_candidate_ids: unknown }[]>`
      select selected_candidate_ids
      from research_runs
      where id = ${run.id}::uuid
    `;
    expect(first[0]?.published).toBe(true);
    expect(second[0]?.published).toBe(false);
    expect(stored?.selected_candidate_ids).toEqual(['candidate-a']);
  });

  // Break: a stale fanout write can replace a completed daily-research checkpoint.
  it('rejects checkpoint regression after a daily run is completed', async () => {
    const [run] = await sql<{ id: string }[]>`
      insert into research_runs (
        source,
        logical_run_date,
        idempotency_key,
        status,
        checkpoint
      )
      values (
        'scheduled',
        date '2099-01-04',
        'db-it-automation-checkpoint',
        'completed',
        '{"phase":"fanout_complete","selectedItems":[{"id":"00000000-0000-4000-8000-00000000000a","bucket":"new"}],"enqueuedCandidateIds":["00000000-0000-4000-8000-00000000000a"]}'::jsonb
      )
      returning id
    `;
    if (!run) throw new Error('Checkpoint fixture was not created.');

    const rejected = await sql<{ advanced: boolean }[]>`
      select advance_daily_research_checkpoint(
        ${run.id}::uuid,
        'fanout',
        ${sql.json({
          phase: 'fanout',
          selectedItems: [
            { id: '00000000-0000-4000-8000-00000000000a', bucket: 'new' }
          ],
          enqueuedCandidateIds: []
        })},
        null
      ) as advanced
    `;
    const accepted = await sql<{ advanced: boolean }[]>`
      select advance_daily_research_checkpoint(
        ${run.id}::uuid,
        'completed',
        ${sql.json({
          phase: 'fanout_complete',
          selectedItems: [
            { id: '00000000-0000-4000-8000-00000000000a', bucket: 'new' }
          ],
          enqueuedCandidateIds: ['00000000-0000-4000-8000-00000000000a']
        })},
        now()
      ) as advanced
    `;
    const [stored] = await sql<{ status: string; checkpoint: { phase: string } }[]>`
      select status, checkpoint from research_runs where id = ${run.id}::uuid
    `;

    expect(rejected[0]?.advanced).toBe(false);
    expect(accepted[0]?.advanced).toBe(true);
    expect(stored).toMatchObject({
      status: 'completed',
      checkpoint: { phase: 'fanout_complete' }
    });
  });

  // Break: a retry can create a second outbound Telegram delivery for one logical event.
  it('deduplicates notification delivery identity', async () => {
    await sql`
      insert into notifications (event_type, idempotency_key)
      values ('DAILY_SUMMARY', 'db-it-automation-notification')
    `;

    await expect(sql`
      insert into notifications (event_type, idempotency_key)
      values ('DAILY_SUMMARY', 'db-it-automation-notification')
    `).rejects.toThrow();
  });
});
