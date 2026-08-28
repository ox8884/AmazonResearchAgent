import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 12 });
const BUDGET_DATE = '2099-02-01';
type ClaimRow = {
  decision_kind: string;
  claimed_cache_key: string;
};


describe('api_call_claims RPC', () => {
  beforeEach(async () => {
    await sql`delete from api_call_claims where cache_key like 'db-it-claim-%'`;
    await sql`delete from api_cache where cache_key like 'db-it-claim-%'`;
    await sql`delete from api_budget_daily where budget_date = ${BUDGET_DATE}::date`;
  });

  afterAll(async () => {
    await sql`delete from api_call_claims where cache_key like 'db-it-claim-%'`;
    await sql`delete from api_cache where cache_key like 'db-it-claim-%'`;
    await sql`delete from api_budget_daily where budget_date = ${BUDGET_DATE}::date`;
    await sql.end();
  });

  // Break: a queue retry of the same cache key increments used_count again.
  it('does not consume budget twice for a reserved logical call', async () => {
    const cacheKey = `db-it-claim-${randomUUID()}`;
    await sql`
      insert into api_budget_daily (
        budget_date, daily_limit, reserved_limit, used_count, reserved_used_count
      )
      values (${BUDGET_DATE}::date, 20, 5, 0, 0)
    `;

    const [firstClaim] = await sql<ClaimRow[]>`
      select decision_kind, claimed_cache_key
      from claim_api_call(${cacheKey}, 'worker-a', 60)
    `;

    const [firstAuth] = await sql<{ decision_kind: string }[]>`
      select decision_kind
      from authorize_api_call(
        'normal_validation', 1, ${cacheKey}, 'product_database', 20, 5, ${BUDGET_DATE}::date
      )
    `;
    await sql`select mark_api_call_reserved(${cacheKey}, ${BUDGET_DATE}::date)`;

    const [secondClaim] = await sql<ClaimRow[]>`
      select decision_kind, claimed_cache_key
      from claim_api_call(${cacheKey}, 'worker-a', 60)
    `;

    const [reserved] = await sql<{ reserved: boolean }[]>`
      select reserved from api_call_claims where cache_key = ${cacheKey}
    `;
    const [budget] = await sql<{ used_count: number }[]>`
      select used_count from api_budget_daily where budget_date = ${BUDGET_DATE}::date
    `;

    expect(firstClaim?.decision_kind).toBe('claimed');
    expect(firstAuth?.decision_kind).toBe('authorized');
    expect(secondClaim?.decision_kind).toBe('claimed');
    expect(reserved?.reserved).toBe(true);
    expect(budget?.used_count).toBe(1);
  });

  // Break: two workers both perform the paid request for one cache key.
  it('lets only one owner claim a live cache key', async () => {
    const cacheKey = `db-it-claim-${randomUUID()}`;
    const [first] = await sql<ClaimRow[]>`
      select decision_kind from claim_api_call(${cacheKey}, 'worker-a', 60)
    `;
    const [second] = await sql<ClaimRow[]>`
      select decision_kind from claim_api_call(${cacheKey}, 'worker-b', 60)
    `;
    expect(first?.decision_kind).toBe('claimed');
    expect(second?.decision_kind).toBe('in_flight');
  });

  // Break: concurrent claim inserts both return claimed.
  it('serializes concurrent claims on the same cache key', async () => {
    const cacheKey = `db-it-claim-${randomUUID()}`;
    const rows = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        sql<ClaimRow[]>`
          select decision_kind from claim_api_call(${cacheKey}, ${`worker-${index}`}, 60)
        `
      )
    );
    const kinds = rows.flat().map((row) => row.decision_kind);
    expect(kinds.filter((kind) => kind === 'claimed')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'in_flight')).toHaveLength(7);
  });

  // Break: HTTP success that never reached api_cache is lost and paid again.
  it('keeps a staged response across retry without writing api_cache', async () => {
    const cacheKey = `db-it-claim-${randomUUID()}`;
    await sql`select claim_api_call(${cacheKey}, 'worker-a', 60)`;
    await sql`
      select stage_api_call_response(
        ${cacheKey},
        'worker-a',
        ${sql.json({ page: { data: [] }, status: 200, httpAttempts: 1 })}
      )
    `;
    const [row] = await sql<{ staged_response: unknown }[]>`
      select staged_response from api_call_claims where cache_key = ${cacheKey}
    `;
    const [cache] = await sql<{ cache_key: string }[]>`
      select cache_key from api_cache where cache_key = ${cacheKey}
    `;
    expect(row?.staged_response).toMatchObject({
      status: 200,
      httpAttempts: 1
    });
    expect(cache).toBeUndefined();
  });
});
