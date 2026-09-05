# Task 2 — authenticated commercial evidence persistence

Status: DONE.

## Delivered contract

- `ResearchBusinessSettingsSchema` is the single input authority for four trusted values: `launchBudgetUsd`, `minimumPreAdMarginPct`, `minimumPostAdMarginPct`, and `minimumRoiPct`.
- `GET /api/research-settings` returns `{ settings: ResearchBusinessSettings }`. `POST /api/research-settings` requires the existing administrator session and CSRF protection, accepts only the strict four-field schema, and returns `{ settings: ResearchBusinessSettings }`.
- `GET /api/candidates/[id]/business` returns `CandidateBusinessResult`, and authorized `POST` appends one `research_business_v1` record and returns the same `CandidateBusinessResult` with status 201. `CandidateBusinessResult` is exported by `apps/web/lib/server/candidate-business.ts` as `{ evidence: ResearchBusinessEvidence | null, assessment: ResearchBusinessAssessment }`.
- `getCandidateBusiness`, `appendCandidateBusiness`, `CandidateBusinessError`, `createResearchSettingsRepository`, `ResearchSettingsRepository`, and `ResearchSettingsRepositoryError` are exported for downstream web and worker callers.
- `readBoundedJson` and `MAX_BOUNDED_JSON_BYTES` provide the shared 64 KiB byte-enforced parser used by both mutation routes.

## Persistence and fail-closed behavior

- Local additive migration `20260905060412_add_research_business_settings.sql` adds the four `app_settings` numeric columns with defaults `3000/35/35/150`, explicit finite/range constraints including `NaN`, `Infinity`, and `-Infinity`, and a singleton-only `insert ... on conflict do nothing` seed.
- The repository reads and updates only those four columns. Its update never upserts or changes quota, locale, provider, or other settings; the existing `app_settings` timestamp trigger owns `updated_at`.
- A missing or invalid settings row throws at the repository boundary. Candidate reads/saves convert this to a generic unavailable result before any evidence insertion; settings reads/writes return 503.
- Evidence is append-only in `candidate_evidence`; neither service method updates the candidate row. The newest versioned record is selected by descending `created_at`, then `id`; a malformed newest record is treated as no valid business evidence instead of falling back to older data.
- No GET path writes defaults or evidence. Candidate payloads are parsed once at the route boundary with the strict shared schema, so candidate-level profitability overrides are rejected.

## TDD and verification

RED first:

```text
pnpm --filter @ara/web exec vitest run "lib/server/candidate-business.test.ts" "app/api/candidates/[id]/business/route.test.ts" "app/api/research-settings/route.test.ts"
```

Before implementation, all three suites failed because the new service and routes did not exist. After implementation, the same focused suite passed: 3 files, 17 tests.

Final checks:

```text
pnpm --filter @ara/web exec vitest run "lib/server/candidate-business.test.ts" "app/api/candidates/[id]/business/route.test.ts" "app/api/research-settings/route.test.ts"
# 3 files, 17 tests passed

pnpm --filter @ara/db typecheck
pnpm --filter @ara/web typecheck
pnpm --filter @ara/db lint
pnpm --filter @ara/web lint
git diff --check
# all passed
```

Run-owned persistence proof:

```text
$env:SUPABASE_SERVICE_ROLE_KEY = 'local-test-key'
pnpm exec node ../../test-harness/run-isolated-tests.mjs --rest
# packages/db: 17 files, 228 tests passed
```

`local-test-key` was only the harness's non-secret entry gate. With `--rest`, the existing harness created run-named `ara_it_*` databases and ephemeral PostgREST service tokens, then cleaned them up. It did not read or copy a root `.env`, write the default/shared DB, call a provider, or make a paid request. The narrow fixtures exercise an actual candidate row, real `candidate_evidence` inserts and rereads, newest-malformed fail-closed behavior, unchanged candidate state, missing-settings no-insert, singleton defaults, unrelated-settings preservation, and SQL rejection of non-finite/out-of-range values.

The first isolated run exposed only a test expectation mismatch: PostgreSQL's direct `numeric` query returned strings. The test now selects the four assertion fields as `double precision`; the second isolated run passed fully.

## Files

- `supabase/migrations/20260905060412_add_research_business_settings.sql`
- `packages/db/src/types.ts`
- `packages/db/src/research-settings-repository.ts`
- `packages/db/src/index.ts`
- `packages/db/src/research-settings-repository.integration.test.ts`
- `packages/db/src/candidate-business.integration.test.ts`
- `apps/web/lib/server/bounded-json.ts`
- `apps/web/lib/server/candidate-business.ts`
- `apps/web/lib/server/candidate-business.test.ts`
- `apps/web/app/api/candidates/[id]/business/route.ts`
- `apps/web/app/api/candidates/[id]/business/route.test.ts`
- `apps/web/app/api/research-settings/route.ts`
- `apps/web/app/api/research-settings/route.test.ts`

## Scope and handoff

No UI, worker, production deployment, remote migration, default/shared DB write, provider/API call, or browser QA infrastructure was changed. UI/browser QA must use the separately owned server/DB fixture prepared by the parent and consume the response contracts above; it must not reuse a default Playwright DB.
