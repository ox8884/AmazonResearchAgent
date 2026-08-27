import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 12 });
const BUDGET_DATE = '2099-01-15';

type AuthorizationRow = {
  decision_kind: string;
  cache_key: string;
  remaining: number | null;
};

describe('authorize_api_call RPC', () => {
  beforeEach(async () => {
    await sql`delete from api_cache where cache_key like 'db-it-budget-%'`;
    await sql`delete from api_budget_daily where budget_date = ${BUDGET_DATE}::date`;
  });

  afterAll(async () => {
    await sql`delete from api_cache where cache_key like 'db-it-budget-%'`;
    await sql`delete from api_budget_daily where budget_date = ${BUDGET_DATE}::date`;
    await sql.end();
  });

  // Break: two workers both consume the last remaining call.
  it('authorizes only one of ten concurrent requests for the final call', async () => {
    await sql`
      insert into api_budget_daily (
        budget_date, daily_limit, reserved_limit, used_count, reserved_used_count
      )
      values (${BUDGET_DATE}::date, 6, 0, 5, 0)
    `;

    const rows = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        sql<AuthorizationRow[]>`
          select decision_kind, cache_key, remaining
          from authorize_api_call(
            'normal_validation',
            1,
            ${`db-it-budget-${index}`},
            'product_database',
            6,
            0,
            ${BUDGET_DATE}::date
          )
        `
      )
    );

    const kinds = rows.flat().map((row) => row.decision_kind);
    const [budget] = await sql<{ used_count: number }[]>`
      select used_count from api_budget_daily where budget_date = ${BUDGET_DATE}::date
    `;

    expect(kinds.filter((kind) => kind === 'authorized')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'budget_exhausted')).toHaveLength(9);
    expect(budget?.used_count).toBe(6);
  });

  // Break: a fresh cache row still increments used_count.
  it('returns cache_hit without consuming budget', async () => {
    const cacheKey = `db-it-budget-${randomUUID()}`;
    await sql`
      insert into api_cache (cache_key, endpoint, response, expires_at)
      values (
        ${cacheKey},
        'product_database',
        '{}'::jsonb,
        now() + interval '1 hour'
      )
    `;

    const [row] = await sql<AuthorizationRow[]>`
      select decision_kind, cache_key, remaining
      from authorize_api_call(
        'normal_validation',
        1,
        ${cacheKey},
        'product_database',
        20,
        5,
        ${BUDGET_DATE}::date
      )
    `;
    const [budget] = await sql<{ used_count: number }[]>`
      select used_count from api_budget_daily where budget_date = ${BUDGET_DATE}::date
    `;

    expect(row?.decision_kind).toBe('cache_hit');
    expect(row?.cache_key).toBe(cacheKey);
    expect(budget?.used_count ?? 0).toBe(0);
  });

  // Break: normal validation spends the reserved remainder.
  it('preserves reserve for normal validation and allows manual research to use it', async () => {
    await sql`
      insert into api_budget_daily (
        budget_date, daily_limit, reserved_limit, used_count, reserved_used_count
      )
      values (${BUDGET_DATE}::date, 20, 5, 15, 0)
    `;
    const cacheKey = `db-it-budget-${randomUUID()}`;

    const [normal] = await sql<AuthorizationRow[]>`
      select decision_kind, cache_key, remaining
      from authorize_api_call(
        'normal_validation',
        1,
        ${cacheKey},
        'product_database',
        20,
        5,
        ${BUDGET_DATE}::date
      )
    `;
    const [manual] = await sql<AuthorizationRow[]>`
      select decision_kind, cache_key, remaining
      from authorize_api_call(
        'manual_research',
        1,
        ${`${cacheKey}-manual`},
        'product_database',
        20,
        5,
        ${BUDGET_DATE}::date
      )
    `;
    const [budget] = await sql<{ used_count: number; reserved_used_count: number }[]>`
      select used_count, reserved_used_count
      from api_budget_daily
      where budget_date = ${BUDGET_DATE}::date
    `;

    expect(normal?.decision_kind).toBe('budget_exhausted');
    expect(manual?.decision_kind).toBe('authorized');
    expect(budget).toMatchObject({ used_count: 16, reserved_used_count: 1 });
  });

  // Break: a later authorization resets used_count instead of incrementing it.
  it('does not reset persisted usage on a later authorization', async () => {
    await sql`
      insert into api_budget_daily (
        budget_date, daily_limit, reserved_limit, used_count, reserved_used_count
      )
      values (${BUDGET_DATE}::date, 20, 5, 4, 0)
    `;

    const [row] = await sql<AuthorizationRow[]>`
      select decision_kind, remaining
      from authorize_api_call(
        'normal_validation',
        1,
        ${`db-it-budget-${randomUUID()}`},
        'product_database',
        20,
        5,
        ${BUDGET_DATE}::date
      )
    `;
    const [budget] = await sql<{ used_count: number }[]>`
      select used_count from api_budget_daily where budget_date = ${BUDGET_DATE}::date
    `;

    expect(row?.decision_kind).toBe('authorized');
    expect(row?.remaining).toBe(15);
    expect(budget?.used_count).toBe(5);
  });
});
