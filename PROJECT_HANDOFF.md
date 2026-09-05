# Amazon Research Agent — project handoff (2026-09-01)

> **Current production authority — 2026-09-05 UTC**
>
> Web remains on Cloudflare Workers. The production queue worker runs ONLY on
> Oracle `hermes-server`, via enabled `amazon-research-worker.service`.
> `/opt/amazon-research/current` points to release
> `61f19e957563686376bcb883d1408ef4812b8e43`. The previous Oracle release was
> already running; launching a Windows production worker was a deployment
> discovery mistake. That Windows process tree is now stopped.
> Do not launch `pnpm worker:production` on Windows alongside Oracle.
> The enabled daily timer runs at 03:00 America/Chicago; host timezone is unchanged.
> Process-loss automatic recovery was tested, and live DB queue polling resumed.
> Production migrations are current through `20260905024826` (32 total).
> Subscription OAuth remains deferred. See
> [Oracle verification](review-logs/2026-09-05-oracle-worker-production-correction.md).
> This update supersedes conflicting Windows-worker statements below.

> **Authoritative release update — 2026-09-03**
>
> - Current source is the repository root on `main`; the Cloudflare release
>   implementation starts at `e3524f8811f5` and later commits add its handoff
>   and production-worker launcher.
> - Custom API Tasks 16C, 17C, and 18C are complete. The original Codex/Grok
>   subscription OAuth track remains deferred until provider authorization.
> - Next.js web is live on Cloudflare Workers at
>   `https://amazon-research-agent.hyj5317.workers.dev`.
> - Remote Supabase migrations are current through
>   `20260903203236_authorize_initial_openrouter_zai_payg_primary.sql`.
> - Local web and queue worker start together with
>   `start-amazon-research-agent.cmd` or `pnpm dev:local`.
> - Cloudflare-created remote jobs are consumed by the Windows production
>   worker via `pnpm worker:production`; run
>   `pnpm worker:production:check` first. Do not confuse it with the local-DB
>   development worker.
> - The local database contains three real enabled providers: OpenRouter API,
>   Opencode-Go, and CommanderCode(GOAT). Test-only providers and the 18
>   shared-integration fixture candidates/jobs created during release QA were
>   removed without resetting user data.
> - Provider rows and encrypted keys were deliberately not copied to the remote
>   database. Register desired providers once in the deployed AI Settings UI.
> - Existing local edits to `apps/web/next-env.d.ts` and `프롬프트.md`, plus
>   untracked reports/session material, remain user-owned and uncommitted.
>
> Status statements below predate this release update. Use them only as
> historical rationale when they conflict with this block.

## Start here

This is the current project-level handoff. Read it before touching code, then
read the source-of-truth artifacts listed below.

Primary active source:

```text
C:\Users\hyj53\Documents\amazon research agent
```

Release commit:

```text
e3524f8811f5
```

The active worktree is intentionally dirty: 28 modified tracked files and
three untracked files at the last verified handoff. Preserve all changes. Do
not reset, clean, rebase, broadly format, or commit unless Jay explicitly asks.
`apps/web/next-env.d.ts` is an existing user change and must not be overwritten.

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| Web/admin UI | `apps/web` | Korean/English dashboard, candidates, AI Settings, provider configuration and test-result UI. |
| Worker | `apps/worker` | Typed queue processing, provider catalog, normalization execution, provider probes, fail-closed controls. |
| Router | `packages/ai-router` | Eligible provider/model selection and PAYG-fallback policy. |
| Shared/db/queue | `packages/shared`, `packages/db`, `packages/queue` | Schemas, database types, queue claims, provider-attempt invariants. |
| Database | `supabase/migrations` | Durable queue/attempt/finalization authority; migrations are append-only. |

Core design: `DESIGN.md`.
Subscription supplement:
`docs/superpowers/specs/2026-08-29-subscription-ai-providers-design.md`.

## Current status

### Original subscription roadmap

| Work | Status | Boundary |
| --- | --- | --- |
| Tasks 1–14 | Local implementation/validation complete | Task 14 is disabled sandbox/fixture acceptance only; no provider activation or Oracle production approval. |
| Task 15 terms/support gate | A, fail-closed | Codex and Grok remain disabled and unroutable. |
| Task 16 Codex Oracle | Deferred | Needs explicit first-party provider authorization and supported operator OAuth/service-identity evidence. |
| Task 17 Grok Oracle | Deferred | Same boundary for Grok. |
| Task 18 subscription recovery | Blocked | Needs an original adapter pass, activation, fresh Ready, and controlled recovery prerequisites. |

Custom API keys do **not** pass or replace original subscription Tasks 16–18.
Do not activate subscription adapters, OAuth, Oracle services, or browser
credentials without explicit new approval.

### Separate OpenAI-compatible Custom API track

| Work | Status | Next condition |
| --- | --- | --- |
| Task 16C provider acceptance | **A approved** | Final independent review: `CRITICAL 0 / IMPORTANT 0`. |
| Task 17C eligible normalization | Blocked | A real current `AI Screening` candidate and matching queued normalization job, then action-time approval for one paid provider-attributed attempt. Never manufacture data. |
| Task 18C natural recovery | Blocked by Task 17C | Requires the real Task 17C attempt/finalization record; must prove no duplicate paid work. |

Last read-only queue evidence found zero eligible `AI Screening` candidates and
zero matching queued normalization jobs; two queued normalization jobs were
stale. This is historical, so recheck read-only before any Task 17C decision.

## Approved Custom API boundary

- Browser keys are write-only; UI receives only `secretLast4`.
- Server encrypts supplied nonblank keys. Never print, log, search, or
  rehydrate credentials.
- Public provider URLs are HTTPS-only and destination-pinned per request;
  private, loopback, metadata, and blocked targets are rejected.
- For configured OpenRouter `z-ai`, requests include
  `provider.only: ['z-ai']` and `allow_fallbacks: false`. Do not silently use
  Parasail or another host.
- Generic `allowPaidFallback` remains false.
- PAYG execution is allowed only for the typed, initial configured OpenRouter
  `z-ai` `openai_http` target. Arbitrary PAYG, false authority, non-Z.ai,
  same-process retry, and durable pre-spawn restart retry are blocked.
- Subscription adapters remain unavailable without explicit activation.

Authority path:

```text
NormalizationExecutionCoordinator
  -> typed initialPaidPrimary authorization
  -> apps/worker/src/main.ts
  -> resolvePersistedNormalizationTarget
  -> OpenAI-compatible HTTP adapter
```

Important implementation files:

- `apps/worker/src/providers/normalization-execution-coordinator.ts`
- `apps/worker/src/providers/provider-catalog.ts`
- `apps/worker/src/main.ts`
- `packages/ai-router/src/router.ts`
- `packages/ai-router/src/providers/openai-http.ts`
- `apps/worker/src/providers/provider-url-policy.ts`
- `apps/web/app/api/ai-providers/route.ts`
- `apps/web/components/ai-provider-form.tsx`

## Latest verification

Final independent rereview ran, without a provider call:

```text
pnpm --filter @ara/worker exec vitest run src/providers/normalization-execution-coordinator.test.ts src/providers/provider-catalog.test.ts
# 17 passed

pnpm --filter @ara/ai-router exec vitest run src/router.test.ts
# 11 passed

pnpm --filter @ara/worker typecheck
# passed

pnpm --filter @ara/web typecheck
# passed

git diff --check
# passed; existing CRLF conversion warnings only
```

Limits: `SUPABASE_SERVICE_ROLE_KEY` was absent from that process, so isolated
worker integration did not run. Port 3001 was intentionally not replaced, so
final browser E2E did not run. Do not bypass either limitation by inspecting
secrets or stopping another server.

## Canonical artifacts

Read in this order for provider work:

1. `docs/verification/openai-compatible-api-acceptance.md`
2. `docs/verification/subscription-provider-terms.md`
3. `docs/superpowers/specs/2026-08-29-subscription-ai-providers-design.md`
4. `docs/superpowers/plans/2026-08-29-subscription-ai-providers-implementation.md`
5. `review-logs/2026-09-01-terra-custom-api-task16-final-fresh-independent-rereview.md`
6. `review-logs/2026-09-01-terra-custom-api-task16-acceptance.md`

The two historical authority corrections are documented in:

- `review-logs/2026-09-01-terra-custom-api-task16-payg-target-authority-fresh-independent-rereview.md`
- `review-logs/2026-09-01-terra-custom-api-task16-payg-restart-authority-correction.md`

## Frontend redesign backlog — not started

Jay dislikes the current overall frontend design. No redesign has begun; the
current UI/functionality is the baseline to preserve.

Safe separate design task:

1. Read `DESIGN.md`, inspect current routes/components, and capture a baseline
   screenshot without changing provider setup.
2. Define one coherent visual system for navigation, dashboard, candidates,
   execution/import views, and AI Settings; avoid page-by-page patchwork.
3. Prioritize provider-settings usability: saved provider list, edit/selection,
   model/billing/role status, connection result, and cost warnings must scan
   clearly. Never expose a key or response body.
4. Preserve API contracts, i18n, role/billing semantics, router policy, queue
   behavior, and all security boundaries.
5. Validate with targeted web tests/typecheck and real visual QA. Do not stop a
   running server to obtain a port.

Likely frontend ownership: `apps/web/app/*`, `apps/web/components/*`, and
`apps/web/app/globals.css`.

## Next-agent checklist

- Run `git status --short` before editing and preserve the dirty worktree.
- State exact scope/non-goals before implementation.
- Never read/print credentials or `.env` files; never use paid provider calls
  without action-time approval; never create data to force a gate.
- Keep original subscription work separate from the Custom API track.
- Save reports in `review-logs/` and reusable prompts in `session-prompts/`.
- For design work, validate real UI behavior and preserve secret masking,
  billing/role semantics, and API behavior.
