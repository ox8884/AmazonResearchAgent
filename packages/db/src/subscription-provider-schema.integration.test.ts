import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertDatabaseIdentifier,
  assertRunId,
  createDatabase,
  dropDatabase as dropHarnessDatabase,
  withGlobalDdlLock,
} from '../../../test-harness/harness-boundaries.mjs';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const admin = postgres(databaseUrl, { max: 1 });
const migrationsDirectory = resolve(import.meta.dirname, '../../../supabase/migrations');
const migration019 = '202608290019_subscription_ai_provider_schema.sql';
const harnessRunId = process.env.ARA_TEST_RUN_ID === undefined
  ? undefined
  : assertRunId(process.env.ARA_TEST_RUN_ID);
const deferDatabaseCleanup = harnessRunId !== undefined;
const templateDatabase = assertDatabaseIdentifier(
  `${harnessRunId ?? 'subscription_schema'}_template_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
);
const caseDatabases = Array.from(
  { length: 12 },
  (_, index) => assertDatabaseIdentifier(
    `${harnessRunId ?? 'subscription_schema'}_case_${index}_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  ),
);
let nextCaseDatabase = 0;
async function migrationFilesBefore019(): Promise<readonly string[]> {
  return (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql') && file < migration019)
    .sort();
}

beforeAll(async () => {
  await withGlobalDdlLock(admin, async () => {
    await createDatabase(admin, templateDatabase);
    const templateUrl = new URL(databaseUrl);
    templateUrl.pathname = `/${templateDatabase}`;
    const template = postgres(templateUrl.toString(), { max: 1 });
    try {
      await template.unsafe('create schema extensions');
      await template.unsafe(`
        create schema storage;
        create table storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
      `);
      for (const file of await migrationFilesBefore019()) {
        await template.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
      }
    } finally {
      await template.end();
    }
    for (const caseDatabase of caseDatabases) {
      await createDatabase(admin, caseDatabase, templateDatabase);
    }
  });
});
async function dropDatabase(name: string): Promise<void> {
  await withGlobalDdlLock(admin, async () => dropHarnessDatabase(admin, name));
}

async function withDatabase(
  arrange: (sql: postgres.Sql) => Promise<void>,
  verify: (sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const databaseName = caseDatabases[nextCaseDatabase++];
  if (!databaseName) {
    throw new Error('subscription schema case database pool exhausted');
  }
  const testUrl = new URL(databaseUrl);
  testUrl.pathname = `/${databaseName}`;
  const sql = postgres(testUrl.toString(), { max: 1 });

  try {
    await arrange(sql);
    await sql.unsafe(await readFile(resolve(migrationsDirectory, migration019), 'utf8'));
    await verify(sql);
  } finally {
    await sql.end();
    if (!deferDatabaseCleanup) {
      await dropDatabase(databaseName);
    }
}
}


async function expectMigrationFailure(
  arrange: (sql: postgres.Sql) => Promise<void>,
  expected: RegExp,
): Promise<void> {
  await expect(withDatabase(arrange, async () => undefined)).rejects.toThrow(expected);
}

async function insertProvider(
  sql: postgres.Sql,
  values: {
    readonly id: string;
    readonly kind: 'openai_http' | 'command';
    readonly billing: 'free' | 'subscription' | 'payg';
    readonly enabled?: boolean;
    readonly config?: postgres.JSONValue;
  },
): Promise<void> {
  await sql`
    insert into ai_providers (id, name, kind, billing_type, enabled, config)
    values (
      ${values.id},
      ${values.id},
      ${values.kind},
      ${values.billing},
      ${values.enabled ?? false},
      ${sql.json(values.config ?? {})}
    )
  `;
}

async function insertModel(
  sql: postgres.Sql,
  providerId: string,
  billing: 'free' | 'subscription' | 'payg',
  enabled = false,
): Promise<void> {
  await sql`
    insert into ai_models (
      provider_id, model_id, display_name, billing_type, enabled
    ) values (${providerId}, 'model-1', 'Model 1', ${billing}, ${enabled})
  `;
}

afterAll(async () => {
  if (!deferDatabaseCleanup) {
    for (const caseDatabase of caseDatabases) {
      await dropDatabase(caseDatabase);
    }
    await dropDatabase(templateDatabase);
  }
  await admin.end();
});

describe('subscription provider migration 019', () => {
  // Break: migration 019 rejects or mutates a valid HTTP provider and its secret.
  it('preserves a valid existing HTTP provider', async () => {
    await withDatabase(
      async (sql) => {
        await insertProvider(sql, {
          id: 'http-valid',
          kind: 'openai_http',
          billing: 'payg',
          enabled: true,
          config: { baseUrl: 'https://api.example.com/v1', executionIdentity: 'http-v1' },
        });
        await insertModel(sql, 'http-valid', 'payg', true);
        await sql`
          insert into provider_secrets (provider_id, ciphertext, iv, auth_tag, last4)
          values ('http-valid', 'ciphertext', 'iv', 'tag', '1234')
        `;
      },
      async (sql) => {
        const [provider] = await sql<
          { kind: string; adapter: string | null; billing_type: string; enabled: boolean }[]
        >`select kind, adapter, billing_type, enabled from ai_providers where id = 'http-valid'`;
        const [secret] = await sql<{ last4: string }[]>`
          select last4 from provider_secrets where provider_id = 'http-valid'
        `;
        expect(provider).toEqual({
          kind: 'openai_http',
          adapter: null,
          billing_type: 'payg',
          enabled: true,
        });
        expect(secret?.last4).toBe('1234');
      },
    );
  });

  // Break: the migration-019 settings RPC omits the stored nullable adapter.
  it('returns the stored adapter in the committed settings snapshot', async () => {
    await withDatabase(
      async (sql) => {
        await insertProvider(sql, {
          id: 'http-settings-snapshot',
          kind: 'openai_http',
          billing: 'subscription',
          config: { baseUrl: 'https://api.example.com/v1' },
        });
      },
      async (sql) => {
        const [result] = await sql<{ saved: Record<string, postgres.JSONValue> }[]>`
          select save_ai_provider_settings(
            jsonb_build_object(
              'id', 'http-settings-snapshot',
              'name', 'HTTP settings snapshot',
              'kind', 'openai_http',
              'billing_type', 'subscription',
              'enabled', true,
              'priority', 1,
              'config', jsonb_build_object('baseUrl', 'https://api.example.com/v1')
            ),
            null,
            '[]'::jsonb,
            'none'
          ) as saved
        `;

        expect(result?.saved).toHaveProperty('adapter', null);
      },
    );
  });

  // Break: migration 019 rejects readable test-only legacy command rows.
  it('preserves a valid legacy command provider', async () => {
    await withDatabase(
      async (sql) => {
        await insertProvider(sql, {
          id: 'command-valid',
          kind: 'command',
          billing: 'free',
          config: { command: 'fixture', args: ['--json'] },
        });
        await insertModel(sql, 'command-valid', 'free');
      },
      async (sql) => {
        const [provider] = await sql<
          { kind: string; adapter: string | null; config: unknown }[]
        >`select kind, adapter, config from ai_providers where id = 'command-valid'`;
        expect(provider).toMatchObject({
          kind: 'command',
          adapter: null,
          config: { command: 'fixture', args: ['--json'] },
        });
      },
    );
  });

  // Break: an existing provider/model billing mismatch is silently normalized.
  it('aborts on existing provider-model billing mismatch', async () => {
    await expectMigrationFailure(async (sql) => {
      await insertProvider(sql, {
        id: 'billing-mismatch',
        kind: 'openai_http',
        billing: 'payg',
      });
      await insertModel(sql, 'billing-mismatch', 'subscription');
    }, /provider_model_billing_mismatch.*billing-mismatch/i);
  });

  // Break: a command provider reaches migration 019 while retaining secret material.
  it('aborts on a forbidden existing secret', async () => {
    await expectMigrationFailure(async (sql) => {
      await insertProvider(sql, {
        id: 'command-secret',
        kind: 'command',
        billing: 'free',
      });
      await sql`
        insert into provider_secrets (provider_id, ciphertext, iv, auth_tag, last4)
        values ('command-secret', 'ciphertext', 'iv', 'tag', '1234')
      `;
    }, /forbidden_provider_secret.*command-secret/i);
  });

  // Break: cross-family or future adapter keys survive preflight and become ambiguous.
  it('aborts on cross-family config or adapter collision', async () => {
    await expectMigrationFailure(async (sql) => {
      await insertProvider(sql, {
        id: 'cross-family',
        kind: 'openai_http',
        billing: 'subscription',
        config: { command: 'codex', adapter: 'codex' },
      });
    }, /cross_family_provider_config.*cross-family/i);
  });

  // Break: a legacy command provider with unsupported PAYG billing reaches the
  // later CHECK instead of deterministic sanitized preflight classification.
  it('aborts on unsupported existing command billing during preflight', async () => {
    await expectMigrationFailure(async (sql) => {
      await insertProvider(sql, {
        id: 'command-payg-unsupported',
        kind: 'command',
        billing: 'payg',
      });
    }, /unsupported_command_billing.*command-payg-unsupported/i);
  });

  // Break: the database admits unsupported kind/adapter/billing combinations.
  it('accepts only the approved kind-adapter-billing matrix', async () => {
    await withDatabase(
      async () => undefined,
      async (sql) => {
        await insertProvider(sql, {
          id: 'http-new',
          kind: 'openai_http',
          billing: 'subscription',
        });
        await expect(sql`
          insert into ai_providers (
            id, name, kind, adapter, billing_type, enabled, config
          ) values (
            'subscription-invalid', 'subscription-invalid',
            'subscription_command', null, 'subscription', false, '{}'::jsonb
          )
        `).rejects.toThrow();
        await expect(sql`
          insert into ai_providers (
            id, name, kind, adapter, billing_type, enabled, config
          ) values (
            'subscription-valid', 'subscription-valid',
            'subscription_command', 'codex', 'subscription', false, '{}'::jsonb
          )
        `).resolves.toBeDefined();
        await expect(sql`
          insert into provider_secrets (provider_id, ciphertext, iv, auth_tag, last4)
          values ('subscription-valid', 'ciphertext', 'iv', 'tag', '1234')
        `).rejects.toThrow();
        await expect(sql`
          insert into ai_providers (
            id, name, kind, adapter, billing_type, enabled, config
          ) values (
            'subscription-duplicate', 'subscription-duplicate',
            'subscription_command', 'codex', 'subscription', false, '{}'::jsonb
          )
        `).rejects.toThrow();
      },
    );
  });

  // Break: ordinary settings edits convert one execution family into another.
  it('keeps provider family immutable', async () => {
    await withDatabase(
      async () => undefined,
      async (sql) => {
        await insertProvider(sql, {
          id: 'immutable-http',
          kind: 'openai_http',
          billing: 'payg',
        });
        await expect(sql`
          update ai_providers
          set kind = 'subscription_command', adapter = 'grok', billing_type = 'subscription'
          where id = 'immutable-http'
        `).rejects.toThrow(/provider_family_immutable/i);
      },
    );
  });

  // Break: a subscription model is enabled without adapter-owned capability proof.
  it('keeps unproven subscription models disabled', async () => {
    await withDatabase(
      async () => undefined,
      async (sql) => {
        await sql`
          insert into ai_providers (
            id, name, kind, adapter, billing_type, enabled, config
          ) values (
            'subscription-model', 'subscription-model',
            'subscription_command', 'grok', 'subscription', false, '{}'::jsonb
          )
        `;
        await expect(sql`
          insert into ai_models (
            provider_id, model_id, display_name, billing_type, enabled
          ) values ('subscription-model', 'grok-model', 'Grok Model', 'subscription', true)
        `).rejects.toThrow(/subscription_model_requires_capability/i);
      },
    );
  });

  // Break: audit evidence can be rewritten after execution.
  it('rejects updates and deletes of provider attempt events', async () => {
    await withDatabase(
      async () => undefined,
      async (sql) => {
        const attemptId = randomUUID();
        const logicalAnalysisId = randomUUID();
        const jobId = randomUUID();
        await insertProvider(sql, {
          id: 'attempt-provider',
          kind: 'command',
          billing: 'free',
        });
        await sql`
          insert into provider_attempt_events (
            attempt_id, logical_analysis_id, attempt_sequence, event_type,
            provider_id, model_id, role, billing_type, request_count,
            job_id, job_lease_owner, job_lease_epoch,
            analysis_lease_owner, analysis_lease_epoch,
            settings_revision, auth_generation, execution_fingerprint
          ) values (
            ${attemptId}::uuid, ${logicalAnalysisId}::uuid, 1, 'attempt_started',
            'attempt-provider', 'model-1', 'niche_normalization', 'free', 1,
            ${jobId}::uuid, 'worker-a', 1, 'worker-a', 1, 1, 0, 'fixture'
          )
        `;
        await expect(sql`
          update provider_attempt_events set result_class = 'changed'
          where attempt_id = ${attemptId}::uuid
        `).rejects.toThrow(/provider_attempt_events_immutable/i);
        await expect(sql`
          delete from provider_attempt_events where attempt_id = ${attemptId}::uuid
        `).rejects.toThrow(/provider_attempt_events_immutable/i);
      },
    );
  });

  // Break: one attempt records mutually contradictory authoritative outcomes.
  it('rejects contradictory attempt outcomes', async () => {
    await withDatabase(
      async () => undefined,
      async (sql) => {
        const attemptId = randomUUID();
        const logicalAnalysisId = randomUUID();
        const jobId = randomUUID();
        await insertProvider(sql, {
          id: 'outcome-provider',
          kind: 'command',
          billing: 'free',
        });
        await sql`
          insert into provider_attempt_events (
            attempt_id, logical_analysis_id, attempt_sequence, event_type,
            provider_id, model_id, role, billing_type, request_count,
            job_id, job_lease_owner, job_lease_epoch,
            analysis_lease_owner, analysis_lease_epoch,
            settings_revision, auth_generation, execution_fingerprint
          ) values (
            ${attemptId}::uuid, ${logicalAnalysisId}::uuid, 1, 'attempt_started',
            'outcome-provider', 'model-1', 'niche_normalization', 'free', 1,
            ${jobId}::uuid, 'worker-a', 1, 'worker-a', 1, 1, 0, 'fixture'
          )
        `;
        await sql`
          insert into provider_attempt_events (
            attempt_id, logical_analysis_id, attempt_sequence, event_type,
            provider_id, model_id, role, billing_type, request_count,
            job_id, job_lease_owner, job_lease_epoch,
            analysis_lease_owner, analysis_lease_epoch,
            settings_revision, auth_generation, execution_fingerprint,
            consumption_status, result_class, finished_at
          ) values (
            ${attemptId}::uuid, ${logicalAnalysisId}::uuid, 1, 'attempt_failed',
            'outcome-provider', 'model-1', 'niche_normalization', 'free', 1,
            ${jobId}::uuid, 'worker-a', 1, 'worker-a', 1, 1, 0, 'fixture',
            'unknown', 'unsafe_unknown', now()
          )
        `;
        await expect(sql`
          insert into provider_attempt_events (
            attempt_id, logical_analysis_id, attempt_sequence, event_type,
            provider_id, model_id, role, billing_type, request_count,
            job_id, job_lease_owner, job_lease_epoch,
            analysis_lease_owner, analysis_lease_epoch,
            settings_revision, auth_generation, execution_fingerprint,
            consumption_status, result_class, finished_at
          ) values (
            ${attemptId}::uuid, ${logicalAnalysisId}::uuid, 1, 'attempt_succeeded',
            'outcome-provider', 'model-1', 'niche_normalization', 'free', 1,
            ${jobId}::uuid, 'worker-a', 1, 'worker-a', 1, 1, 0, 'fixture',
            'consumed', 'success', now()
          )
        `).rejects.toThrow();
      },
    );
  });
});
