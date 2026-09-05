# Budget-first web/API research implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist evidence-backed launch feasibility, show the next commercial action, and allow Jungle Scout calls only when they can advance that action.

**Architecture:** Preserve candidate execution states and the existing durable queue. Add a versioned business evidence document and a shared pure assessment used by the web and worker. Existing official Jungle Scout adapters remain behind their current atomic request authorization; browser research stays in the logged-in in-app browser.

**Tech Stack:** Existing TypeScript, Zod, Next.js, Supabase, pnpm, Vitest, Playwright. No new dependencies.

**Spec:** `RESEARCH_WORKFLOW.md` (approved by user).

## Latest execution authorization — 2026-09-05

The user explicitly asked to finish the work, deploy, and repeat whole-code review after deployment while they sleep. After local acceptance and independent pre-release review, the controller may integrate/commit/push the scoped release, apply the approved additive settings migration, and deploy the validated version to the existing Cloudflare web and Oracle worker. Preserve dirty user work, current data, existing security/identity configuration and the prior release. Verify the actually deployed SHA and perform the requested post-deployment whole-code review against it. Blocking findings stop release or require a verified correction/rollback. This supersedes the earlier local-only release pause below, not the prohibition on paid QA, supplier messages, OAuth expansion, unapproved schema expansion, or production activity by implementation/test agents.

## Global Constraints

- 현재 첫 출시 현금 설정은 $3,000. 사용자가 2026-09-05에 명시했듯 영구 hardcode가 아니며 관리자 설정에서 변경 가능해야 한다. 모든 후보는 현재 전역 설정으로 평가한다.
- ‘견적 요청 가치 있음’과 ‘발주 승인’을 구분한다.
- 자동 발주·결제·업체 메시지 전송, 브라우저 쿠키의 Oracle 이관, 구독 OAuth, 새 브라우저 서비스, 전체 UI 리디자인, 신규 데이터 제공업체 제외.
- 기존 candidate state/작업 status는 실행 상태로 보존한다.
- 기존 economics_verified를 새 계약에 자동 승격하지 않는다.
- 설정된 API 한도는 상한이지 소비 목표가 아니다. New jobs must not bypass current physical-request authorization.
- 사용자 dirty `apps/web/next-env.d.ts`, `프롬프트.md` 및 unrelated artifacts 보존.
- No production migrations, paid QA calls or deployment during local implementation. Release needs final review and explicit live-test boundaries.
- Use Terra xHigh for integration/review, Luna xHigh for mechanical work; never Sol subagents. Implementation agents must not spawn agents.

## Workspace / execution prerequisites

- [ ] Resolve user's worktree choice. Root main is dirty; do not reuse old plan worktrees or copy credentials.
- [ ] Install locked dependencies in the chosen isolated workspace and run narrow baseline tests before changing their behavior.
- [ ] Initialize the SDD ledger and per-task briefs. Record exact base/full task commit SHAs and scoped review artifacts.

## Shared interface contract

Create `packages/shared/src/research-business.ts` (schemas/types) and `research-business-assessment.ts` (pure calculation). Export from shared index. Do not add a web runtime dependency on research-engine.

```ts
type ResearchBusinessStage =
  | 'basic_check' | 'market_validation' | 'quote_ready'
  | 'awaiting_quote' | 'awaiting_sample' | 'purchase_review' | 'hold' | 'reject';
type ResearchBusinessAssessment = {
  readonly settings: ResearchBusinessSettings;
  readonly stage: ResearchBusinessStage;
  readonly gaps: readonly string[];
  readonly estimatedLaunchCashUsd: number | null;
  readonly estimatedUnitContributionUsd: number | null;
  readonly estimatedMarginPct: number | null;
  readonly purchaseApproved: false;
};
```

`ResearchBusinessEvidenceSchema` is a strict version-1 object, kind `research_business_v1`. Its fields cover: specification text; US marketplace; brand fit; explicit disposition (`research`, `awaiting_quote`, `awaiting_sample`, `rejected`); sourced sale price; sourced Amazon unit costs; one selected quantity/quote pairing with MOQ and landed-cost coverage; fixed launch costs, advertising cash, reserve; per-unit advertising/return assumptions; market, sample and safety/IP checks with source references; requested API purposes. Budget and profitability targets belong exclusively to trusted global settings, not this evidence. Unknown fields remain nullable, never numeric zero defaults. Each source contains URL/reference, recordedAt and basis (estimate/quote/observed). User-entered claims are not silently promoted to independently verified facts.

Schema requires finite nonnegative money, positive integer quantity/MOQ, rates in [0,100], bounded text and valid timestamps. Reject mismatched quantity/MOQ, expired quote for purchase review, and non-USD monetary computation without an explicit converted USD value/reference. Missing quote yields hold/basic investigation, not rejection. Actual purchase remains manual.

```ts
assessResearchBusiness(evidence: ResearchBusinessEvidence | null, now: Date, settings: ResearchBusinessSettings): ResearchBusinessAssessment
selectLatestResearchBusiness(rows: readonly ResearchBusinessEvidenceRow[]): ResearchBusinessEvidence | null
```

Latest malformed/incomplete record must not fall back to older qualifying evidence. `created_at` + `id` determine latest record, consistent with existing web evidence logic.

### User clarification — 2026-09-05 (supersedes fixed-budget wording/examples below)

- The purpose is Forge Kitchen's first Amazon sale, not maximizing analysis counts. Web/API discovery must lead to source-backed competition/margin decisions and Alibaba-style supplier quote handoff.
- Export `DEFAULT_RESEARCH_LAUNCH_BUDGET_USD = 3000` and a finite positive `ResearchLaunchBudgetSchema`. Evidence does not own the budget; the required assessment argument is loaded from `app_settings.launch_budget_usd` by trusted web/worker callers. Assessment returns the effective budget. Changing it re-evaluates existing evidence without rewriting it.
- Task 1 adds changed-budget regression (same $4000 cash plan blocked at $3000, eligible under $5000 only when all other gates pass; lowering blocks again). Missing/invalid settings must not silently authorize work.
- Task 2 additionally owns one additive local-only `app_settings.launch_budget_usd` migration (default $3000), DB types, the smallest shared DB budget read/write helper with web and worker callers, and an authenticated/CSRF-protected budget setting endpoint. Other app settings and API quotas must remain unchanged. No production migration.
- Task 3 additionally exposes the current launch budget on the existing settings page with save/reload proof; candidate totals compare against this current setting. Do not offer per-candidate budget overrides.
- Task 4 reads the current configured launch budget at selection AND execution. A queued request cannot retain a higher stale budget.
- Task 5 proves budget change persists, re-evaluates an existing candidate, and does not modify the candidate's source evidence or unrelated app/API settings.
- Reviewed user note: `Hermes/노트/Amazon-FBA/니치-선정-조건-TSS.md` (2026-08-21). Profitability reference is margin >=35%, ROI >=150%; ROI is not bounded to 100%. Existing note criteria must be preserved as sourced policy/market-review checks, not invented from niche score. Differences of provider metric definitions remain unknown rather than fabricated.
- Supplier flow remains discovery/link + exact-spec quote draft + user-approved contact + quote-response evidence. No autonomous message send, order, payment, cookie export or new sourcing service. Reuse verified supplier conversations; no fabricated supplier identity/contact address.

### User clarification — editable profitability settings (2026-09-05, latest authority)

The user explicitly approved configurable profitability criteria, not permanent 35%/150% floors. This section supersedes earlier per-record profitability-policy and budget-only contracts.

- Trusted current settings contain exactly `launchBudgetUsd`, `minimumPreAdMarginPct`, `minimumPostAdMarginPct`, `minimumRoiPct`. Export strict `ResearchBusinessSettingsSchema`, its inferred `ResearchBusinessSettings` type, and `DEFAULT_RESEARCH_BUSINESS_SETTINGS`. Defaults are 3000/35/35/150. Margins allow 0..100; ROI allows finite nonnegative values including >100. Launch budget is finite positive. No schema fallback silently fills missing settings.
- Remove `minimumProfitabilityPolicy` from the still-unreleased business evidence schema and fixtures. Candidate HTTP payloads cannot set or override criteria; settings are separate administrator-controlled data. No backwards-compatibility path for this unreleased schema.
- `assessResearchBusiness(evidence, now, settings: ResearchBusinessSettings)` takes the required trusted settings object as its third argument and validates it. The assessment returns `settings` containing the effective values, instead of a separate top-level `launchBudgetUsd`. All consumers read those effective settings; no duplicate policy authority.
- Task1 correction uses the current settings alone for pre-ad/post-ad/ROI comparison. Regression: identical source evidence changes eligibility when global budget or margin/ROI is changed; candidate-injected profitability policy is rejected; missing/invalid settings are rejected; unknown economics never become zero or a pass. Pre-ad and post-ad targets remain independently calculated. Purchase approval remains false.
- Task2 stores four columns in existing `app_settings`: `launch_budget_usd`, `minimum_pre_ad_margin_pct`, `minimum_post_ad_margin_pct`, `minimum_roi_pct`. Use one additive local-only migration with validated defaults and finite/range checks. Ensure the singleton exists using insert-on-conflict-do-nothing in this migration; preserve every existing row/value. GET does not bootstrap or write. Missing row at runtime or read failure fails closed.
- Replace the unimplemented budget-only endpoint with `/api/research-settings` GET/POST. Authenticated reads and CSRF-protected writes accept exactly the four editable commercial settings, update only those columns plus `updated_at`, and return persisted settings. Keep the existing API quotas, allocations, provider config and locale unchanged. Use one shared DB repository consumed by both web and worker. No budget-only endpoint or duplicate implementation remains.
- Task3 presents four labeled controls on existing settings page, explains pre/post-ad margin and ROI denominators, and marks initial values as editable defaults, not immutable TSS law. Saving a lower target explicitly by the administrator is authorized; candidate forms do not expose policy overrides. Candidate results show the effective settings. Existing TSS competition guidance remains unchanged.
- Task4 fetches the same current settings during selection AND execution, so queued jobs cannot use stale higher budget/lower targets. No new scheduler or API quota change.
- Task5 proves settings persist across refresh, changing budget and each profitability target re-evaluates unchanged candidate source evidence, candidate-policy injection is rejected, and unrelated settings remain identical. No production migration, paid API QA, external contact or deployment.

### Task 1: Typed commercial evidence and honest economics

**Files:** new shared modules above and `research-business.test.ts`; shared index; existing `packages/research-engine/src/economics.ts`, `economics.test.ts`.

**Consumes:** approved spec and schema contract. **Produces:** exported schema, types, selectors and pure assessment.

- [ ] Red: add tests distinguishing cash limit from margin, missing from zero, quantity-specific price from another quote's MOQ, and old evidence from malformed latest evidence.

```ts
it('does not authorize a purchase from missing commercial evidence', () => {
  expect(assessResearchBusiness(null, new Date('2026-09-05T00:00:00Z'), DEFAULT_RESEARCH_BUSINESS_SETTINGS))
    .toMatchObject({ stage: 'basic_check', estimatedLaunchCashUsd: null, purchaseApproved: false });
});
it('uses the post-ad target independently of the pre-ad target', () => {
  expect(calculateAllowableLandedCost({ salePrice: 100, amazonFees: 20,
    targetPreAdMarginPct: 30, expectedAdPct: 10, targetPostAdMarginPct: 20 }))
    .toMatchObject({ maxLandedCostForPreAd: 50, maxLandedCostForPostAd: 50 });
});
```

- [ ] Run `pnpm --filter @ara/shared exec vitest run src/research-business.test.ts` and `pnpm --filter @ara/research-engine exec vitest run src/economics.test.ts`; record intended RED.
- [ ] Green: strict schema, deterministic assessment, separate unit profit and launch cash. Cash = quantity * landed unit cost + separate upfront costs + ad cash + reserve; count each cost once. Missing costs cannot pass. Compute post-ad ceiling from its own target, not pre-ad ceiling minus ads.
- [ ] Add boundary fixtures: exactly $3000 vs $3000.01; unknown vs quoted zero cost; negative/NaN rejected; MOQ greater than order quantity; full shipment price vs unit price; same-spec quote reference required; expired quote cannot advance to purchase review; seller estimate does not become realized sales.
- [ ] Run shared/research-engine tests and typecheck. Commit task files only and submit scoped review.

### Task 2: Authenticated business evidence persistence

**Files:** new `apps/web/lib/server/candidate-business.ts`, corresponding test; new `apps/web/app/api/candidates/[id]/business/route.ts` and test; existing shared types from Task 1; one additive migration for four commercial `app_settings` columns and DB types; narrow shared DB research-settings repository/export/tests; authenticated `/api/research-settings` route/tests.

**Consumes:** strict evidence schema. **Produces:** authenticated GET/POST business record endpoint using append-only `candidate_evidence`, no candidate-state mutation.

```ts
// Observable endpoint contracts:
// unauthenticated GET -> 401; mutation without valid CSRF -> 401/403;
// invalid UUID, malformed schema, oversized body -> 400/413;
// nonexistent candidate -> 404; storage unavailable -> 503;
// valid authorized POST -> 201, then GET returns the new evidence + assessment.
```

- [ ] Inspect existing `requireAdminRead`, `requireAdminMutation`, bounded body/rate-limit patterns and candidate_evidence grants/check constraints. If kind restriction exists, use one additive migration and update this plan before applying locally; no production DDL.
- [ ] Persist `launch_budget_usd`, `minimum_pre_ad_margin_pct`, `minimum_post_ad_margin_pct`, `minimum_roi_pct` in existing app_settings, defaults3000/35/35/150, strict finite/range validation. Migration inserts singleton only if missing; preserves existing values. Runtime missing row/read errors fail closed. `/api/research-settings` accepts exactly these four camelCase fields through ResearchBusinessSettingsSchema and saves only these columns plus updated_at, preserving API quotas and other app settings. Candidate assessment and later worker load the same current settings; candidate overrides are rejected. Settings changes do not rewrite evidence. Verify with run-owned local DB, never production.
- [ ] Red: extend nearest route-test setup with the contracts above, including no DB insertion on validation/auth failure.
- [ ] Green: use server DB context, schema parse once, latest-record ordering and generic public error messages. Never return arbitrary candidate evidence or credentials. Do not implement GET side-effect writes.
- [ ] Repeated save is a new audited revision, not a duplicate research job. Verify latest data survives refresh and invalid new record fails closed.
- [ ] Run route tests, web typecheck/lint, isolated persistence integration. Commit and task review.

### Task 3: Business action workspace and web research handoff

**Files:** new focused `apps/web/components/candidate-business-form.tsx` and presentation module as needed; existing `apps/web/app/[locale]/candidates/[id]/page.tsx`; existing evidence/copy modules; existing import page guidance; existing settings page and focused launch-budget form; existing Playwright specs and route tests.

**Consumes:** Task 2 endpoint and Task 1 assessment. **Produces:** editable persisted commercial evidence with one clear next action.

- [ ] Read frontend and visual-QA skills and existing design tokens before UI changes. Reuse existing panel/form controls, ky, adminCsrfHeaders; no full redesign.
- [ ] Red E2E: authenticated candidate page -> enter explicit sourced quantity/cost/launch plan -> save -> reload -> values and derived stage retained. Editing quantity from affordable to overbudget blocks progression; it does not rewrite research history.
- [ ] Green: group inputs as product/specification, source references, quantity/quote, launch cash, market/checks. Never render unknown numeric values as 0. Explain estimates vs quotes and purchase-not-approved beside the result.
- [ ] Add four editable commercial settings fields (budget, pre-ad margin, post-ad margin, ROI), defaults3000/35/35/150, using `/api/research-settings`; verify save/reload. Candidate assessment displays effective settings; changing each re-evaluates unchanged evidence. Explain launch budget separately from Jungle Scout request quota, pre/post margin denominators and ROI versus margin. No candidate-specific target override.
- [ ] Add web handoff instructions: Opportunity Finder CSV uses existing upload, Top Products notes are source evidence not fabricated CSV columns, source observation time is not provider period. Preserve raw import and family provenance.
- [ ] Provide conditional next-action controls (market verification, enter missing costs, quote draft, record response, sample check) without automated messaging/order side effects. A draft may be copied, but must not claim supplier verification or omit missing specifications.
- [ ] Preserve sourced TSS competition guidance. Explain that margin35%/ROI150% are editable starting targets, not immutable gates, and show unverified criteria instead of auto-passing them. Include supplier-site/source links and exact-spec RFQ handoff so the workflow ends in sourcing/quote response, not just a score. Search links are not verified suppliers; drafts are not sent messages.
- [ ] Visual proof at 375/768/1280 for populated, missing and overbudget states; authenticated E2E with fixture credentials only. Commit and task review.

### Task 4: Decision-aware API admission and scheduling

**Files:** new `apps/worker/src/jobs/research-business-policy.ts` and test; existing daily-research, market-probe, deep-validation, enrich-strong-potential and their nearest tests; shared API purpose types only if current types cannot express the needed distinction.

**Consumes:** latest business evidence and assessment. **Produces:** one admission predicate checked at selection AND execution before any budgeted call.

```ts
type ResearchApiAdmission = {
  readonly allowed: boolean;
  readonly reason: string;
};
// assessResearchApiAdmission({ assessment, requestedEndpoint, explicitInitialCheck })
// rejects awaiting_quote/rejected by default; missing evidence permits only
// explicitly requested bounded initial checks, never the full deep fanout.
```

- [ ] Read all callers and existing retries/checkpoints before edits. Select missing/outdated endpoint evidence, not all deep endpoints every run. Check policy again in child job execution so a queued job cannot bypass a newly entered hold.
- [ ] Red tests: awaiting_quote + due job makes zero external calls; existing no-business candidate is not falsely approved; explicit initial check allows only its named minimal step; fresh cache causes zero wire requests; updated hold blocks stale queued request; stage-change resume does not duplicate completed cost.
- [ ] Green: preserve job status and existing idempotency/lease APIs, apply shared assessment before budget authorization. Do not silently change provider quota/reserve. Worker runs on Oracle only.
- [ ] Read current commercial settings through the shared DB helper during planning and child execution; a later lower budget or higher margin/ROI target must block a previously queued candidate. Source records do not override settings. Assessment returns the effective settings used.
- [ ] Remove numerical-presence shortcut in enrichment; derive non-provisional economics from the validated commercial assessment. Neither `Strong` nor a label alone grants purchase review.
- [ ] Daily planning prioritizes actionable evidence gaps, excludes pure quote/sample waits, and records no-work when none is actionable. Do not introduce a second parallel scheduler or unbounded API-only discovery.
- [ ] Run existing worker isolated harness plus nearest unit tests. Update relevant test fixtures explicitly to the new authority; never loosen the new gate to retain old fixture behavior. Commit and review.

### Task 5: End-to-end acceptance and release handoff

**Files:** existing E2E suite, `review-logs/2026-09-05-budget-first-workflow-validation.md`, isolated evidence directory, this plan checklist; no deployment configs unless required by proven implementation needs.

- [x] Run import -> candidate business record -> allowed API wire fixture -> preserved result -> quote wait -> zero repeated external-call E2E against isolated DB. `runImportJob` parsed the existing CSV into a run-owned REST DB; actual loopback HTTP wire count and persisted usage were 1 before `awaiting_quote` blocked the repeat at 0.
- [x] Run full relevant typecheck/lint/tests and diff checks, record exact source SHA. Task5 browser/static evidence binds rendered source `246bbebc8cba3f678f1ccd8a8766a3d2a99ea84a`; worker harness is 34 files/252 pass/5 skip with two documented Windows CRLF digest baseline failures.
- [x] Re-read spec and mark each implemented requirement or explicit remaining live-account gate. No paid provider/CSV download entitlement was inferred or consumed; existing read-only account boundary remains in QA preparation.
- [x] Prepare Cloudflare/Oracle release steps using the existing deployment docs; production worker is Oracle only and release archive is LF-pinned. Independent review and controller deployment decision remain pending; preserve user dirty work and old release.

## Plan self-review / current execution ledger

- Shared interface: Task 1 schema/assessment -> Task 2 persistence -> Task 3 UI -> Task 4 policy. Latest malformed evidence fails closed in every consumer.
- Shared files: shared index owned by Task 1; web route ownership Task 2; candidate page Task 3; worker jobs Task 4. Execute implementers sequentially; reviewer is read-only.
- Price/fee numeric existence is explicitly insufficient in Tasks 1 and 4. Task 3 never grants purchase approval.
- Unknown actual account capabilities are a live release gate, not invented plan values.
- Workspace approved: `.worktrees/budget-first-research`, `feat/budget-first-research`. Product implementation is in progress; no production changes.
