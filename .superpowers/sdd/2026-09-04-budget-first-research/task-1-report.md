# Task 1 — Typed commercial evidence and honest economics

## Status

Validated and ready for scoped parent review/commit from base `49846d651940fdf84d914d298066b468510a2b64`.

## Exported interface

```ts
ResearchBusinessEvidenceSchema: z.ZodType<ResearchBusinessEvidence>
ResearchBusinessMoneySchema: z.ZodType<ResearchBusinessMoney>
ResearchBusinessSourceSchema: z.ZodType<ResearchBusinessSource>
type ResearchBusinessEvidence
type ResearchBusinessEvidenceInput
type ResearchBusinessEvidenceRow = {
  readonly id: string;
  readonly created_at: string;
  readonly payload: unknown;
}
type ResearchBusinessStage =
  | 'basic_check' | 'market_validation' | 'quote_ready'
  | 'awaiting_quote' | 'awaiting_sample' | 'purchase_review'
  | 'hold' | 'reject';
type ResearchBusinessAssessment = {
  readonly stage: ResearchBusinessStage;
  readonly gaps: readonly string[];
  readonly launchBudgetUsd: number;
  readonly estimatedLaunchCashUsd: number | null;
  readonly estimatedUnitContributionUsd: number | null;
  readonly estimatedMarginPct: number | null;
  readonly purchaseApproved: false;
};
const DEFAULT_RESEARCH_LAUNCH_BUDGET_USD = 3000;
const ResearchLaunchBudgetSchema: z.ZodType<number>;
function selectLatestResearchBusiness(
  rows: readonly ResearchBusinessEvidenceRow[]
): ResearchBusinessEvidence | null;
function assessResearchBusiness(
  evidence: ResearchBusinessEvidence | null,
  now: Date,
  launchBudgetUsd: number
): ResearchBusinessAssessment;
```

`ResearchBusinessEvidenceSchema` is a strict `kind: 'research_business_v1'` document with no embedded launch-budget field. `ResearchLaunchBudgetSchema` accepts only finite positive money; the required assessment input is the current global setting and is echoed in the resulting assessment for display/audit.

## Field decisions and semantics

- `specification { reference, description }`, `marketplace: 'US'`, `brandFit`, and `disposition` identify the exact product and commercial posture without changing existing candidate/job state. The budget is intentionally absent so a stale evidence revision cannot override current application settings.
- `ResearchBusinessSource { reference, url, recordedAt, basis }` preserves source identity and whether a value is `estimate`, supplier `quote`, or `observed`; user-entered estimates stay estimates. `url` is nullable or a validated `http`/`https` URL only, so a UI can safely render it as an outbound link.
- `ResearchBusinessMoney { amount, currency, amountUsd, source, usdConversionSource }` represents unknown values as all-null, permits sourced USD zero, and requires a separate conversion source for non-USD arithmetic.
- `selectedQuote` binds `specificationReference`, `orderQuantity`, `minimumOrderQuantity`, `landedUnitCost`, and `landedShipmentTotal` to one selected source reference. It rejects MOQ above selected quantity, cross-specification offers, cross-quote price values, and inconsistent unit/total amounts. `incoterm`, `destination`, `leadTimeDays`, and `landedCostCoverage` remain explicit so incomplete quote terms cannot reach purchase review.
- `upfrontLaunchCost`, `launchAdvertisingCash`, and `launchReserveCash` are separate one-time cash entries. Launch cash is only `quantity × landedUnitCost + upfrontLaunchCost + launchAdvertisingCash + launchReserveCash`; Amazon/return/per-unit ad costs are not double-counted as launch cash.
- `amazonUnitCosts`, `perUnitAdCost`, and `perUnitReturnCost` form contribution: sale price minus landed unit cost, Amazon costs, per-unit advertising, and expected returns. Any unknown required cost yields `null`, never zero.
- `minimumProfitabilityPolicy` fixes explicit pre-ad margin, post-ad margin, and ROI thresholds with a source. Margin rates stay in 0–100; ROI is finite nonnegative so the canonical Forge Kitchen ROI `150%+` policy is representable. Assessment calculates pre-ad and post-ad/ROI independently and does not infer a pass from omitted policy values.
- `marketCheck { status, source, sourcePeriod, comparisonRationale, sellerEstimatedMonthlySales, sellerEstimateSource }` allows a documented estimate-backed market pass. Seller sales remains a separately sourced `estimate`; it is not modeled as realised seller sales. `sampleCheck` and `safetyIpCheck` are independently sourced checks.
- `requestedApiPurposes` is intentionally `JungleScoutEndpointSchema[]` (`product_database`, etc.), not `ApiCallPurposeSchema[]`. It expresses only missing endpoint requests and preserves existing durable API budget-purpose semantics.

## Stage derivation

- Missing evidence/foundational product economics: `basic_check`.
- A quote-less candidate with incomplete market evidence: `market_validation`, allowing bounded evidence collection without fabricating a supplier quote.
- A complete, financially feasible estimate-based supply offer: `quote_ready`; explicit request posture becomes `awaiting_quote`.
- Current supplier quote plus pending sample: `awaiting_sample`.
- `purchase_review` requires cash at or below the validated current global launch budget, profitability policy pass, current quote expiry, shipping/landed-cost completeness, and passed sample/safety-IP checks. The same $4,000 plan holds at $3,000/$3,500 and advances at $5,000 when all non-budget checks pass. It always returns `purchaseApproved: false`; payment and ordering remain manual.
- Missing, expired, over-budget, or incomplete commercial evidence returns `hold`; explicit rejected disposition returns `reject`. The selector orders by `created_at`, then `id`, parses only the newest row, and returns `null` rather than reviving an older valid revision after a malformed newest payload.

## RED/GREEN evidence

- RED: `pnpm --filter @ara/shared exec vitest run src/research-business.test.ts` initially failed because the new shared module did not exist; `pnpm --filter @ara/research-engine exec vitest run src/economics.test.ts` failed because the helper reused the pre-ad ceiling. Focused RED also covered missing quote-completeness fields, executable source URLs, and the user-corrected global launch-budget/ROI policy contract.
- GREEN focused: shared 18/18 and research-engine 2/2 passed.
- GREEN affected full suites: `pnpm --filter @ara/shared test` → 7 files/44 tests; `pnpm --filter @ara/research-engine test` → 10 files/47 tests.
- Static checks: both package `typecheck` and `lint` passed; `git diff --check` passed.

## Scope and limits

Only shared schema/assessment/index plus the existing research-engine economics helper/tests changed. No database schema, production environment, worker/web route, paid provider call, supplier contact, purchase, or deployment was performed.
