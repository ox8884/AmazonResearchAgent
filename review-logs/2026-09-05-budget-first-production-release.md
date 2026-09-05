# Budget-first production release

## Deployed

- Application commit: `56a05a19b6e305a8cb85399d6b9d453ccb85e74b`; pushed to GitHub `main` without force.
- Cloudflare: version `741fb49e-7dd3-4de8-bf4f-a3ee9dddddbb`, active100%, deployed2026-09-05T16:47:04Z. Tag `budget-first-56a05a1`, message includes full application SHA.
- URL: https://amazon-research-agent.hyj5317.workers.dev/ko/settings
- Oracle current/DEPLOYED_HEAD and process cwd identify the same application commit. Service enabled/active/running, PID876041, NRestarts0 at verification. Fixed normalization capability `13b51161a28f3fbef7a193f13c4fe8bb35c0f21f` preserved.
- Existing daily timer remains active, next2026-09-06 04:00EDT =03:00America/Chicago. Host timezone and credentials unchanged.
- Only approved additive migration `20260905060412_add_research_business_settings.sql` applied. Follow-up dry-run reports up-to-date. Persisted criteria verified: budget3000USD, pre-ad35%, post-ad35%, ROI150%; administrator can change all four.

## Verification

- Canonical source archive SHA256 `e1759f9e676c2b11c7f7b5cedc0bf785cd2c2759171bff9d30ea2a93b9dc5e9d` matched Oracle transfer. Frozen Node24.20.0/pnpm11.24.0 installs passed.
- Full suite835package tests plus2launcher tests passed;5Windows platform skips. Linux worker181tests passed. Whole-workspace typecheck/lint11of11 passed.
- Business browser7passed/2intentional historical-capture skips; remaining AI-settings/dashboard/imports/research-now14passed. Owned fixture after interruption was rebuilt before rerun.
- Fresh27PNGs at375/768/1280 passed signature/hash/source checks and independent visual A/B reviews. Evidence: `evidence/2026-09-05-budget-first-workflow/visual-fix-round-3/manifest.json`.
- Independent final datetime SPEC/QUALITY review passed. It covers explicit UTC parsing and exact preservation of untouched source periods/quote expiries.
- Linux OpenNext build passed;3478generated files plus2build metadata files matched native SHA256. Native dry-run and actual deploy passed; native CLI warned about Windows compatibility, while the deployed bundle was built on Linux.
- Oracle itself passed10package typechecks and32startup/policy tests. Production polling counters increased from291963/22364 to292170/22571 (claim/terminalize). Queue before release:34completed,2previouslyfailed,0queued/running. No synthetic paid jobs inserted.
- Cloudflare's five existing secret bindings remained present by name/type; values were never copied into evidence. Private public-schema/data backup completed with user-only ACL. Existing circular-FK warning remains; no full restore rehearsal claimed.

## Scope and remaining confirmation

- No paid provider/Jungle Scout QA, supplier message, purchase, OAuth activation or Windows production worker was started.
- Live Jungle Scout web search/export control was observed earlier, but actual CSV file transfer remains unverified; fixture CSV acceptance is separate.
- In-app browser restarted during interruption; its prior authenticated session was unavailable. The deployed site visibly redirects unauthenticated access to login. The user was asked to sign in for an authenticated live-page check; no production password/cookie was extracted or fabricated.
- User explicitly deferred the post-deployment whole-code review. Three just-started review lanes were interrupted; no post-deployment whole-review PASS is claimed.
- Root user dirty files were preserved. Static historical captures and local build/review exports remain local and excluded from the deployed commit. The controller stopped the resumed QA fixture through its owned control endpoint; the earlier interrupted run's disposable DB/container were removed using run-ID guards.
- Previous Oracle release and Cloudflare version238fc38c-5849-4439-8926-e39a6839ab15 remain available. Do not roll back to the old worker with new criteria-governed jobs pending; hold/drain or fix forward. Additive migration is retained.
