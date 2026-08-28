# Local Supabase Integration Tests

`pnpm test` remains the fast workspace gate. It does not provision or inject local Supabase credentials, so integration suites that require a service-role client may be skipped when those variables are absent.

Use `pnpm test:integration` for the explicit local integration gate. The command fails before running any suite unless all required environment variables are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TEST_DATABASE_URL`

## Prerequisites

- Docker Desktop is running.
- Local Supabase has been started and migrations have been applied.
- Run against local Supabase only. Do not point this command at a shared or production project.

```powershell
pnpm exec supabase start
# Optional: reset the local database and reapply every migration.
pnpm exec supabase db reset
```

## PowerShell execution

Read local-only values directly from the Supabase CLI into the current PowerShell process. Do not write them to `.env` files, source control, terminal transcripts, or documentation.

```powershell
$values = @{}
(& pnpm exec supabase status -o env) | ForEach-Object {
  if ($_ -match '^([^=]+)="?(.*?)"?$') {
    $values[$matches[1]] = $matches[2].TrimEnd('"')
  }
}

$env:SUPABASE_URL = $values['API_URL']
$env:SUPABASE_SERVICE_ROLE_KEY = $values['SERVICE_ROLE_KEY']
$env:TEST_DATABASE_URL = $values['DB_URL']

pnpm test:integration
```

## Coverage

The gate executes the dedicated integration files directly:

- `packages/db/src/core-schema.integration.test.ts`
- `packages/queue/src/queue.integration.test.ts`
- `apps/worker/src/jobs/import-opportunity-csv.integration.test.ts`
- `apps/worker/src/jobs/normalize-opportunities.integration.test.ts`
- `apps/worker/src/providers/provider-catalog.integration.test.ts`
- `apps/web/app/api/ai-providers/settings-catalog.integration.test.ts`

The command intentionally selects files, not a fixed test count.

The suites create and remove their local fixture records. A failed run may leave only local test rows; use `pnpm exec supabase db reset` to return to a clean local database.

## Web E2E

`pnpm --filter @ara/web test:e2e` fail-closes login when durable login-guard RPCs cannot reach local Supabase. Inject the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` values used for `pnpm test:integration` into the process before running Playwright. Do not weaken fail-closed login to make E2E pass without a database.

Command providers on Windows kill only the immediate child process. Production workers are Oracle Ubuntu ARM64 and use process-group termination.

