# Automation, Dashboard, Telegram, and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the validated research engine into an always-on personal product: scheduled 3:00 AM research, manual Research Now, bilingual dashboard, Telegram summaries, production Oracle worker, Vercel web app, and crash-safe resume.

**Architecture:** Supabase remains the durable control plane. Vercel renders/read-writes configuration and enqueues work only. Oracle Cloud runs a systemd-managed worker and a small scheduler command that enqueues daily research. Telegram delivery is another worker-side adapter. All long-running steps use persisted jobs/checkpoints and are restart-safe.

**Tech Stack:** Next.js 16.3.3, Node.js 24.20.0 LTS, Supabase JS 2.112.2, TypeScript 6.0.3, Playwright 1.62.1, systemd on Ubuntu 24.04 ARM64.

**Spec:** `docs/superpowers/specs/2026-08-26-amazon-research-agent-design.md`

## Global Constraints

- Daily automatic run: 3:00 AM America/Chicago.
- Exploration allocation: 60% new niches, 30% Watch re-validation, 10% Strong tracking.
- Manual Research Now respects reserve/budget unless explicitly overridden.
- Telegram notifies only meaningful events: new Strong, Watch -> Strong, major state change, Needs Attention, daily summary, later supplier/sample gates.
- Korean is default UI/output language; English toggle is available everywhere. Telegram follows configured notification language.
- Vercel never performs long research work.
- Oracle worker target: 4 OCPU, 24 GB RAM, ARM64, Ubuntu 24.04; AI concurrency 2-3, browser concurrency 1-2; add 4-8 GB swap.
- Secrets are server-side, masked, and redacted from logs.

---

## File Map

```text
apps/web/app/[locale]/dashboard/                 overview
apps/web/app/[locale]/candidates/                list/detail
apps/web/app/[locale]/imports/                   import history
apps/web/app/[locale]/runs/                      research run history
apps/web/app/[locale]/settings/                  research/API/AI/notification settings
apps/web/app/api/research-now/route.ts           enqueue-only manual trigger
apps/worker/src/jobs/daily-research.ts           60/30/10 planner
apps/worker/src/commands/enqueue-daily.ts         scheduler entrypoint
packages/notifications/src/telegram.ts            Telegram adapter
packages/notifications/src/digest.ts              localized digest renderer
packages/research-engine/src/planner.ts           exploration allocation
supabase/migrations/202608260004_automation.sql   schedules/settings/notifications
ops/systemd/amazon-research-worker.service        worker service
ops/systemd/amazon-research-daily.service         one-shot daily enqueue
ops/systemd/amazon-research-daily.timer           3 AM timer
ops/oracle/bootstrap.sh                           host bootstrap
```

### Task 1: Add settings, research runs, and notifications schema

**Files:**
- Create: `supabase/migrations/202608260004_automation.sql`
- Create: `packages/shared/src/settings.ts`
- Create: `packages/shared/src/settings.test.ts`

**Interfaces:**
- Produces tables: `app_settings`, `research_runs`, `notifications`, `scheduled_run_locks`.
- One personal settings record stores locale, timezone, API budget/reserve, exploration percentages, freshness windows, notification language, Telegram enabled flag.

- [ ] **Step 1: Write failing settings validation test**

```ts
it('requires exploration percentages to total 100', () => {
  expect(() => ResearchSettingsSchema.parse({ newPercent: 60, watchPercent: 30, strongPercent: 20 })).toThrow();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/shared test -- settings.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement settings schema with defaults**

Defaults: locale `ko`, timezone `America/Chicago`, new/watch/strong `60/30/10`, manual API reserve enabled, notification locale follows app locale unless overridden.

- [ ] **Step 4: Apply migration and run tests**

```bash
supabase db reset
pnpm --filter @ara/shared test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260004_automation.sql packages/shared
 git commit -m "feat: add automation and notification settings"
```

### Task 2: Implement daily exploration planner

**Files:**
- Create: `packages/research-engine/src/planner.ts`
- Create: `packages/research-engine/src/planner.test.ts`

**Interfaces:**
- Produces `planDailyResearch(input): ResearchPlan` selecting new/Watch/Strong work within budget and avoiding recently fresh niches.

- [ ] **Step 1: Write failing 60/30/10 test**

```ts
it('allocates ten slots as 6 new, 3 watch, 1 strong when enough work exists', () => {
  const plan = planDailyResearch(fixtureWithTwentyOfEach(), { slots: 10, allocation: { new: 60, watch: 30, strong: 10 } });
  expect(plan.items.filter(i => i.bucket === 'new')).toHaveLength(6);
  expect(plan.items.filter(i => i.bucket === 'watch')).toHaveLength(3);
  expect(plan.items.filter(i => i.bucket === 'strong')).toHaveLength(1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- planner.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement allocation with spillover**

If one bucket lacks eligible work, reassign unused slots to `new`, then `watch`, then `strong`, while respecting endpoint freshness/cache. Rank by information value, not only score: stale high-potential candidates rank above fresh candidates.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine/src/planner.ts packages/research-engine/src/planner.test.ts
 git commit -m "feat: plan daily research allocation"
```

### Task 3: Implement daily research orchestration job

**Files:**
- Create: `apps/worker/src/jobs/daily-research.ts`
- Create: `apps/worker/src/jobs/daily-research.integration.test.ts`
- Create: `apps/worker/src/commands/enqueue-daily.ts`
- Modify: `apps/worker/src/handlers.ts`

**Interfaces:**
- Daily job creates one `research_run`, selects plan, enqueues normalization/validation/revalidation jobs with deterministic idempotency keys.

- [ ] **Step 1: Write failing duplicate-schedule test**

```ts
it('creates only one daily run for the same America/Chicago calendar date', async () => {
  await enqueueDailyFor('2026-08-27');
  await enqueueDailyFor('2026-08-27');
  expect(await researchRunCountFor('2026-08-27')).toBe(1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/worker test -- daily-research.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement calendar-date lock and checkpointed fan-out**

Use `America/Chicago` to derive run date. Idempotency key format: `daily-research:<yyyy-mm-dd>`. Persist selected candidate IDs before child jobs are enqueued so a crash can resume fan-out exactly once.

- [ ] **Step 4: Run integration tests**

```bash
pnpm --filter @ara/worker test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/daily-research.ts apps/worker/src/commands/enqueue-daily.ts apps/worker/src/handlers.ts
 git commit -m "feat: orchestrate scheduled daily research"
```

### Task 4: Implement Research Now enqueue-only endpoint

**Files:**
- Create: `apps/web/app/api/research-now/route.ts`
- Create: `apps/web/lib/server/research-now.ts`
- Create: `apps/web/app/research-now.e2e.spec.ts`

**Interfaces:**
- POST body: `{ mode: 'normal' | 'override-reserve' }`.
- Default `normal` respects API reserve; `override-reserve` requires explicit second confirmation in UI.

- [ ] **Step 1: Write failing E2E test**

```ts
test('Research Now enqueues work and returns immediately', async ({ page }) => {
  await page.goto('/ko/dashboard');
  await page.getByRole('button', { name: '지금 리서치' }).click();
  await expect(page.getByText('대기열에 추가됨')).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/web test:e2e -- research-now.e2e.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement enqueue route**

The route may create a `research_run` and queue job but must not call Jungle Scout or AI directly. Return HTTP 202 with run ID.

- [ ] **Step 4: Run E2E tests**

```bash
pnpm --filter @ara/web test:e2e
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/research-now apps/web/lib/server/research-now.ts apps/web/app/research-now.e2e.spec.ts
 git commit -m "feat: add enqueue only research now action"
```

### Task 5: Build the core bilingual dashboard pages

**Files:**
- Create: `apps/web/app/[locale]/dashboard/page.tsx`
- Create: `apps/web/app/[locale]/candidates/page.tsx`
- Create: `apps/web/app/[locale]/candidates/[id]/page.tsx`
- Create: `apps/web/app/[locale]/runs/page.tsx`
- Create: `apps/web/app/[locale]/settings/page.tsx`
- Create: `apps/web/components/candidate-score-card.tsx`
- Create: `apps/web/components/research-activity.tsx`
- Create: `apps/web/components/api-usage-meter.tsx`
- Test: `apps/web/app/dashboard.e2e.spec.ts`

**Interfaces:**
- Dashboard exposes queued/running/waiting/completed counts, top candidates, API budget, AI availability, recent activity.
- Candidate detail exposes score components, evidence, market snapshot, data-quality warnings, decision history, micro-niches, price segments.

- [ ] **Step 1: Write failing bilingual E2E assertions**

```ts
test('candidate detail switches from Korean to English without losing candidate', async ({ page }) => {
  await page.goto('/ko/candidates/test-candidate');
  await expect(page.getByText('경쟁도')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/candidates\/test-candidate/);
  await expect(page.getByText('Competition')).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/web test:e2e -- dashboard.e2e.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement pages using server-side reads and shared dictionaries**

Never translate raw Amazon titles/keywords automatically in-place. Show source title as primary; AI localized summaries may appear in separate fields.

- [ ] **Step 4: Run E2E/typecheck**

```bash
pnpm --filter @ara/web test:e2e
pnpm --filter @ara/web typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app apps/web/components
 git commit -m "feat: add bilingual research dashboard and candidate views"
```

### Task 6: Implement Telegram adapter and localized digest renderer

**Files:**
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/src/telegram.ts`
- Create: `packages/notifications/src/digest.ts`
- Create: `packages/notifications/src/digest.test.ts`
- Create: `apps/worker/src/jobs/send-digest.ts`

**Interfaces:**
- `sendTelegramMessage(chatId, text)`.
- `renderDailyDigest(data, locale): string`.
- Message events: `NEW_STRONG`, `WATCH_TO_STRONG`, `MAJOR_STATE_CHANGE`, `NEEDS_ATTENTION`, `DAILY_SUMMARY`.

- [ ] **Step 1: Write failing digest tests**

```ts
it('renders Korean digest by default and omits trivial events', () => {
  const text = renderDailyDigest(makeDigestFixture(), 'ko');
  expect(text).toContain('오늘의 리서치 요약');
  expect(text).not.toContain('heartbeat');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/notifications test
```
Expected: FAIL.

- [ ] **Step 3: Implement Telegram HTTP adapter**

Read bot token only on worker. Store chat ID/config server-side. Telegram errors are recorded in `notifications` with retryable/non-retryable classification; raw token never enters logs.

- [ ] **Step 4: Run tests with mock Telegram server**

```bash
pnpm --filter @ara/notifications test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications apps/worker/src/jobs/send-digest.ts
 git commit -m "feat: add localized telegram research notifications"
```

### Task 7: Add observability and audit-safe structured logging

**Files:**
- Create: `packages/shared/src/logger.ts`
- Create: `packages/shared/src/logger.test.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- JSON log fields: timestamp, level, service, jobId, researchRunId, candidateId, event, durationMs, errorCode.

- [ ] **Step 1: Write failing redaction test**

```ts
it('redacts known secret field names recursively', () => {
  const line = formatLog({ apiKey: 'abc', authorization: 'AI:secret', nested: { token: 'xyz' } });
  expect(line).not.toContain('abc');
  expect(line).not.toContain('secret');
  expect(line).not.toContain('xyz');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/shared test -- logger.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement logger/redaction and worker job timing**

Redact keys matching `/key|token|authorization|cookie|secret|password/i` before serialization.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/shared test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/logger.ts packages/shared/src/logger.test.ts apps/worker/src/main.ts
 git commit -m "feat: add structured redacted worker logging"
```

### Task 8: Create Oracle host bootstrap and systemd units

**Files:**
- Create: `ops/oracle/bootstrap.sh`
- Create: `ops/systemd/amazon-research-worker.service`
- Create: `ops/systemd/amazon-research-daily.service`
- Create: `ops/systemd/amazon-research-daily.timer`
- Create: `docs/deployment/oracle.md`

**Interfaces:**
- Worker service starts `pnpm --filter @ara/worker start` from deployed release directory.
- Daily service runs `pnpm --filter @ara/worker enqueue:daily` once.

- [ ] **Step 1: Write bootstrap script with idempotent checks**

`bootstrap.sh` must:
- verify `uname -m` is `aarch64`/`arm64`
- install Node 24 LTS through the selected supported method
- enable Corepack/pnpm
- create non-root `amazon-research` service account
- create `/opt/amazon-research/current` and `/etc/amazon-research`
- configure a 4 GB swapfile only if no swap exists
- never write actual secrets.

- [ ] **Step 2: Define systemd worker service**

Required properties:

```ini
[Service]
User=amazon-research
WorkingDirectory=/opt/amazon-research/current
EnvironmentFile=/etc/amazon-research/worker.env
ExecStart=/usr/bin/env pnpm --filter @ara/worker start
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=90
```

- [ ] **Step 3: Define daily timer at 3 AM America/Chicago**

Use the host timezone `America/Chicago` and:

```ini
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=amazon-research-daily.service
```

`Persistent=true` ensures a missed run caused by a reboot is triggered after the host returns.

- [ ] **Step 4: Validate units**

Run on Oracle staging host:

```bash
systemd-analyze verify ops/systemd/amazon-research-worker.service
systemd-analyze verify ops/systemd/amazon-research-daily.service
systemd-analyze verify ops/systemd/amazon-research-daily.timer
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add ops docs/deployment/oracle.md
 git commit -m "ops: add oracle worker and daily scheduler units"
```

### Task 9: Configure Vercel production deployment boundary

**Files:**
- Create: `vercel.json`
- Create: `docs/deployment/vercel.md`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Vercel only hosts `apps/web`; worker is never deployed as a serverless function.

- [ ] **Step 1: Document required Vercel environment variables**

Only browser-safe Supabase URL/public key may use `NEXT_PUBLIC_`. Service-role, encryption, provider, Jungle Scout, and Telegram secrets remain server-only or worker-only.

- [ ] **Step 2: Add deployment checks**

Run:

```bash
pnpm --filter @ara/web build
```
Expected: build passes with no worker package bundled into client assets.

- [ ] **Step 3: Inspect build for secret names**

Run:

```bash
grep -R "JUNGLE_SCOUT_API_KEY\|TELEGRAM_BOT_TOKEN\|APP_SECRET_ENCRYPTION_KEY" apps/web/.next/static && exit 1 || true
```
Expected: no matches.

- [ ] **Step 4: Deploy preview and run Playwright smoke suite**

Expected: `/ko/dashboard`, `/en/dashboard`, CSV import, Research Now queueing, candidate detail all pass.

- [ ] **Step 5: Commit**

```bash
git add vercel.json docs/deployment/vercel.md apps/web/next.config.ts
 git commit -m "ops: define vercel web deployment boundary"
```

### Task 10: Production crash/resume and PC-off acceptance test

**Files:**
- Create: `docs/verification/milestone-4.md`

- [ ] **Step 1: Schedule a controlled next-run test on Oracle**

Verify Oracle host timezone:

```bash
timedatectl
systemctl list-timers amazon-research-daily.timer
```
Expected: timezone `America/Chicago`, timer scheduled at local 03:00.

- [ ] **Step 2: Run worker crash test**

Start a research run, wait until a Market Probe has persisted `api_fetched`, then restart worker:

```bash
sudo systemctl restart amazon-research-worker
```
Expected: job lease expires/reclaims or resumes from checkpoint; no second real Jungle Scout call for the cached step.

- [ ] **Step 3: Verify end-to-end while user's Windows PC is off**

Expected chain:
`daily timer -> research_run -> worker jobs -> Supabase results -> dashboard visible -> Telegram digest`.

- [ ] **Step 4: Verify notification noise policy**

No Telegram message for individual internal heartbeats/cache hits. Daily summary and meaningful candidate state changes only.

- [ ] **Step 5: Record evidence and commit**

```bash
git add docs/verification/milestone-4.md
 git commit -m "test: verify production automation and crash recovery"
```
