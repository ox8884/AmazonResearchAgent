# Amazon Research Agent — MVP Design Spec

Date: 2026-08-26
Status: Design approved in conversation; implementation not started

## 1. Goal

Build a personal-use cloud app that continuously discovers, validates, and tracks Amazon FBA product opportunities in Kitchen & Dining, while minimizing Jungle Scout API usage and leveraging existing AI subscriptions where possible.

The MVP must be useful before supplier automation is complete. The first production-worthy milestone is a reliable research engine that can ingest Jungle Scout Opportunity Finder CSV exports, discover niches, validate them with Jungle Scout API data, score candidates, persist history, and surface Watch/Strong candidates in a dashboard with Telegram notifications.

## 2. Product Scope

### In scope for MVP
- Kitchen & Dining research only
- Jungle Scout Opportunity Finder CSV import
- Jungle Scout API integration
- Automated free/cheap pre-filtering
- Keyword normalization and niche clustering
- Product phrase expansion
- Product Database validation
- Parent-ASIN deduplication
- Micro-niche clustering and price segmentation
- Competition, demand, margin, and differentiation scoring
- Watch / Strong / Reject lifecycle
- Historical snapshots and re-evaluation
- API budget manager with deferred queue
- Daily automatic research at 3:00 AM America/Chicago
- Manual Research Now
- Multi-provider AI routing
- Telegram digest / important-event alerts
- Personal dashboard

### Explicitly deferred
- Multi-user SaaS features
- Billing / subscriptions for end users
- Automatic sample purchasing
- PO / contract signing
- Payment execution
- Fully autonomous Alibaba messaging until channel stability and policy constraints are validated

## 3. Product Constraints

### Target category
Kitchen & Dining

### Price
$15–$80 target retail price.

### Priority order
1. Competition
2. Demand
3. Margin
4. Differentiation

Initial Opportunity Score weighting:
- Competition: 40%
- Demand: 30%
- Margin: 20%
- Differentiation: 10%

Hard filters override the numeric score.

### Product preferences
Prefer:
- Small/light standard-size products
- Evergreen demand
- Existing products with light customization opportunities
- Color, size, thickness, bundle, packaging, usability improvements

Avoid:
- Fragile glass / ceramic
- Liquids
- Electric products
- Batteries
- Hazardous goods
- Certification-heavy products
- Big/heavy products
- Markets dominated by Amazon retail or one giant brand

Food-contact products are allowed but receive a risk flag / score penalty.

### Initial inventory economics
- Preferred initial investment: $2,000–$2,500
- Hard ceiling: $3,000
- Reserve 10–15% for duty, inspection, and contingency
- MOQ <= 500 preferred
- MOQ 500–1000 = Watch
- MOQ > 1000 = strong penalty unless total order still fits the $3,000 cap

### Margin targets
Strong:
- Pre-ad contribution margin >= 30%
- Estimated post-ad net margin >= 20%

Watch:
- Pre-ad margin 20–30%
- Estimated post-ad net margin 10–20%

Reject:
- Below those ranges unless competition/demand provide a compelling exception

## 4. Core Research Principle

> Discovery should be cheap. API calls should be used primarily for validation.

Do not use Jungle Scout API calls to blindly search the entire market when CSV data, cached data, code rules, and AI normalization can narrow the candidate set first.

## 5. Opportunity Finder CSV Import Pipeline

### Input
One or more Jungle Scout Opportunity Finder CSV exports.

### Import behavior
- Merge multiple page exports into one Import Run
- Preserve raw rows unchanged
- Deduplicate exact duplicate keywords
- Store source file name, imported_at, and import_run_id

### Zero-API filtering
Apply deterministic filters before any Jungle Scout API call:
- Price outside $15–$80
- High / Very High seasonality unless explicitly allowed
- Clear electric / battery terms
- Clearly irrelevant Home & Kitchen subdomains
- obvious brand / franchise / IP terms
- clearly broad shopping-intent phrases that are not product niches
- obviously unsuitable products (fragile, heavy, etc.) when inferable

### AI normalization
Use a low-cost AI route to classify surviving keywords into:
- product niche
- brand/IP query
- broad shopping query
- typo / variant
- irrelevant
- ambiguous

Normalize:
- misspellings
- plural/singular variants
- alternate language variants
- synonyms
- equivalent product phrases

### Niche clustering
Multiple raw keywords may map to one niche cluster.

Example:
- pancake dispenser bottle
- batter squeeze bottle
- batter mixer and dispenser

=> Batter / Pancake Dispenser

### Preliminary score
Use only CSV data plus deterministic/AI classification:
- Jungle Scout Niche Score
- monthly average units
- average price
- search volume
- 30/90-day trend
- competition
- seasonality
- product-fit/risk flags

This score determines whether a niche is worth spending API budget on.

## 6. API Budget Manager

### Core rule
API calls are budgeted daily and prioritized by expected information value.

### Candidate states
- Ready for API Validation
- Waiting for API Budget
- API Validation Running
- Validated

### Budget behavior
If daily budget is exhausted:
- Keep the candidate
- Set state to Waiting for API Budget
- Automatically resume on the next eligible run

### Caching
Track freshness independently per endpoint / niche:
- last_product_db_checked_at
- last_keyword_checked_at
- last_historical_checked_at
- last_sales_estimate_checked_at

If data is still fresh, reuse cached results instead of spending another API call.

### Reserved budget
Always preserve a configurable reserve for:
- manual Research Now
- Strong candidate re-validation
- important supplier/economics re-checks later

## 7. API Validation Pipeline

### Level 1 — Market Probe
Spend approximately 1 Product Database call per top niche.

Retrieve up to 100 products.

Then locally:
- semantic relevance filter
- parent-ASIN dedupe
- product-family grouping
- Amazon presence detection
- brand concentration
- sales distribution
- review distribution
- price distribution
- listing age distribution
- product size / weight
- FBA/FBM structure

### Parent/variant rule
Treat Product Database sales as product-family / parent-level demand where appropriate.
Never sum duplicated variant-level sales blindly.

### Product phrase expansion
A Keyword API search term may not map directly to Product Database `include_keywords`.

Pipeline:
Raw keyword -> normalized niche -> likely catalog phrases -> Product Database OR-query

Example discovered during Phase 0:
- sink drip tray -> 0 Product Database results
- expanded phrases such as faucet mat / sink splash guard / silicone sink mat -> 329 products

### Level 2 — Validation
Only niches that survive Level 1 receive additional endpoint calls such as:
- keyword metrics
- historical search volume
- sales estimates
- other relevant validation endpoints

### Level 3 — Deep Research
Only Strong-potential niches receive the most expensive/frequent validation.

## 8. Micro-Niche and Price-Segment Analysis

Never assume one discovered phrase maps to one homogeneous market.

Example from Phase 0:
A sink-related opportunity contained:
- silicone faucet mats
- diatomite/stone drying trays
- acrylic splash guards

These must be analyzed separately.

Then segment by price where needed.

Example:
- cheap silicone faucet mats around $5–$10
- premium silicone faucet mats around $20–$30+

The premium and commodity segments can have completely different economics.

## 9. Data Quality Rules

Flag suspicious data rather than silently trusting it.

Examples:
- missing price
- missing weight
- missing rating/reviews
- revenue / units inconsistent with listing price
- duplicate parent-family sales across variants
- stale updated_at

Candidate analysis should expose a Data Quality Warning when confidence is reduced.

## 10. Competition Analysis

Signals include:
- Top 10 average reviews
- median reviews
- share of top products with >1,000 reviews
- brand concentration
- sales concentration
- Amazon retail presence
- sponsored density if available
- price compression
- identical commodity listings
- newer low-review sellers achieving meaningful sales

Initial review guide:
- <= 500 Top-10 average reviews: favorable
- 500–1500: Watch
- >1500: strong penalty

Do not use a single threshold as the sole decision criterion.

## 11. Demand Analysis

Evaluate:
- observed sample sales
- estimated market sales when available
- sales distribution across product families
- concentration in top 1 / top 3 products
- keyword search demand
- recent trends
- historical consistency

Keep `observed_sample_sales` separate from `estimated_market_sales`.

Do not represent a top-100 sample sum as the full market size.

## 12. Margin Analysis

Separate:
- estimated sourcing economics
- supplier-verified economics

Estimated landed cost should include:
- unit cost
- packaging
- international freight
- duty if applicable
- inspection / contingency
- Amazon referral fee
- FBA fee
- inbound fees
- expected ad spend

When supplier quotes arrive, mark economics as Supplier Verified and recompute all margin fields.

## 13. Differentiation Analysis

Deep Research should mine review complaints and identify recurring actionable issues such as:
- durability
- cleaning difficulty
- size / fit
- storage
- odor / material
- packaging
- missing parts
- usability

Ignore non-product complaints such as carrier delays.

## 14. Candidate Lifecycle

Primary state machine:

Discovered
-> Rule Filter
-> AI Screening
-> Deep Research
-> Strong / Watch / Reject
-> Sourcing
-> Negotiating
-> Sample Ready

Exception states:
- Needs Review
- Waiting for AI Capacity
- Waiting for API Budget
- Needs Attention

Post-MVP / human-gated:
Sample Ready
-> User Approval
-> Sample Ordered
-> Sample Received
-> User Evaluation
-> Go / No-Go

Reject and Watch states remain in the database with reasons and snapshots.

## 15. Historical Re-Evaluation

Never delete rejected niches purely because they were rejected.

Store:
- decision reason
- market snapshot
- score history
- data-source version / timestamps

Previously rejected niches may be reactivated if:
- competition falls
- price increases
- sales disperse more evenly
- new low-review entrants succeed
- supplier economics improve

## 16. AI Provider Router

### Providers
Support existing subscription-based routes where operationally possible:
- Codex via ChatGPT subscription login
- Claude Code via Pro/Max
- Grok Build via subscription/login

Also support Custom OpenAI-compatible providers:
- provider name
- billing type
- base URL
- API key
- model discovery (`/v1/models` when available)
- manual model ID fallback

### Roles
- bulk first-pass classification
- niche normalization / clustering
- deep market analysis
- Strong cross-validation
- review mining
- supplier negotiation
- Daily Digest

### Routing order
1. capability
2. configured role priority
3. availability / rate limits
4. cost policy

Modes:
- Saver
- Balanced (default)
- Highest Quality

Pay-as-you-go automatic fallback is OFF by default.

If subscribed providers are unavailable:
- set Waiting for AI Capacity
- resume later
- optional explicit user approval for a paid one-off route

### Cross-validation
Strong candidates should be independently reviewed by a different provider where possible.
Major disagreement => third model or Needs Review.

## 17. Architecture

### Web / Dashboard
Vercel

Responsibilities:
- UI
- CSV upload
- configuration
- enqueue work
- display results

Do not run long research jobs inside Vercel request lifetimes.

### Database
Supabase PostgreSQL

Responsibilities:
- persistent research state
- queue metadata
- snapshots
- audit logs
- AI usage
- candidate history
- supplier data later

### Worker
Oracle Cloud Ubuntu ARM64 instance

Known target host:
- 4 OCPU
- 24 GB RAM
- ARM64 / aarch64
- Ubuntu 24.04

Responsibilities:
- scheduled research
- long-running jobs
- Jungle Scout API access
- AI provider execution
- browser automation where permitted
- Telegram delivery

Initial concurrency target:
- AI jobs: 2–3
- browser jobs: 1–2

Add 4–8 GB swap as a safety margin during infrastructure setup.

## 18. Suggested Monorepo Structure

```text
apps/
  web/                # Vercel dashboard
  worker/             # Oracle worker

packages/
  db/                 # Supabase schema + typed access
  research-engine/    # filters, scoring, clustering, lifecycle
  jungle-scout/       # API adapter + CSV parser
  ai-router/          # provider routing + structured output
  queue/              # jobs/checkpoints/retry policy
  notifications/      # Telegram
  shared/             # shared schemas/types/config
```

Final structure may change during implementation planning if framework/tooling constraints justify it.

## 19. Core Data Entities

- Niche
- Raw Opportunity Keyword
- Niche Cluster
- Product / ASIN
- Product Family / Parent ASIN
- Candidate
- Research Run
- Import Run
- Market Snapshot
- AI Analysis
- Score History
- Risk
- Decision History
- API Usage
- AI Usage
- Notification

Future sourcing entities:
- Supplier
- Supplier Conversation
- Quote History
- Negotiation Event

## 20. Auditability

Every automated decision should be explainable.

Store:
- rule-filter reasons
- AI classification output
- provider/model used
- input data timestamp
- score changes
- state transitions
- API calls and cache hits
- notification events

## 21. Scheduling

Daily automatic run:
- 3:00 AM America/Chicago

Exploration allocation:
- 60% new niches
- 30% Watch re-validation
- 10% Strong tracking

Manual Research Now:
- available any time
- respects reserve/budget policy unless explicitly overridden

## 22. Telegram

Notify only meaningful events:
- new Strong candidate
- Watch -> Strong promotion
- supplier target reached later
- sample approval required later
- major status change
- Needs Attention
- daily summary

Do not notify for every trivial reply or internal step.

## 23. Security

- Never store API keys in browser-visible plaintext
- Encrypt or isolate secrets on worker/server side
- Mask secrets in UI
- Redact keys/tokens from logs
- Isolate provider auth sessions
- Worker must not have payment authority

## 24. Phase 0 Findings Already Validated

The following were confirmed through hands-on testing:

1. Jungle Scout API authentication works from PowerShell.
2. Product Database returns useful fields including price, reviews, category, rating, brand, product rank, dimensions, weight, seller data, 30-day revenue, 30-day sales, fees, and listing date.
3. Home & Kitchen parent-category search is too broad for Kitchen & Dining and requires downstream filtering/normalization.
4. Parent/variant dedupe is mandatory.
5. Keyword API and Product Database catalog matching are not interchangeable.
6. Product phrase expansion can convert a zero-result niche phrase into meaningful Product Database coverage.
7. Semantic relevance filtering is required after phrase expansion.
8. Micro-niche clustering is required.
9. Price segmentation is required.
10. Opportunity Finder Niche Score alone is insufficient.
11. Opportunity Finder Exclude Top Brands does not replace a brand/IP risk classifier.
12. Opportunity Finder CSV imports are useful as a low-cost candidate-generation layer.
13. API calls should be reserved for high-value validation rather than broad discovery.
14. Missing/inconsistent fields require explicit data-quality handling.

## 25. MVP Success Criteria

Research MVP is successful when the system can, without manual intervention:

Opportunity Finder CSV / scheduled discovery
-> free filtering
-> AI normalization and clustering
-> preliminary score
-> API-budgeted Product Database validation
-> parent dedupe
-> micro-niche segmentation
-> market score
-> Watch / Strong / Reject
-> Supabase persistence
-> dashboard display
-> Telegram summary

The system must resume from checkpoints without duplicating Jungle Scout API calls or AI work after failures.

## 26. Full Phase 0 Success Extension

After the Research MVP is stable, validate:

Strong
-> supplier discovery
-> inquiry
-> response
-> AI parsing
-> targeted follow-up
-> price/MOQ update
-> supplier-verified economics

Supplier messaging must use official/permitted channels. Login, CAPTCHA, and 2FA barriers should produce `Needs Attention`; the worker must never bypass them.

## 27. Implementation Gate

No product implementation should begin until this design spec is reviewed and accepted.

After approval, create a detailed implementation plan covering:
- exact framework versions
- Supabase schema and migrations
- queue implementation
- worker process layout
- Jungle Scout adapters
- CSV parser
- AI provider headless invocation tests
- secret storage
- API budget algorithm
- Telegram integration
- test strategy
- Oracle deployment
- Vercel deployment
- rollback/checkpoint behavior
