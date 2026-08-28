# Milestone 3 verification

Recorded fixtures only. No live Jungle Scout calls.

Command:

```bash
pnpm --filter @ara/worker exec vitest run src/jobs/milestone-3.acceptance.test.ts
```

Also included in `pnpm test:integration`.

| Fixture | File | Proves |
| --- | --- | --- |
| Milk frother / Zulay | `tests/fixtures/jungle-scout/product-database-milk-frother.json` | Parent-family dedupe; `observed_sample_sales=200368`; `estimated_market_sales` null |
| Sink literal zero | `tests/fixtures/jungle-scout/product-database-sink-zero.json` | Empty page yields zero families and zero sample sales |
| Expanded sink 329 | `tests/fixtures/jungle-scout/product-database-sink-expanded-meta.json` plus top page `product-database-sink.json` | Metadata result_count 329; top page relevance, seller_type, dimensions |
| Batter dispenser / OF | `tests/fixtures/opportunity-finder/page-1.csv` keyword `pancake dispenser bottle` with `product-database-batter-dispenser.json` | Relevant ASIN kept; kitchen rug noise excluded |
| Budget cache | same sink top page | Second Market Probe uses `api_cache`; one `api_usage` row |
| Exhausted budget | dailyLimit 3 / reserve 1 | Candidate waits at `Waiting for API Budget` with zero HTTP |
