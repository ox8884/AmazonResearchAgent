# Milestone 3 verification

Recorded fixtures only. No live Jungle Scout calls.

Requires local Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_DATABASE_URL`).

Commands:

```bash
pnpm --filter @ara/worker exec vitest run src/jobs/milestone-3.acceptance.test.ts
pnpm --filter @ara/worker exec vitest run src/jobs/milestone-3-pipeline.acceptance.test.ts
```

Both are included in `pnpm test:integration`.

| Scenario | Fixture | Expected |
| --- | --- | --- |
| Milk frother / Zulay | `tests/fixtures/jungle-scout/product-database-milk-frother.json` | One family, observed_sample_sales=200368, estimated_market_sales null |
| Sink literal zero | `product-database-sink-zero.json` | First Product Database request is exactly `sink drip tray`; zero families / zero sample sales |
| Expanded sink 329 | `product-database-sink-expanded-meta.json` + top page `product-database-sink.json` | Same candidate then expands aliases; coverage `result_count` matches recorded fixture 329; seller_type and dimensions persist |
| OF batter dispenser | `tests/fixtures/opportunity-finder/page-1.csv` then `product-database-batter-dispenser.json` | Import → normalize → Market Probe; B0BATTER1 kept; rug noise excluded |
| Family segments | sink expansion path | Parent `B0SINKPARENT` and standalone `B0MISSING1` count once each; silicone cluster `priceSegments` is `all` at $12.99 with familyCount 1 |
| Budget 3 / reserve 1 | four normal + one `manual_research` | Two normal HTTP, two Waiting for API Budget, manual uses reserve |
| Durable resume | deferred job `market-probe-resume:*` | Future job is not claimable before reset; after simulated reset, `claimJobs` + `handlers.MARKET_PROBE` + `runJob` consume it; one HTTP; candidate and evidence remain |
| Cache reuse | same sink top page | Second probe does not pay again |
