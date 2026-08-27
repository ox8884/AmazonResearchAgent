# Milestone 3 verification

Recorded-shaped fixtures and local Supabase integration cover Jungle Scout validation without live API calls.

- Product Database sink fixture: `tests/fixtures/jungle-scout/product-database-sink.json`
- Cache identity: phrase-order independent `makeApiCacheKey`
- Budget: normal research cannot consume reserve; manual research can
- Market probe: one real fixture query, second run is cache_hit
- Parent/variant: identical parent-level units are not summed
- Sample vs market: `observed_sample_sales` populated, `estimated_market_sales` null unless a separate estimate exists
- Level 2: Reject candidates spend zero keyword calls
- Economics: allowable landed cost is an assumption, not a supplier quote

No real Jungle Scout HTTP calls are made in `pnpm test` or `pnpm test:integration`.
