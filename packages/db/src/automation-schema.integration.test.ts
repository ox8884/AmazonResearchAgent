import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 4 });

async function clearAutomationFixtures(): Promise<void> {
  await sql`delete from notifications where idempotency_key like 'db-it-automation-%'`;
  await sql`delete from scheduled_run_locks where run_date >= date '2099-01-01'`;
  await sql`delete from research_runs where idempotency_key like 'db-it-automation-%'`;
  await sql`delete from app_settings where id`;
}

describe('automation schema', () => {
  beforeEach(clearAutomationFixtures);
  afterAll(async () => {
    await clearAutomationFixtures();
    await sql.end();
  });

  // Break: a second personal settings row can exist and produces conflicting automation policy.
  it('enforces one personal settings record', async () => {
    await sql`insert into app_settings (id) values (true)`;

    await expect(sql`insert into app_settings (id) values (true)`).rejects.toThrow();
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
