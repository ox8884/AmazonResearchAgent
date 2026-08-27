# Milestone 1 Verification

Date: 2026-08-27
Branch: `plan-01-research-foundation`

## Release-gate scenario

1. `pnpm exec supabase db reset` — PASS
   - Applied `202608260001_core_research.sql`, `202608260002_job_checkpoints_and_audit_keys.sql`, and `202608260003_private_import_storage.sql`.
2. Started `pnpm --filter @ara/worker dev` and `pnpm --filter @ara/web dev` with local Supabase server credentials injected only into process environments.
3. Uploaded three sanitized 100-row Opportunity Finder CSV files through `http://localhost:3102/ko/imports/new`.
   - First upload returned Import Run `e960996b-9b21-464d-aa84-a9f6aa37bc27` and the worker completed the durable import job.
4. Ran the Milestone 1 database SQL invariants through the local `DATABASE_URL`.

| SQL invariant | Result |
| --- | ---: |
| `select count(*) from import_runs` | 1 |
| `select count(*) from raw_opportunity_keywords` | 300 |
| `select count(*) from decision_history where reasons is not null` | 285 |
| `select idempotency_key, count(*) from jobs group by idempotency_key having count(*) > 1` | 0 rows |
| Rejected candidates without a non-empty decision reason | 0 |
| Total jobs | 1 |

## Idempotency replay

Re-uploaded the same three files through the same UI route.

- Returned the same Import Run ID: `e960996b-9b21-464d-aa84-a9f6aa37bc27`.
- Counts remained unchanged: 1 import run, 300 raw rows, 285 reasoned decisions, 1 job, and no duplicate job idempotency keys.
- Result: PASS. Replaying an active identical submission does not create duplicate private source rows, candidates, or worker jobs.

## Full workspace verification

| Command | Result |
| --- | --- |
| `pnpm test` | PASS — 7 workspace tasks succeeded. Unit tests passed: shared 11, db 7, jungle-scout 5, research-engine 15, queue 1, worker 6, web 4. Queue integration 3 and worker import integration 2 were skipped by Turbo strict-env; the release-gate UI upload and SQL invariants above exercised the actual local Supabase path. |
| `pnpm typecheck` | PASS — 7 workspace tasks succeeded. |
| `pnpm lint` | PASS — 7 workspace tasks succeeded. |
| `pnpm build` | PASS — 7 workspace tasks succeeded; Next.js production build completed. |

## UI evidence references

- First upload/queued response: `C:\Users\hyj53\AppData\Local\Temp\omp-sshots-156846b37e6df823.webp`
- Repeat upload/queued response: `C:\Users\hyj53\AppData\Local\Temp\omp-sshots-156846ff34edf824.webp`
- Verified route: `http://localhost:3102/ko/imports/new`

No service-role key, database URL, or other credential is recorded here.
