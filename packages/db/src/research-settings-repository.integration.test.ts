import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESEARCH_BUSINESS_SETTINGS } from '@ara/shared';
import { createServerDatabaseClient } from './client';
import { createResearchSettingsRepository } from './research-settings-repository';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sql = postgres(databaseUrl, { max: 2 });
const client = createServerDatabaseClient({
  url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'local-test-key'
});
const repository = createResearchSettingsRepository(client);

afterAll(async () => {
  await sql.end();
});

describe('research settings repository integration', () => {
  it('seeds one default settings row and preserves unrelated settings during a four-field save', async () => {
    const initial = await repository.read();
    await sql`
      update app_settings
      set locale = 'en', daily_api_budget = 17, telegram_enabled = true,
          telegram_chat_id = ${`db-it-settings-${randomUUID()}`}
      where id = true
    `;

    const saved = await repository.save({
      launchBudgetUsd: 4500,
      minimumPreAdMarginPct: 40,
      minimumPostAdMarginPct: 30,
      minimumRoiPct: 175
    });
    const [stored] = await sql<{
      launch_budget_usd: number;
      minimum_pre_ad_margin_pct: number;
      minimum_post_ad_margin_pct: number;
      minimum_roi_pct: number;
      locale: string;
      daily_api_budget: number;
      telegram_enabled: boolean;
    }[]>`
      select launch_budget_usd::double precision as launch_budget_usd,
             minimum_pre_ad_margin_pct::double precision as minimum_pre_ad_margin_pct,
             minimum_post_ad_margin_pct::double precision as minimum_post_ad_margin_pct,
             minimum_roi_pct::double precision as minimum_roi_pct,
             locale, daily_api_budget, telegram_enabled
      from app_settings where id = true
    `;

    expect(initial).toEqual(DEFAULT_RESEARCH_BUSINESS_SETTINGS);
    expect(saved).toEqual({
      launchBudgetUsd: 4500,
      minimumPreAdMarginPct: 40,
      minimumPostAdMarginPct: 30,
      minimumRoiPct: 175
    });
    expect(stored).toEqual({
      launch_budget_usd: 4500,
      minimum_pre_ad_margin_pct: 40,
      minimum_post_ad_margin_pct: 30,
      minimum_roi_pct: 175,
      locale: 'en',
      daily_api_budget: 17,
      telegram_enabled: true
    });
  });

  it('rejects non-finite and out-of-range values at the database boundary', async () => {
    const invalidWrites = [
      sql`update app_settings set launch_budget_usd = 'NaN'::numeric where id = true`,
      sql`update app_settings set launch_budget_usd = 'Infinity'::numeric where id = true`,
      sql`update app_settings set launch_budget_usd = '-Infinity'::numeric where id = true`,
      sql`update app_settings set minimum_pre_ad_margin_pct = 101 where id = true`,
      sql`update app_settings set minimum_post_ad_margin_pct = -1 where id = true`,
      sql`update app_settings set minimum_roi_pct = 'NaN'::numeric where id = true`
    ];

    const outcomes = await Promise.all(invalidWrites.map(async (write) => expect(write).rejects.toThrow()));

    expect(outcomes).toHaveLength(6);
  });

  it('fails closed when the singleton settings row is absent at runtime', async () => {
    await sql`delete from app_settings where id = true`;

    const read = repository.read();

    await expect(read).rejects.toThrow('Could not load research settings.');
  });
});
