# Jungle Scout Validation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate promising niche clusters with the minimum useful Jungle Scout API spend, transform raw Product Database results into parent-level market evidence, and produce auditable Watch / Reject / Strong-potential decisions.

**Architecture:** The worker owns all Jungle Scout secrets and API calls. A budget manager checks daily spend, reserve, endpoint cache freshness, and job priority before each request. Market Probe retrieves up to 100 Product Database rows, then all expensive work is local: relevance filtering, parent dedupe, data-quality checks, micro-niche clustering, price segmentation, and market metrics. Additional endpoints are called only for survivors.

**Tech Stack:** TypeScript 6.0.3, Node.js 24.20.0, Supabase JS 2.112.2, Zod 4.4.3, Vitest 4.1.10.

**Spec:** `docs/superpowers/specs/2026-08-26-amazon-research-agent-design.md`

## Global Constraints

- Discovery is cheap; API calls are for validation.
- Daily API budget is configurable and always preserves a configurable reserve for manual Research Now and Strong re-validation.
- Exhausted budget moves work to `Waiting for API Budget`; it resumes later without losing state.
- Cache freshness is tracked independently per endpoint/niche.
- Product Database variant rows must never cause duplicated parent-family sales to be summed blindly.
- Keep `observed_sample_sales` separate from `estimated_market_sales`.
- Flag missing/inconsistent fields instead of silently trusting them.
- Final Opportunity Score priority: Competition 40%, Demand 30%, Margin 20%, Differentiation 10%; hard filters override score.
- Strong requires all configured hard gates, sufficient confidence, and independent AI cross-validation where available.

---

## File Map

```text
packages/jungle-scout/src/client.ts                    authenticated HTTP client
packages/jungle-scout/src/product-database.ts          Product Database request/response schemas
packages/jungle-scout/src/keywords.ts                  keyword validation endpoint adapter
packages/jungle-scout/src/cache-key.ts                 canonical endpoint cache keys
packages/research-engine/src/product-family.ts          parent dedupe
packages/research-engine/src/data-quality.ts            confidence warnings
packages/research-engine/src/relevance.ts               semantic relevance contract
packages/research-engine/src/micro-niche.ts             micro-niche and price segmentation
packages/research-engine/src/market-metrics.ts          competition/demand metrics
packages/research-engine/src/scoring/market-score.ts    40/30/20/10 score + gates
packages/api-budget/src/index.ts                        daily budget/reserve/cache decisions
apps/worker/src/jobs/market-probe.ts                    Level 1 validation
apps/worker/src/jobs/deep-validation.ts                 Level 2/3 calls
supabase/migrations/202608260003_validation.sql          products/snapshots/budget/cache tables
```

### Task 1: Add validation, product, snapshot, and API accounting schema

**Files:**
- Create: `supabase/migrations/202608260003_validation.sql`
- Create: `packages/shared/src/jungle-scout.ts`
- Create: `packages/shared/src/jungle-scout.test.ts`

**Interfaces:**
- Produces tables: `products`, `product_families`, `market_snapshots`, `api_usage`, `api_cache`, `api_budget_daily`, `risks`, `candidate_evidence`.
- `api_usage` records endpoint, cache key, HTTP status, call count, candidate/cluster, started/completed timestamps.

- [ ] **Step 1: Write failing schema tests for cache and budget keys**

```ts
it('normalizes a Product Database request into a stable cache key', () => {
  expect(makeApiCacheKey({ endpoint: 'product_database', marketplace: 'us', phrases: ['faucet mat','sink splash guard'] }))
    .toBe(makeApiCacheKey({ endpoint: 'product_database', marketplace: 'us', phrases: ['sink splash guard','faucet mat'] }));
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/shared test -- jungle-scout.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement shared schemas and SQL tables**

`market_snapshots` must contain `observed_sample_sales`, nullable `estimated_market_sales`, `sample_product_family_count`, `source_endpoint_set`, `captured_at`, and `confidence`.

- [ ] **Step 4: Apply migration and run tests**

```bash
supabase db reset
pnpm --filter @ara/shared test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260003_validation.sql packages/shared
 git commit -m "feat: add market validation and api accounting schema"
```

### Task 2: Implement Jungle Scout authenticated client

**Files:**
- Create: `packages/jungle-scout/src/client.ts`
- Create: `packages/jungle-scout/src/client.test.ts`

**Interfaces:**
- Produces `JungleScoutClient` configured with `{ keyName, apiKey, baseUrl }`.
- Authorization format: `${keyName}:${apiKey}`.
- Fixed headers: `X-API-Type: junglescout`, `Accept: application/vnd.junglescout.v1+json`, `Content-Type: application/vnd.api+json`.

- [ ] **Step 1: Write failing mock-server header/error tests**

```ts
it('sends Jungle Scout auth without logging the api key', async () => {
  const client = makeClient('AI', 'secret-key');
  await client.request('/api/test?marketplace=us', { method: 'GET' });
  expect(mockRequest.headers.authorization).toBe('AI:secret-key');
  expect(capturedLogs.join('\n')).not.toContain('secret-key');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/jungle-scout test -- client.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement HTTP client**

Retry policy:
- 429/5xx: max 2 retries with jitter, but each actual HTTP request is counted in `api_usage`.
- 400/403/404/409/415/422: no retry.
- Parse JSON API error body and surface code/status without secret-bearing headers.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/jungle-scout test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jungle-scout/src/client.ts packages/jungle-scout/src/client.test.ts
 git commit -m "feat: add jungle scout authenticated client"
```

### Task 3: Implement Product Database adapter from Phase 0 contract

**Files:**
- Create: `packages/jungle-scout/src/product-database.ts`
- Create: `packages/jungle-scout/src/product-database.test.ts`
- Create: `tests/fixtures/jungle-scout/product-database-sink.json`

**Interfaces:**
- Produces `queryProductDatabase(input): Promise<ProductDatabasePage>`.
- Supports marketplace `us`, max page size 100, catalog phrase OR query, optional filters, sort.

- [ ] **Step 1: Write failing fixture parsing test**

Use a sanitized fixture containing title, price, reviews, rating, parent_asin, seller_type, brand, rank, dimensions, weight, sellers, buy box, listing date, 30-day revenue/units, fee breakdown, updated_at.

```ts
it('preserves missing fields instead of substituting zero', () => {
  const page = ProductDatabasePageSchema.parse(SINK_FIXTURE);
  const missingPrice = page.data.find(p => p.attributes.title.includes('NiuYichee'))!;
  expect(missingPrice.attributes.price).toBeNull();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/jungle-scout test -- product-database.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement request and response schemas**

Do not coerce absent `price`, `weight`, `reviews`, `rating` to zero. Keep `parent_asin` and raw `id` so standalone products can fall back to their ASIN identity.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/jungle-scout test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/jungle-scout/src/product-database.ts packages/jungle-scout/src/product-database.test.ts tests/fixtures/jungle-scout
 git commit -m "feat: add product database adapter"
```

### Task 4: Implement API budget manager, reserve, and cache

**Files:**
- Create: `packages/api-budget/package.json`
- Create: `packages/api-budget/src/index.ts`
- Create: `packages/api-budget/src/index.test.ts`

**Interfaces:**
- Produces `authorizeApiCall(input): Promise<ApiAuthorizationDecision>`.
- Decision kinds: `cache_hit`, `allowed`, `deferred_budget`, `blocked_policy`.

- [ ] **Step 1: Write failing budget tests**

```ts
it('preserves reserve and defers normal research', async () => {
  seedBudget({ dailyLimit: 20, used: 15, reserve: 5 });
  const decision = await authorizeApiCall({ purpose: 'normal_validation', estimatedCalls: 1, cacheKey: 'new' });
  expect(decision.kind).toBe('deferred_budget');
});

it('allows manual research to use reserved calls', async () => {
  seedBudget({ dailyLimit: 20, used: 15, reserve: 5 });
  const decision = await authorizeApiCall({ purpose: 'manual_research', estimatedCalls: 1, cacheKey: 'new' });
  expect(decision.kind).toBe('allowed');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/api-budget test
```
Expected: FAIL.

- [ ] **Step 3: Implement atomic authorization**

Use a database transaction/RPC to check `(used + requested) <= dailyLimit - reserve` for normal work and increment the reserved counter only when a real HTTP call is about to be made. Cache hits never increment usage.

Default freshness for Milestone 3:
- Product Database: 24 hours
- keyword metrics: 7 days
- historical metrics: 14 days
- sales estimate: 24 hours

All values are configurable in Settings later.

- [ ] **Step 4: Run concurrency tests**

```bash
pnpm --filter @ara/api-budget test
```
Expected: PASS when 10 workers concurrently request the final available call; only one receives `allowed`.

- [ ] **Step 5: Commit**

```bash
git add packages/api-budget
 git commit -m "feat: add jungle scout api budget and cache policy"
```

### Task 5: Implement parent-ASIN product family dedupe

**Files:**
- Create: `packages/research-engine/src/product-family.ts`
- Create: `packages/research-engine/src/product-family.test.ts`

**Interfaces:**
- Produces `groupProductFamilies(products): ProductFamily[]`.
- Family key is `parent_asin` when present, else product ASIN/id.

- [ ] **Step 1: Write failing duplicate-sales test**

```ts
it('does not sum identical parent-level sales repeated across variants', () => {
  const families = groupProductFamilies(zulayVariantFixture());
  expect(families).toHaveLength(1);
  expect(families[0].observedMonthlyUnits).toBe(200368);
  expect(families[0].variants).toHaveLength(5);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- product-family.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement family aggregation**

For duplicated variant rows with identical parent-level sales, take one family demand value and store a `VARIANT_SALES_DUPLICATED` quality note. Price/rating/review variant distributions may still be retained separately.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine/src/product-family.ts packages/research-engine/src/product-family.test.ts
 git commit -m "feat: dedupe product database variants by parent asin"
```

### Task 6: Implement data-quality warnings

**Files:**
- Create: `packages/research-engine/src/data-quality.ts`
- Create: `packages/research-engine/src/data-quality.test.ts`

**Interfaces:**
- Produces `evaluateProductDataQuality(productOrFamily): DataQualityResult`.

- [ ] **Step 1: Write failing Phase 0 warning tests**

```ts
it('flags missing price and revenue per unit inconsistency', () => {
  const result = evaluateProductDataQuality({ price: null, units: 3505, revenue: 9449, updatedAt: '2026-08-27T01:32:04Z' });
  expect(result.flags).toContain('MISSING_PRICE');
  expect(result.confidence).toBeLessThan(1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- data-quality.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement flags**

Required flags: `MISSING_PRICE`, `MISSING_WEIGHT`, `MISSING_REVIEWS`, `MISSING_RATING`, `REVENUE_PRICE_MISMATCH`, `VARIANT_SALES_DUPLICATED`, `STALE_SOURCE`.

`REVENUE_PRICE_MISMATCH` triggers when price exists and `abs((revenue/units)-price)/price > 0.35`; if price is missing, record only missing price instead of inventing a price.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine/src/data-quality.ts packages/research-engine/src/data-quality.test.ts
 git commit -m "feat: add explicit market data quality warnings"
```

### Task 7: Implement semantic relevance and micro-niche clustering contract

**Files:**
- Create: `packages/research-engine/src/relevance.ts`
- Create: `packages/research-engine/src/micro-niche.ts`
- Create: `packages/research-engine/src/micro-niche.test.ts`

**Interfaces:**
- `classifyProductRelevance(candidate, family, aiRouter): Promise<{ relevant: boolean; confidence: number; reason: string }>`.
- `clusterMicroNiches(families, aiRouter): Promise<MicroNicheCluster[]>`.
- `segmentPrices(cluster): PriceSegment[]`.

- [ ] **Step 1: Write failing sink fixture test**

Expected clusters from fixture:
- `Silicone Faucet Mat / Sink Splash Guard`
- `Diatomite / Stone Drying Tray`
- `Acrylic Splash Guard`

Rugs, bath mats, shower threshold strips, and under-sink cabinet liners must be irrelevant.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- micro-niche.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement deterministic prefilter + AI structured classification**

First apply title/path lexical exclusions to remove obvious noise; use AI only for ambiguous rows. Price segmentation uses median and natural gaps: if sorted prices have a gap >= 40% between adjacent medians with at least 3 products on each side, create separate price segments; otherwise keep one segment.

- [ ] **Step 4: Run fixture tests**

```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS; cheap silicone and premium silicone can be separated when the data supports a natural gap.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine/src/relevance.ts packages/research-engine/src/micro-niche.ts packages/research-engine/src/micro-niche.test.ts
 git commit -m "feat: cluster relevant product micro niches and price segments"
```

### Task 8: Implement market metrics and score gates

**Files:**
- Create: `packages/research-engine/src/market-metrics.ts`
- Create: `packages/research-engine/src/scoring/market-score.ts`
- Create: `packages/research-engine/src/scoring/market-score.test.ts`

**Interfaces:**
- Produces `MarketMetrics` and `MarketScoreResult` with component scores, confidence, hard gates, reasons.

- [ ] **Step 1: Write failing metric tests**

```ts
it('calculates top-3 sales concentration from family sales', () => {
  const metrics = calculateMarketMetrics(makeFamilies([1000,500,250,250]));
  expect(metrics.top3SalesConcentration).toBe(0.875);
  expect(metrics.observedSampleSales).toBe(2000);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- market-score.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement required metrics**

Competition signals:
- Top-10 average reviews
- median reviews
- share >1,000 reviews
- brand concentration
- sales concentration
- Amazon retail presence
- price compression
- newer low-review seller success.

Demand signals:
- observed sample sales
- search demand when available
- top-1/top-3 concentration
- trend/historical consistency when available.

Margin evidence:
- keep `estimated` vs `supplier_verified` separate.
- if only Amazon fees are available and sourcing cost is unknown, margin score is provisional and candidate cannot become final Strong.

Differentiation:
- until permitted review-text enrichment is available, store `pending` with confidence penalty; do not fake review insights.

- [ ] **Step 4: Implement score/gates**

Score weights: Competition 40, Demand 30, Margin 20, Differentiation 10. Hard filter failure forces Reject. `strong_potential` is an analysis verdict only, not a CandidateState. Missing provisional margin/differentiation prevents final `Strong`; the candidate remains `Needs Review` or `Watch` until the missing evidence is enriched.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @ara/research-engine test
 git add packages/research-engine/src/market-metrics.ts packages/research-engine/src/scoring
 git commit -m "feat: calculate market metrics and opportunity score"
```

### Task 9: Implement Level 1 Market Probe worker job

**Files:**
- Create: `apps/worker/src/jobs/market-probe.ts`
- Create: `apps/worker/src/jobs/market-probe.integration.test.ts`
- Modify: `apps/worker/src/handlers.ts`

**Interfaces:**
- Consumes candidate `catalogPhrases` from AI normalization.
- Produces Product Database raw snapshot, product families, micro-niches, price segments, market metrics, API usage/cache, state transitions.

- [ ] **Step 1: Write failing `sink drip tray` end-to-end fixture test**

```ts
it('expands sink niche, caches the Product Database page, and produces relevant micro niches', async () => {
  const candidate = await seedSinkCandidate({ catalogPhrases: ['sink mat','faucet mat','sink splash guard','silicone sink mat','faucet splash guard'] });
  await runMarketProbeWithRecordedFixture(candidate.id);
  expect(await productFamilyCount(candidate.id)).toBeGreaterThan(0);
  expect(await microNicheNames(candidate.id)).toContain('Silicone Faucet Mat / Sink Splash Guard');
  expect(await apiUsageCount(candidate.id, 'product_database')).toBe(1);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/worker test -- market-probe.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement Market Probe checkpoint sequence**

Checkpoint phases:

```ts
'budget_authorized' -> 'api_fetched' -> 'families_persisted' -> 'relevance_filtered' -> 'micro_niches_created' -> 'metrics_scored' -> 'completed'
```

If budget decision is `deferred_budget`, set candidate to `Waiting for API Budget`, complete the current queue job without error, and enqueue a future eligible validation job at the next budget reset.

- [ ] **Step 4: Run crash/resume/cache tests**

Simulate failure immediately after `api_fetched`; rerun job. Expected: second run uses persisted/cached response and `api_usage` remains one real call.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/market-probe.ts apps/worker/src/jobs/market-probe.integration.test.ts apps/worker/src/handlers.ts
 git commit -m "feat: validate niche markets with budgeted product database probes"
```

### Task 10: Add Level 2 keyword/historical validation only for survivors

**Files:**
- Create: `packages/jungle-scout/src/keywords.ts`
- Create: `packages/jungle-scout/src/keywords.test.ts`
- Create: `apps/worker/src/jobs/deep-validation.ts`
- Create: `apps/worker/src/jobs/deep-validation.integration.test.ts`

**Interfaces:**
- Consumes only candidates meeting Level 1 thresholds.
- Produces keyword demand/trend evidence and additional snapshots through cache/budget manager.

- [ ] **Step 1: Write failing eligibility test**

```ts
it('does not spend Level 2 calls on a Level 1 Reject', async () => {
  const candidate = await seedCandidate({ level1Decision: 'Reject' });
  await runDeepValidation(candidate.id);
  expect(await apiUsageCount(candidate.id, 'keywords_by_keyword')).toBe(0);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/worker test -- deep-validation.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement keyword endpoint adapter and survivor gate**

Use Keyword API values as keyword-market evidence, not as Product Database product counts. Preserve exact vs upper-bound semantics and do not assume the keyword phrase itself can be reused as a Product Database catalog phrase.

- [ ] **Step 4: Run integration tests**

```bash
pnpm --filter @ara/worker test
```
Expected: PASS and API usage occurs only for eligible candidates.

- [ ] **Step 5: Commit**

```bash
git add packages/jungle-scout/src/keywords.ts packages/jungle-scout/src/keywords.test.ts apps/worker/src/jobs/deep-validation.ts apps/worker/src/jobs/deep-validation.integration.test.ts
 git commit -m "feat: add survivor only keyword validation"
```

### Task 11: Add deep evidence endpoints and provisional economics without fabricating supplier data

**Files:**
- Create: `packages/jungle-scout/src/historical-search-volume.ts`
- Create: `packages/jungle-scout/src/sales-estimates.ts`
- Create: `packages/jungle-scout/src/share-of-voice.ts`
- Create: `packages/research-engine/src/economics.ts`
- Create: `packages/research-engine/src/economics.test.ts`
- Create: `apps/worker/src/jobs/enrich-strong-potential.ts`
- Create: `apps/worker/src/jobs/enrich-strong-potential.integration.test.ts`

**Interfaces:**
- Deep evidence calls remain behind the same API budget/cache manager.
- `calculateAllowableLandedCost(input)` computes the maximum landed cost compatible with configured margin targets; it never invents a supplier quote.
- Optional estimated sourcing inputs are stored with `economics_source='estimated_assumption'`; later supplier quotes use `economics_source='supplier_verified'` and replace, not overwrite, the historical estimate.

- [ ] **Step 1: Write failing allowable-cost tests**

```ts
it('calculates max landed cost required for a 30 percent pre-ad margin', () => {
  const result = calculateAllowableLandedCost({
    salePrice: 29.99,
    amazonFees: 10.33,
    targetPreAdMarginPct: 30,
    expectedAdPct: 10,
    targetPostAdMarginPct: 20
  });
  expect(result.maxLandedCostForPreAd).toBeCloseTo(10.663, 3);
  expect(result.maxLandedCostForPostAd).toBeCloseTo(7.664, 3);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- economics.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement historical/search/SOV adapters and economics calculations**

Use the official Jungle Scout endpoints only after Level 1 survival. Historical Search Volume checks seasonality/consistency, Sales Estimates checks daily sales/price stability for selected ASINs, and Share of Voice checks brand dominance for selected keywords. Each adapter must use canonical cache keys and the budget manager.

Economics outputs must include:
- sale price
- Amazon fees
- configurable expected ad percentage
- maximum landed cost for 30% pre-ad contribution margin
- maximum landed cost for 20% post-ad net margin
- optional estimated unit/packaging/freight/duty/inbound inputs with explicit confidence and source
- initial order affordability against $2,000-$2,500 preferred and $3,000 hard ceiling when MOQ/cost assumptions exist.

- [ ] **Step 4: Add differentiation evidence mode without pretending review text exists**

The enrichment job stores `differentiation_evidence_mode` as one of `review_text`, `listing_proxy`, or `missing`. Until a permitted/validated review-text source is available, `listing_proxy` may use listing quality, rating weakness, repeated title/feature patterns, and micro-niche gaps, but the UI must label it as proxy evidence. `missing` or low-confidence proxy evidence prevents final `Strong`.

- [ ] **Step 5: Run integration tests and commit**

```bash
pnpm --filter @ara/research-engine test
pnpm --filter @ara/worker test -- enrich-strong-potential.integration.test.ts
 git add packages/jungle-scout packages/research-engine/src/economics.ts packages/research-engine/src/economics.test.ts apps/worker/src/jobs/enrich-strong-potential.ts apps/worker/src/jobs/enrich-strong-potential.integration.test.ts
 git commit -m "feat: enrich strong potential niches with deep evidence and economics"
```

### Task 12: Verify Milestone 3 acceptance criteria

**Files:**
- Create: `docs/verification/milestone-3.md`

- [ ] **Step 1: Run recorded Phase 0 fixtures through the full pipeline**

Required fixtures:
- milk frother Product Database success
- `sink drip tray` literal 0-result record
- expanded sink phrase 329-result metadata + top page fixture
- Opportunity Finder batter-dispenser cluster.

- [ ] **Step 2: Verify API budget behavior**

Set daily limit 3/reserve 1 and queue four normal candidates plus one manual candidate. Expected: two normal validation calls allowed, remaining normal candidates deferred, manual call may use reserve.

- [ ] **Step 3: Verify no variant double counting and no sample/full-market confusion**

Database checks must show `observed_sample_sales` populated and `estimated_market_sales` null unless a separate estimation endpoint supplied it.

- [ ] **Step 4: Record evidence and commit**

```bash
git add docs/verification/milestone-3.md
 git commit -m "test: verify jungle scout validation milestone"
```
