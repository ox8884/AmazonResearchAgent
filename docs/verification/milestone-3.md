# Milestone 3 verification

Recorded fixtures (no live Jungle Scout calls):

- Milk frother parent-family dedupe: `packages/research-engine/src/product-family.test.ts` Zulay variant fixture (`observedMonthlyUnits = 200368`, 5 variants, `VARIANT_SALES_DUPLICATED`).
- `sink drip tray` literal 0-result: `tests/fixtures/jungle-scout/product-database-sink-zero.json`.
- Expanded sink phrase metadata (329 results): `tests/fixtures/jungle-scout/product-database-sink-expanded-meta.json` plus top-page `product-database-sink.json`.
- Opportunity Finder batter-dispenser cluster: `tests/fixtures/opportunity-finder/page-1.csv` / `page-2.csv`.

Budget: `packages/api-budget` and `packages/db/src/api-budget.integration.test.ts` preserve reserve and authorize one of concurrent final slots.

Observed vs estimated: Market Probe snapshots set `observed_sample_sales` from Product Database families and leave `estimated_market_sales` null unless a separate estimation endpoint supplied it.
