# Budget-first workflow validation — 2026-09-05

## Scope and identity

- Local production-build fixture only: `http://127.0.0.1:1312`, run `ara_it_67804_65f0724a`, isolated DB `ara_it_67804_65f0724a_80d4c2946243`.
- Rendered product source: `246bbebc8cba3f678f1ccd8a8766a3d2a99ea84a`. No deploy, production write, provider call, supplier message, migration, or fixture shutdown was performed by this task.
- The correction commit is `246bbeb`: persisted disposition, five landed-cost coverage fields, and explicit quote-source editing preserve unchanged money evidence.

## Results

- `pnpm --filter @ara/web exec vitest run components/candidate-business-fields.test.ts`: 2 passed. It covers quote wait, coverage persistence, explicit estimate→quote source update, and preserved sale/Amazon money evidence.
- `pnpm --filter @ara/web typecheck` and `pnpm --filter @ara/web lint`: passed.
- Production browser `business-workflow` final-capture run: 4 passed, 2 intentional historical-capture skips. It saved/reloaded quote wait and coverage, asserted GET-only criteria refresh with zero business POST, and captured 24 final PNGs without CSP bypass.
- Production browser `ai-settings`: 7 passed after scoping localized subscription statuses to their product card; existing secret/write-only, malformed-response, test, and disable checks remain present.
- The immediately preceding all-project browser batch passed 16 tests with 3 intentional capture skips; its one stale duplicate-text assertion was fixed above and targeted re-run passed. It includes auth redirects, imports, dashboard locale, and Research Now checks.
- `SUPABASE_SERVICE_ROLE_KEY=local-public-fixture-bootstrap pnpm test` in `apps/worker`: 34 files / 252 tests passed / 5 skipped in run-owned REST DBs. The extended milestone acceptance uses the real `page-1.csv` parser through `runImportJob`, appends business evidence, calls a loopback Jungle Scout HTTP wire exactly once, persists its relevant-ASIN result and `api_usage`, appends `awaiting_quote`, then proves zero repeat wire/API usage.
- That full worker suite also exercises the existing stale/malformed admission, budget/atomicity/cache, and provider/model-attribution regressions. The only two failures are the documented Windows CRLF subscription policy digests; no digest source or expectation was weakened. Parent’s LF-pinned Linux worker unit evidence is 23 files / 181 tests passed.

## Evidence

- [`final-acceptance/manifest.json`](evidence/2026-09-05-budget-first-workflow/final-acceptance/manifest.json) lists all 24 PNG SHA-256 values, PNG signatures, exact dimensions, 375/768/1280 viewport widths, source/build identity, passed horizontal-overflow assertions, and DB-versus-route-mock provenance.
- Actual isolated DB captures: saved evidence, quote wait, overbudget, draft-preserving GET refresh, saved settings, and imports handoff. The missing-evidence and settings-save-failure images are explicitly browser route mocks, not database outcomes.

## Boundary and limitations

- CSP bypass is **false** for the final browser capture. Browser route mocks are not API/security evidence; unauthenticated GET/POST boundary checks are separately recorded in QA preparation.
- The full Linux integration harness was not run because Docker Desktop WSL integration is disabled; no setting was changed. Windows default Git archive with `core.autocrlf=true` is noncanonical for policy digest artifacts; release export must use `git -c core.autocrlf=false archive <full-reviewed-sha>`.
- This report does not claim a paid provider request, real CSV export download, deployment, or production database verification.

## Self-review

- Touched test assertions are scoped to the exact subscription product card, avoiding localized duplicate role/status text without relaxing security assertions.
- New visual evidence is in `final-acceptance`; earlier before/after/fix-round evidence was not overwritten. The remaining Task 5 changes are tests, release documentation, report, and static evidence only.
