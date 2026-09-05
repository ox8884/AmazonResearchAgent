# Budget-first web/API research implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist evidence-backed launch feasibility, show the next commercial action, and allow Jungle Scout calls only when they can advance that action.

**Architecture:** Preserve candidate execution states and the existing durable queue. Add a versioned business evidence document and a shared pure assessment used by the web and worker. Existing official Jungle Scout adapters remain behind their current atomic request authorization; browser research stays in the logged-in in-app browser.

**Tech Stack:** Existing TypeScript, Zod, Next.js, Supabase, pnpm, Vitest, Playwright. No new dependencies.

**Spec:** `RESEARCH_WORKFLOW.md` (approved by user).

## Global Constraints

- 총 출시 현금 $3,000 이내.
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
  readonly stage: ResearchBusinessStage;
  readonly gaps: readonly string[];
  readonly estimatedLaunchCashUsd: number | null;
  readonly estimatedUnitContributionUsd: number | null;
  readonly estimatedMarginPct: number | null;
  readonly purchaseApproved: false;
};
```

`ResearchBusinessEvidenceSchema` is a strict version-1 object, kind `research_business_v1`. Its fields cover: specification text; US marketplace; brand fit; explicit disposition (`research`, `awaiting_quote`, `awaiting_sample`, `rejected`); sourced sale price; sourced Amazon unit costs; one selected quantity/quote pairing with MOQ and landed-cost coverage; fixed launch costs, advertising cash, reserve; per-unit advertising/return assumptions; explicit minimum margin/ROI policy; market, sample and safety/IP checks with source references; requested API purposes. Unknown fields remain nullable, never numeric zero defaults. Each source contains URL/reference, recordedAt and basis (estimate/quote/observed). User-entered claims are not silently promoted to independently verified facts.

Schema requires finite nonnegative money, positive integer quantity/MOQ, rates in [0,100], bounded text and valid timestamps. Reject mismatched quantity/MOQ, expired quote for purchase review, and non-USD monetary computation without an explicit converted USD value/reference. Missing quote yields hold/basic investigation, not rejection. Actual purchase remains manual.

```ts
assessResearchBusiness(evidence: ResearchBusinessEvidence | null, now: Date): ResearchBusinessAssessment
selectLatestResearchBusiness(rows: readonly ResearchBusinessEvidenceRow[]): ResearchBusinessEvidence | null
```

Latest malformed/incomplete record must not fall back to older qualifying evidence. `created_at` + `id` determine latest record, consistent with existing web evidence logic.

### Task 1: Typed commercial evidence and honest economics

**Files:** new shared modules above and `research-business.test.ts`; shared index; existing `packages/research-engine/src/economics.ts`, `economics.test.ts`.

**Consumes:** approved spec and schema contract. **Produces:** exported schema, types, selectors and pure assessment.

- [ ] Red: add tests distinguishing cash limit from margin, missing from zero, quantity-specific price from another quote's MOQ, and old evidence from malformed latest evidence.

```ts
it('does not authorize a purchase from missing commercial evidence', () => {
  expect(assessResearchBusiness(null, new Date('2026-09-05T00:00:00Z')))
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

**Files:** new `apps/web/lib/server/candidate-business.ts`, corresponding test; new `apps/web/app/api/candidates/[id]/business/route.ts` and test; existing shared types from Task 1.

**Consumes:** strict evidence schema. **Produces:** authenticated GET/POST business record endpoint using append-only `candidate_evidence`, no candidate-state mutation.

```ts
// Observable endpoint contracts:
// unauthenticated GET -> 401; mutation without valid CSRF -> 401/403;
// invalid UUID, malformed schema, oversized body -> 400/413;
// nonexistent candidate -> 404; storage unavailable -> 503;
// valid authorized POST -> 201, then GET returns the new evidence + assessment.
```

- [ ] Inspect existing `requireAdminRead`, `requireAdminMutation`, bounded body/rate-limit patterns and candidate_evidence grants/check constraints. If kind restriction exists, use one additive migration and update this plan before applying locally; no production DDL.
- [ ] Red: extend nearest route-test setup with the contracts above, including no DB insertion on validation/auth failure.
- [ ] Green: use server DB context, schema parse once, latest-record ordering and generic public error messages. Never return arbitrary candidate evidence or credentials. Do not implement GET side-effect writes.
- [ ] Repeated save is a new audited revision, not a duplicate research job. Verify latest data survives refresh and invalid new record fails closed.
- [ ] Run route tests, web typecheck/lint, isolated persistence integration. Commit and task review.

### Task 3: Business action workspace and web research handoff

**Files:** new focused `apps/web/components/candidate-business-form.tsx` and presentation module as needed; existing `apps/web/app/[locale]/candidates/[id]/page.tsx`; existing evidence/copy modules; existing import page guidance; existing Playwright specs and route tests.

**Consumes:** Task 2 endpoint and Task 1 assessment. **Produces:** editable persisted commercial evidence with one clear next action.

- [ ] Read frontend and visual-QA skills and existing design tokens before UI changes. Reuse existing panel/form controls, ky, adminCsrfHeaders; no full redesign.
- [ ] Red E2E: authenticated candidate page -> enter explicit sourced quantity/cost/launch plan -> save -> reload -> values and derived stage retained. Editing quantity from affordable to overbudget blocks progression; it does not rewrite research history.
- [ ] Green: group inputs as product/specification, source references, quantity/quote, launch cash, market/checks. Never render unknown numeric values as 0. Explain estimates vs quotes and purchase-not-approved beside the result.
- [ ] Add web handoff instructions: Opportunity Finder CSV uses existing upload, Top Products notes are source evidence not fabricated CSV columns, source observation time is not provider period. Preserve raw import and family provenance.
- [ ] Provide conditional next-action controls (market verification, enter missing costs, quote draft, record response, sample check) without automated messaging/order side effects. A draft may be copied, but must not claim supplier verification or omit missing specifications.
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
- [ ] Remove numerical-presence shortcut in enrichment; derive non-provisional economics from the validated commercial assessment. Neither `Strong` nor a label alone grants purchase review.
- [ ] Daily planning prioritizes actionable evidence gaps, excludes pure quote/sample waits, and records no-work when none is actionable. Do not introduce a second parallel scheduler or unbounded API-only discovery.
- [ ] Run existing worker isolated harness plus nearest unit tests. Update relevant test fixtures explicitly to the new authority; never loosen the new gate to retain old fixture behavior. Commit and review.

### Task 5: End-to-end acceptance and release handoff

**Files:** existing E2E suite, `review-logs/2026-09-05-budget-first-workflow-validation.md`, isolated evidence directory, this plan checklist; no deployment configs unless required by proven implementation needs.

- [ ] Run import -> candidate business record -> allowed API wire fixture -> preserved result -> quote wait -> zero repeated external-call E2E against isolated DB. Include auth/CSRF denial, stale/malformed evidence, budget exhaustion and model/provider attribution regressions.
- [ ] Run full relevant typecheck/lint/tests and diff checks, record exact source SHA. Whole-branch independent review binds to that SHA, followed by fixes/re-review if required.
- [ ] Re-read spec and mark each implemented requirement or explicit remaining live-account gate. Do not describe a schema/helper-only change as a complete workflow.
- [ ] Inspect real JS account CSV/API access and remaining quota read-only in logged-in in-app browser when available; never infer entitlement from documentation. If unavailable, report that boundary and do not send paid test requests.
- [ ] Prepare Cloudflare/Oracle release steps using the existing deployment docs; do not start a Windows production worker. Ask for live paid verification boundary before consuming API quota for QA. Preserve user dirty work and old release.

## Plan self-review / current execution ledger

- Shared interface: Task 1 schema/assessment -> Task 2 persistence -> Task 3 UI -> Task 4 policy. Latest malformed evidence fails closed in every consumer.
- Shared files: shared index owned by Task 1; web route ownership Task 2; candidate page Task 3; worker jobs Task 4. Execute implementers sequentially; reviewer is read-only.
- Price/fee numeric existence is explicitly insufficient in Tasks 1 and 4. Task 3 never grants purchase approval.
- Unknown actual account capabilities are a live release gate, not invented plan values.
- Workspace choice pending asynchronous user response. No product files changed at plan creation.
