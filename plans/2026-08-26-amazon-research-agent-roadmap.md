# Amazon Research Agent Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each linked plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the personal-use Amazon Research MVP in four independently testable milestones, then validate supplier automation as a separate post-MVP project.

**Architecture:** A pnpm monorepo contains a Next.js dashboard deployed to Vercel, a long-running Node.js worker on Oracle Cloud ARM64, shared TypeScript packages, and Supabase PostgreSQL as the durable source of truth. Discovery starts with low-cost Opportunity Finder CSV imports and AI normalization; Jungle Scout API calls are budgeted for validation only. The worker owns long-running jobs, API access, AI provider execution, and Telegram delivery.

**Tech Stack:** Node.js 24.20.0 LTS, pnpm 11.24.0, TypeScript 6.0.3, Next.js 16.3.3, Supabase JS 2.112.2, PostgreSQL/Supabase migrations, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1 for web E2E, systemd on Ubuntu 24.04 ARM64.

**Spec:** `docs/superpowers/specs/2026-08-26-amazon-research-agent-design.md`

## Global Constraints

- Personal-use MVP; do not add multi-user SaaS, billing, payment execution, or automatic sample purchasing.
- Target category: Kitchen & Dining.
- Target retail price: $15-$80.
- Priority order: Competition, Demand, Margin, Differentiation.
- Initial Opportunity Score weights: Competition 40%, Demand 30%, Margin 20%, Differentiation 10%; hard filters override the score.
- Avoid fragile glass/ceramic, liquids, electric products, batteries, hazardous goods, certification-heavy products, big/heavy products, and markets dominated by Amazon retail or one giant brand.
- Food-contact products are allowed but receive a risk flag / score penalty.
- Preferred initial inventory investment: $2,000-$2,500; hard ceiling $3,000; reserve 10-15% for duty, inspection, contingency.
- Daily automatic research runs at 3:00 AM America/Chicago; manual Research Now is available any time.
- Discovery should be cheap; Jungle Scout API calls are primarily for validation.
- Pay-as-you-go AI fallback is OFF by default.
- UI language: Korean by default with an English toggle. AI summaries and Telegram digests follow the selected language. Jungle Scout/ASIN/FBA/MOQ and similar industry terms remain untranslated where natural. Raw CSV text and Amazon product titles remain in source language.
- Worker target: Oracle Cloud Ubuntu 24.04 ARM64/aarch64, 4 OCPU, 24 GB RAM; initial AI concurrency 2-3, browser concurrency 1-2; add 4-8 GB swap during deployment.
- Never store API keys in browser-visible plaintext; secrets must be encrypted or isolated server-side, masked in UI, and redacted from logs.
- Every automated decision must be auditable: rule reasons, AI classification, provider/model, timestamps, score changes, state transitions, API calls/cache hits, notifications.

---

## Delivery Order

### Milestone 1 - Research Foundation: CSV -> deterministic candidates

Plan: `docs/superpowers/plans/2026-08-26-01-research-foundation.md`

Working deliverable:
- Monorepo boots locally.
- Supabase schema and durable job queue exist.
- One or more Opportunity Finder CSV files can be uploaded.
- Imports merge page exports, preserve raw rows, deduplicate exact keywords, apply zero-API rules, compute a preliminary deterministic score, and persist audit reasons.
- Dashboard shows import summary and candidates in Korean/English.
- No Jungle Scout API or paid AI is required to complete this milestone.

Exit gate:
- A 300-row sample import completes idempotently.
- Re-running the same upload does not duplicate raw rows or jobs.
- Every rejected row has a visible reason.

### Milestone 2 - AI Normalization and Routing: keywords -> niche clusters

Plan: `docs/superpowers/plans/2026-08-26-02-ai-normalization-router.md`

Working deliverable:
- Custom OpenAI-compatible provider works first.
- Command-provider adapter supports subscription CLIs through configurable executable/argument profiles and is verified on Oracle ARM64 before activation.
- Keywords are classified as product niche / brand-IP / broad query / typo-variant / irrelevant / ambiguous.
- Misspellings, synonyms, plurals, alternate-language phrases, and equivalent product terms cluster into durable Niche Clusters.
- Router records provider/model/usage and produces catalog phrase expansions for later Product Database validation.

Exit gate:
- A known fixture clusters `pancake dispenser bottle`, `batter squeeze bottle`, and `batter mixer and dispenser` into one niche.
- A known brand/IP fixture is rejected before Jungle Scout API usage.
- Provider outage transitions the work item to `Waiting for AI Capacity` instead of silently switching to paid fallback.

### Milestone 3 - Jungle Scout Validation Engine: clusters -> market decisions

Plan: `docs/superpowers/plans/2026-08-26-03-jungle-scout-validation.md`

Working deliverable:
- Daily API budget + reserve + cache are enforced.
- `Waiting for API Budget` candidates resume on the next eligible run.
- Product Database Market Probe uses expanded catalog phrases, retrieves up to 100 products, filters semantic noise, deduplicates parent ASINs, detects data-quality warnings, clusters micro-niches, and segments price bands.
- Competition/demand/margin/differentiation evidence is persisted separately from observed sample metrics.
- Watch / Reject / Strong-potential decisions are auditable; Strong requires all configured gates and cross-validation evidence.

Exit gate:
- The Phase 0 `sink drip tray` fixture demonstrates: literal 0-result phrase -> expanded phrase coverage -> parent dedupe -> relevant micro-niches -> price segments without double-counting variant sales.
- API cache prevents a duplicate Product Database call for a fresh niche.
- Exhausted API budget defers work without losing it.

### Milestone 4 - Production Automation, Dashboard, Telegram, Deployment

Plan: `docs/superpowers/plans/2026-08-26-04-automation-dashboard-deployment.md`

Working deliverable:
- Daily 3:00 AM America/Chicago run with 60/30/10 exploration allocation.
- Manual Research Now.
- Dashboard: overview, imports, candidates, candidate detail, runs, API/AI usage, provider settings, research criteria.
- Korean default / English toggle across UI and generated summaries.
- Telegram daily digest and meaningful event alerts only.
- Oracle worker runs under systemd and survives restarts; Vercel serves the dashboard; Supabase is the persistent state.
- Checkpoint/resume prevents duplicated Jungle Scout calls or AI work after crashes.

Exit gate:
- With the user's PC turned off, a scheduled run enqueues, executes on Oracle, persists results, and sends the Telegram digest.
- Restarting the worker mid-run resumes from the last checkpoint.
- Vercel never executes long-running research work inside request lifetimes.

---

## Post-MVP Gate - Supplier Automation

Do not begin automatic Alibaba messaging in the Research MVP implementation. After Milestone 4 is stable, run a separate design/validation cycle for:

`Strong -> supplier discovery -> inquiry -> response -> AI parsing -> targeted follow-up -> price/MOQ update -> supplier-verified economics`

Required safety boundary:
- Prefer official/permitted supplier channels.
- Login/CAPTCHA/2FA becomes `Needs Attention`; never bypass.
- Inquiry/follow-up/negotiation may be automated within truthful user limits.
- Sample order, PO, contract, and payment always require explicit user approval.

## Version Lock Notes

- Next.js 16.3.3 is selected because it is the Active LTS security-patched release published 2026-08-25.
- Node.js 24.20.0 is selected as the current LTS line rather than Node 26 Current.
- TypeScript 6.0.3, Supabase JS 2.112.2, and Zod 4.4.3 are pinned for reproducible implementation.
- Before implementation starts, run `pnpm install --frozen-lockfile` after the first lockfile commit; dependency upgrades require their own reviewed change rather than silent drift.
