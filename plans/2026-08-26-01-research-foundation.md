# Research Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of the Amazon Research Agent: Opportunity Finder CSV upload -> durable import -> zero-API filtering -> preliminary scoring -> bilingual dashboard.

**Architecture:** A pnpm monorepo hosts a Next.js web app and an Oracle-ready Node worker. Supabase PostgreSQL stores imports, raw keywords, deterministic decisions, candidates, jobs, and audit history. Vercel only uploads/enqueues; the worker claims durable jobs through PostgreSQL RPC functions using `FOR UPDATE SKIP LOCKED`.

**Tech Stack:** Node.js 24.20.0 LTS, pnpm 11.24.0, TypeScript 6.0.3, Next.js 16.3.3, Supabase JS 2.112.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-26-amazon-research-agent-design.md`

## Global Constraints

- Personal-use MVP only.
- Target category: Kitchen & Dining.
- Target retail price: $15-$80.
- Zero-API filtering happens before Jungle Scout API work.
- High / Very High seasonality is rejected unless explicitly allowed.
- Clear electric, battery, irrelevant subdomain, obvious brand/IP, broad shopping-intent, fragile/heavy-risk phrases are rejected when inferable.
- Preserve every raw CSV row unchanged and record rejection reasons.
- Korean is the default UI language; English is selectable. Source CSV strings remain unchanged.
- Long jobs never run inside Vercel request lifetimes.
- Secrets never appear in browser-visible plaintext or logs.

---

## File Map

```text
package.json                         workspace scripts and version locks
pnpm-workspace.yaml                 workspace package discovery
turbo.json                          build/test orchestration
tsconfig.base.json                  shared TypeScript settings
.env.example                        non-secret environment names
apps/web/                           Next.js dashboard and upload endpoints
apps/worker/                        durable job polling + import processor
packages/shared/                    Zod schemas, enums, localized copy keys
packages/db/                        Supabase client + generated DB types
packages/queue/                     durable job enqueue/claim/checkpoint API
packages/jungle-scout/              Opportunity Finder CSV parser only in this milestone
packages/research-engine/           deterministic filters + preliminary score
supabase/migrations/                schema + queue RPC functions
tests/fixtures/opportunity-finder/  sanitized CSV samples
```

### Task 1: Bootstrap the monorepo and test toolchain

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/shared/package.json`
- Create: `packages/db/package.json`
- Create: `packages/queue/package.json`
- Create: `packages/jungle-scout/package.json`
- Create: `packages/research-engine/package.json`
- Test: `packages/shared/src/version.test.ts`

**Interfaces:**
- Produces: workspace packages importable as `@ara/shared`, `@ara/db`, `@ara/queue`, `@ara/jungle-scout`, `@ara/research-engine`.

- [ ] **Step 1: Write the failing workspace smoke test**

```ts
// packages/shared/src/version.test.ts
import { describe, expect, it } from 'vitest';
import { APP_NAME } from './version';

describe('shared package', () => {
  it('exports the application name', () => {
    expect(APP_NAME).toBe('Amazon Research Agent');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
pnpm --filter @ara/shared test -- version.test.ts
```
Expected: FAIL because the workspace and `version.ts` do not exist yet.

- [ ] **Step 3: Create the workspace configuration and minimal export**

```json
// package.json
{
  "name": "amazon-research-agent",
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": "24.20.0" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "2.10.11",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```ts
// packages/shared/src/version.ts
export const APP_NAME = 'Amazon Research Agent' as const;
```

Each package `package.json` must use ESM (`"type":"module"`), export `src/index.ts`, and expose `test`/`typecheck` scripts. `apps/web` pins `next@16.3.3`; shared server/client DB code pins `@supabase/supabase-js@2.112.2`; schema validation pins `zod@4.4.3`.

- [ ] **Step 4: Install and run workspace verification**

Run:
```bash
pnpm install
pnpm test
pnpm typecheck
```
Expected: all workspace smoke tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .gitignore .env.example apps packages
 git commit -m "chore: bootstrap research agent monorepo"
```

### Task 2: Define shared domain schemas and bilingual copy contract

**Files:**
- Create: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/i18n.ts`
- Create: `packages/shared/src/domain.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `Locale = 'ko' | 'en'`, `CandidateState`, `ImportRunStatus`, `RuleCode`, `OpportunityCsvRow`, `PreliminaryCandidate`.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { LocaleSchema, OpportunityCsvRowSchema } from './domain';

describe('domain schemas', () => {
  it('defaults product UI locale choices to ko/en only', () => {
    expect(LocaleSchema.parse('ko')).toBe('ko');
    expect(() => LocaleSchema.parse('ja')).toThrow();
  });

  it('accepts a parsed Opportunity Finder row', () => {
    const row = OpportunityCsvRowSchema.parse({
      keyword: 'pancake dispenser bottle',
      nicheScore: 9,
      monthlyUnits: 1845,
      averagePrice: 17.73,
      searchVolume: 1601,
      trend30: 6,
      trend90: 26,
      competition: 'Very Low',
      seasonality: 'Very Low',
      lastUpdated: '2026-08-26'
    });
    expect(row.keyword).toBe('pancake dispenser bottle');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/shared test -- domain.test.ts
```
Expected: FAIL because schemas are missing.

- [ ] **Step 3: Implement exact schemas and localized label keys**

```ts
export const LocaleSchema = z.enum(['ko', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const CandidateStateSchema = z.enum([
  'Discovered',
  'Rule Filter',
  'AI Screening',
  'Ready for API Validation',
  'Waiting for API Budget',
  'API Validation Running',
  'Deep Research',
  'Strong',
  'Watch',
  'Reject',
  'Needs Review',
  'Waiting for AI Capacity',
  'Needs Attention'
]);

export const RuleCodeSchema = z.enum([
  'PRICE_OUT_OF_RANGE',
  'SEASONALITY_HIGH',
  'ELECTRIC_OR_BATTERY',
  'IRRELEVANT_SUBDOMAIN',
  'BRAND_OR_IP',
  'BROAD_SHOPPING_INTENT',
  'FRAGILE_OR_HEAVY_RISK'
]);
```

Create `COPY` dictionaries with the same keys in `ko` and `en`; do not translate literal industry terms such as ASIN, FBA, MOQ, Jungle Scout.

- [ ] **Step 4: Run tests**

Run:
```bash
pnpm --filter @ara/shared test
pnpm --filter @ara/shared typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
 git commit -m "feat: define research domain and bilingual copy contract"
```

### Task 3: Create the Supabase core schema and durable queue RPCs

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608260001_core_research.sql`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/types.ts`
- Create: `packages/db/src/core-schema.integration.test.ts`

**Interfaces:**
- Produces tables: `import_runs`, `raw_opportunity_keywords`, `niche_clusters`, `niche_cluster_keywords`, `candidates`, `decision_history`, `score_history`, `audit_events`, `jobs`.
- Produces RPCs: `claim_jobs(worker_id text, job_limit int, lease_seconds int)`, `heartbeat_job(job_id uuid, worker_id text, lease_seconds int)`, `complete_job(job_id uuid, worker_id text, checkpoint jsonb)`, `fail_job(job_id uuid, worker_id text, error_text text, retry_at timestamptz, checkpoint jsonb)`.

- [ ] **Step 1: Write the failing queue/schema integration test**

```ts
it('claims a queued job exactly once', async () => {
  const id = await insertTestJob({ type: 'IMPORT_OPPORTUNITY_CSV', idempotencyKey: 'fixture-1' });
  const first = await rpcClaimJobs('worker-a', 1, 60);
  const second = await rpcClaimJobs('worker-b', 1, 60);
  expect(first.map(j => j.id)).toEqual([id]);
  expect(second).toEqual([]);
});
```

- [ ] **Step 2: Start local Supabase and confirm the test fails**

Run:
```bash
supabase start
pnpm --filter @ara/db test -- core-schema.integration.test.ts
```
Expected: FAIL because tables/RPCs are absent.

- [ ] **Step 3: Implement schema and queue functions**

Core `jobs` columns must be:

```sql
id uuid primary key default gen_random_uuid(),
type text not null,
payload jsonb not null default '{}'::jsonb,
status text not null check (status in ('queued','running','completed','failed')),
priority integer not null default 100,
available_at timestamptz not null default now(),
leased_until timestamptz,
leased_by text,
attempts integer not null default 0,
max_attempts integer not null default 5,
idempotency_key text not null unique,
checkpoint jsonb not null default '{}'::jsonb,
last_error text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

`claim_jobs` must lock eligible rows with `FOR UPDATE SKIP LOCKED`, increment attempts, set `status='running'`, and assign a lease atomically.

- [ ] **Step 4: Apply migration and run integration tests**

Run:
```bash
supabase db reset
pnpm --filter @ara/db test
```
Expected: PASS; two workers cannot claim the same job.

- [ ] **Step 5: Commit**

```bash
git add supabase packages/db
 git commit -m "feat: add research schema and durable postgres queue"
```

### Task 4: Implement the queue package and worker polling loop

**Files:**
- Create: `packages/queue/src/index.ts`
- Create: `packages/queue/src/queue.ts`
- Create: `packages/queue/src/queue.test.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/handlers.ts`

**Interfaces:**
- Consumes RPCs from Task 3.
- Produces:
  - `enqueueJob(input: { type: JobType; payload: unknown; idempotencyKey: string; priority?: number; availableAt?: string }): Promise<string>`
  - `claimJobs(workerId: string, limit: number, leaseSeconds: number): Promise<Job[]>`
  - `completeJob(...)`, `failJob(...)`, `heartbeatJob(...)`.

- [ ] **Step 1: Write a failing idempotent enqueue test**

```ts
it('returns the existing job when idempotency_key is reused', async () => {
  const a = await enqueueJob({ type: 'IMPORT_OPPORTUNITY_CSV', payload: {}, idempotencyKey: 'same' });
  const b = await enqueueJob({ type: 'IMPORT_OPPORTUNITY_CSV', payload: {}, idempotencyKey: 'same' });
  expect(b).toBe(a);
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/queue test
```
Expected: FAIL because queue package is missing.

- [ ] **Step 3: Implement queue methods and worker loop**

Worker loop behavior:

```ts
while (!abortSignal.aborted) {
  const jobs = await claimJobs(workerId, 4, 120);
  if (jobs.length === 0) {
    await sleep(2000);
    continue;
  }
  await Promise.all(jobs.map(job => runJob(job, abortSignal)));
}
```

`runJob` must heartbeat every 30 seconds during long work and call `failJob` with exponential retry (`1m`, `5m`, `30m`, `2h`, then terminal failure at max attempts).

- [ ] **Step 4: Run tests and a two-worker smoke test**

Run:
```bash
pnpm --filter @ara/queue test
pnpm --filter @ara/worker typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/queue apps/worker
 git commit -m "feat: add durable worker polling and job leases"
```

### Task 5: Parse Jungle Scout Opportunity Finder CSV exports

**Files:**
- Create: `packages/jungle-scout/src/opportunity-csv.ts`
- Create: `packages/jungle-scout/src/opportunity-csv.test.ts`
- Create: `tests/fixtures/opportunity-finder/page-1.csv`
- Create: `tests/fixtures/opportunity-finder/page-2.csv`

**Interfaces:**
- Produces: `parseOpportunityFinderCsv(input: string, sourceFileName: string): ParsedOpportunityFile`.
- Must understand `$23.98`, `5,038`, `8%`, `-37%`, and `< 450` search volume.
- Search volume `< 450` must become `{ value: 450, isUpperBound: true }`, not a fabricated exact value.

- [ ] **Step 1: Write failing parser tests**

```ts
it('parses formatted numeric fields without losing upper-bound meaning', () => {
  const parsed = parseOpportunityFinderCsv(FIXTURE, 'page-1.csv');
  expect(parsed.rows[0].averagePrice).toBe(23.98);
  expect(parsed.rows[0].monthlyUnits).toBe(5038);
  expect(parsed.rows[0].searchVolume).toEqual({ value: 450, isUpperBound: true });
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/jungle-scout test -- opportunity-csv.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement parser with strict header validation**

Reject files missing any of these headers: `Keyword`, `Niche Score`, `Units Sold - Monthly Avg`, `Price - Monthly Avg`, `Search Volume - 30 Day Exact`, `Search Trend - 30 Day`, `Search Trend - 90 Day`, `Competition`, `Seasonality`, `Last Updated`.

- [ ] **Step 4: Run parser tests**

Run:
```bash
pnpm --filter @ara/jungle-scout test
```
Expected: PASS for two-page fixtures and malformed-file rejection.

- [ ] **Step 5: Commit**

```bash
git add packages/jungle-scout tests/fixtures/opportunity-finder
 git commit -m "feat: parse opportunity finder csv exports"
```

### Task 6: Implement deterministic zero-API rules

**Files:**
- Create: `packages/research-engine/src/rules/opportunity-rules.ts`
- Create: `packages/research-engine/src/rules/lexicons.ts`
- Create: `packages/research-engine/src/rules/opportunity-rules.test.ts`

**Interfaces:**
- Produces: `evaluateOpportunityRules(row: OpportunityCsvRow, config: ResearchRuleConfig): RuleEvaluation`.
- `RuleEvaluation = { passed: boolean; reasons: { code: RuleCode; detail: string }[]; flags: string[] }`.

- [ ] **Step 1: Write failing tests for known Phase 0 examples**

```ts
it.each([
  ['electric can opener', 'ELECTRIC_OR_BATTERY'],
  ['pikachu lunch box', 'BRAND_OR_IP'],
  ['40th birthday decorations for women', 'SEASONALITY_HIGH']
])('rejects %s with %s', (keyword, expectedCode) => {
  const result = evaluateOpportunityRules(makeRow({ keyword }), DEFAULT_RULES);
  expect(result.reasons.map(r => r.code)).toContain(expectedCode);
});

it('does not reject pancake dispenser bottle', () => {
  expect(evaluateOpportunityRules(makeRow({ keyword: 'pancake dispenser bottle' }), DEFAULT_RULES).passed).toBe(true);
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/research-engine test -- opportunity-rules.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement rules as explicit, auditable lexicons**

Use separate arrays for electric/battery terms, seasonal event terms, known franchise/IP terms found during Phase 0, broad intent phrases, and obvious non-Kitchen domains. Every match stores the matched token in `detail`; never return only a boolean.

- [ ] **Step 4: Run tests**

Run:
```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine
 git commit -m "feat: add auditable zero api opportunity filters"
```

### Task 7: Implement deterministic preliminary scoring

**Files:**
- Create: `packages/research-engine/src/scoring/preliminary-score.ts`
- Create: `packages/research-engine/src/scoring/preliminary-score.test.ts`

**Interfaces:**
- Produces: `scorePreliminaryOpportunity(row, ruleEvaluation): PreliminaryScore`.
- Score is 0-100 and is explicitly labeled `preliminary`, not the final 40/30/20/10 market score.

- [ ] **Step 1: Write failing score tests**

```ts
it('ranks a low-competition evergreen $15-$80 niche above a seasonal niche', () => {
  const good = scorePreliminaryOpportunity(makeRow({ competition: 'Very Low', seasonality: 'Very Low', averagePrice: 28, monthlyUnits: 3000 }), passRules());
  const seasonal = scorePreliminaryOpportunity(makeRow({ competition: 'Very Low', seasonality: 'Very High', averagePrice: 28, monthlyUnits: 3000 }), rejectRules('SEASONALITY_HIGH'));
  expect(good.score).toBeGreaterThan(seasonal.score);
  expect(seasonal.eligibleForAiNormalization).toBe(false);
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/research-engine test -- preliminary-score.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement transparent preliminary components**

Use normalized components persisted individually:
- `jsNicheScore` 25%
- `competition` 25%
- `demand` 20% from monthly units/search volume
- `trend` 10%
- `priceFit` 10%
- `seasonality` 10%

Any hard-rule rejection sets `eligibleForAiNormalization=false` regardless of numeric score.

- [ ] **Step 4: Run tests**

Run:
```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS and score breakdown sums exactly to final preliminary score.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine
 git commit -m "feat: add preliminary opportunity scoring"
```

### Task 8: Build the CSV import job end-to-end

**Files:**
- Create: `apps/worker/src/jobs/import-opportunity-csv.ts`
- Create: `apps/worker/src/jobs/import-opportunity-csv.integration.test.ts`
- Modify: `apps/worker/src/handlers.ts`

**Interfaces:**
- Consumes parser, rules, scoring, DB.
- Produces persisted `import_runs`, raw rows, candidates, decision history, audit events.

- [ ] **Step 1: Write failing end-to-end import test**

```ts
it('merges two files, deduplicates exact keywords, and persists rejection reasons', async () => {
  const result = await runImportJob(twoFixtureFiles());
  expect(result.fileCount).toBe(2);
  expect(result.duplicateKeywordCount).toBeGreaterThan(0);
  expect(result.rejectedCount).toBeGreaterThan(0);
  const rejected = await getRejectedCandidateByKeyword('electric can opener');
  expect(rejected.decisionReasons).toContain('ELECTRIC_OR_BATTERY');
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/worker test -- import-opportunity-csv.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement import transaction/checkpoints**

Checkpoint shape:

```ts
{
  phase: 'parsed' | 'persisted_raw' | 'filtered' | 'scored' | 'completed',
  importRunId: string,
  processedKeywordCount: number
}
```

Use deterministic `source_hash` + normalized exact keyword as uniqueness keys so retrying after a crash does not duplicate rows.

- [ ] **Step 4: Run integration tests including simulated crash/retry**

Run:
```bash
pnpm --filter @ara/worker test
```
Expected: PASS; retry after a forced exception resumes without duplicate candidates.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
 git commit -m "feat: process opportunity csv imports in worker"
```

### Task 9: Build bilingual web upload and import dashboard

**Files:**
- Create: `apps/web/app/[locale]/layout.tsx`
- Create: `apps/web/app/[locale]/page.tsx`
- Create: `apps/web/app/[locale]/imports/page.tsx`
- Create: `apps/web/app/[locale]/imports/new/page.tsx`
- Create: `apps/web/app/api/imports/route.ts`
- Create: `apps/web/lib/i18n.ts`
- Create: `apps/web/lib/server/enqueue-import.ts`
- Create: `apps/web/components/language-switcher.tsx`
- Test: `apps/web/app/imports.e2e.spec.ts`

**Interfaces:**
- API consumes multipart CSV files; stores temporary import objects in Supabase Storage private bucket or uploads bytes to a private server-side path, then enqueues `IMPORT_OPPORTUNITY_CSV` with file references.
- UI defaults to `/ko`; toggle navigates to `/en` preserving the route.

- [ ] **Step 1: Write failing Playwright test**

```ts
test('uploads multiple csv files and shows queued import in Korean', async ({ page }) => {
  await page.goto('/ko/imports/new');
  await page.setInputFiles('input[type=file]', ['tests/fixtures/opportunity-finder/page-1.csv', 'tests/fixtures/opportunity-finder/page-2.csv']);
  await page.getByRole('button', { name: '가져오기 시작' }).click();
  await expect(page.getByText('처리 대기')).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

Run:
```bash
pnpm --filter @ara/web test:e2e -- imports.e2e.spec.ts
```
Expected: FAIL because pages/routes are missing.

- [ ] **Step 3: Implement upload, enqueue, import summary UI, and locale toggle**

The browser must never receive the Supabase service-role key. Route handler validates MIME/extension, limits each CSV to 10 MB, allows max 20 files per Import Run, and returns only the new `import_run_id`.

- [ ] **Step 4: Run web tests**

Run:
```bash
pnpm --filter @ara/web test:e2e
pnpm --filter @ara/web typecheck
```
Expected: PASS in both `/ko` and `/en`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
 git commit -m "feat: add bilingual opportunity csv import dashboard"
```

### Task 10: Verify Milestone 1 acceptance criteria

**Files:**
- Create: `docs/verification/milestone-1.md`

**Interfaces:** none; this is the release gate.

- [ ] **Step 1: Reset local data and import the sanitized 300-row fixture set**

Run:
```bash
supabase db reset
pnpm --filter @ara/worker dev
pnpm --filter @ara/web dev
```
Upload three 100-row fixture files through `/ko/imports/new`.

- [ ] **Step 2: Verify database invariants**

Run SQL:
```sql
select count(*) from import_runs;
select count(*) from raw_opportunity_keywords;
select count(*) from decision_history where reasons is not null;
select idempotency_key, count(*) from jobs group by idempotency_key having count(*) > 1;
```
Expected: one Import Run; no duplicate jobs; every rejected candidate has decision reasons.

- [ ] **Step 3: Re-upload the same files and verify idempotency behavior**

Expected: a new Import Run may be recorded for audit, but raw-source hashes and downstream candidate creation must not duplicate identical source rows within the same import semantics; no duplicate worker job for the same submitted import action.

- [ ] **Step 4: Record verification evidence**

`docs/verification/milestone-1.md` must include commands run, pass/fail, row counts, and screenshots/URLs only as references; do not include secrets.

- [ ] **Step 5: Commit the verification record**

```bash
git add docs/verification/milestone-1.md
 git commit -m "test: verify research foundation milestone"
```
