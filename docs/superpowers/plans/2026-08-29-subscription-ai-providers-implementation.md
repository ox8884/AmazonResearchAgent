# Subscription AI Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement production-safe OpenAI Codex Subscription and Grok Subscription provider architecture alongside the existing OpenAI-compatible HTTP provider, while preserving fail-closed routing, no automatic PAYG fallback, crash-safe execution evidence, and Plan 04 normalization recovery.

**Architecture:** Extend the existing AI provider/router system with the approved `subscription_command` execution family and dedicated Codex/Grok adapters. Subscription adapters remain unroutable until worker-owned authorization, capability, credential-source, readiness, and containment evidence passes; HTTP provider behavior remains backward compatible.

**Tech Stack:** TypeScript, Node.js, Supabase/PostgreSQL, Next.js, worker queue, systemd, Codex/Grok subscription clients where independently accepted.

**Spec:** docs/superpowers/specs/2026-08-29-subscription-ai-providers-design.md

## Global Constraints

1. Approach B is closed: execution families are `openai_http`, test-only `command`, and production-gated `subscription_command`; subscription adapters are exactly `codex` and `grok`.
2. Migrations `001`–`018` remain byte-for-byte unchanged. All schema changes begin at migration `019` and move forward only.
3. Subscription providers support only `niche_normalization` in this cycle. No other role is exposed, persisted, or routed.
4. `command` remains test-only and production-fail-closed. It is never a fallback implementation for Codex or Grok.
5. `subscription_command` is not arbitrary command execution: executable, arguments, environment, auth home, working directory, execution profile, and isolation profile are immutable worker-owned inputs, never database or browser inputs.
6. Subscription execution requires supported subscription/OAuth credentials. API-key, custom-endpoint, unrelated-credential, inherited provider override, and PAYG fallback paths fail closed.
7. `ai_provider_runtime_state` is the only mutable auth/readiness truth. Remove `config.executionProbe` and `config.authStatus` as routing inputs; web/provider/model writes cannot mark a subscription provider Ready.
8. A successful full worker probe writes `checked_at` and `ready_valid_until = checked_at + interval '10 minutes'` from the database clock in one transaction. The policy is server-controlled, fingerprinted, and not browser-configurable.
9. Routing requires enabled provider, `state=ready`, `available=true`, database time strictly before `ready_valid_until`, null `retry_not_before`, and exact settings-revision, auth-generation, execution-fingerprint, security-profile, capability, containment, and terms bindings.
10. Time passage never restores routing. Reaching `retry_not_before` only permits a new full worker probe; only a successful probe issues a new Ready lease.
11. Every runtime mutation uses stale-safe CAS on provider ID, settings revision, auth generation, and execution fingerprint. A stale probe, auth mutation, lease expiry, or execution completion cannot overwrite newer state.
12. Immediately before possible subscription consumption, one authoritative `begin_ai_provider_attempt` transaction verifies all routability predicates, allocates the next sequence, and appends durable `attempt_started`. No successful transaction means no child spawn or provider call.
13. Provider attempt events are append-only, contain no prompt/output/auth material, have one start and at most one authoritative outcome per attempt, and represent unknown consumption honestly.
14. Job retry/reclaim reconstructs attempted providers from durable events. Success, possible consumption, unknown-after-crash, and bare starts exclude replay; only affirmative `attempt_not_consumed` proof permits one bounded replacement.
15. One logical normalization analysis makes at most three distinct externally consumable provider attempts. The same provider is not replayed when consumption is possible.
16. Failure writeback commits before fallback selection. Only approved recoverable classes may cross-provider fallback; unknown, unsafe, schema, business, capability, and containment failures fail closed as specified.
17. `allowPaidFallback=false` removes PAYG before ranking in Saver, Balanced, and Highest Quality modes. Subscription failure never enables PAYG.
18. Preserve mode ordering exactly: Saver = billing, priority, quality; Balanced = priority, billing, quality; Highest Quality = quality, priority, billing. Lower numeric priority wins.
19. Per-adapter concurrency is one in-process permit for the current single-worker topology, acquired before pre-spawn authorization and released in `finally` on every terminal path. Multi-worker activation remains blocked on distributed coordination.
20. Codex and Grok use separate app-managed auth homes, separate attestations, separate acceptance evidence, and at most one provider row per adapter. No Hermes, human, browser, or shared auth home is reused.
21. Each invocation uses a fresh empty directory, empty-base environment allowlist, `shell=false`, fixed profile, bounded combined output, streaming-safe adapter parser, strict schema validation, timeout/cancel/process-group termination, and cleanup.
22. Actual Oracle containment must deny production source, worker env, unrelated home/SSH/Hermes data, writes outside invocation space, prohibited process/shell, arbitrary network, MCP/hooks/rules/config, sessions/memory/subagents, and provider overrides. A failed category keeps that adapter unroutable.
23. Catalog/model existence does not prove capability. An adapter/model remains disabled until current fingerprint-bound structured-normalization capability evidence passes.
24. Subscription telemetry records logical requests and reliable token data only. It never fabricates per-call USD. Existing PAYG monetary accounting remains authoritative and separate.
25. `normalization_generation` remains subordinate to existing analysis ownership. Waiting recovery uses one row-locked rearm RPC and deterministic key `normalize:<candidateId>:<generation>`; failed enqueue does not consume a generation.
26. Initial `AI Screening` scheduling remains in the daily orchestrator. Provider-ready, Research Now, and daily sweep converge on the same rearm primitive for `Waiting for AI Capacity`.
27. Existing `openai_http` encryption, write-only secret UX, SSRF/DNS/IP pinning, HTTPS, response bounds, execution-probe ownership, provider/model ownership, billing, and no-PAYG behavior remain unchanged.
28. The web exposes only product choices: OpenAI Codex Subscription, Grok Subscription, and OpenAI-Compatible API. It never exposes kind strings, binary path, argv, auth home, profile, or environment.
29. Infrastructure implementation and adapter activation are separate. No adapter is hard-coded Ready, no production development override exists, and each failed acceptance gate leaves the adapter disabled/unroutable.
30. Rollout is migration → fail-closed worker → existing-provider verification → executable/auth/attestation → Ready lease → web control → normalization routing → controlled recovery. Rollback fences execution and credentials before application/schema rollback.
31. This plan does not authorize live provider calls, provider authentication, Oracle changes, Supabase production changes, deployment, candidate mutation, or Codex/Grok acceptance while the plan itself is being created.

## Canonical Interfaces and Names

Define these names once and use them unchanged in every task:

- `ProviderKind = 'openai_http' | 'command' | 'subscription_command'`.
- `SubscriptionAdapter = 'codex' | 'grok'`.
- `ProviderRuntimeState = 'authorization_required' | 'ready' | 'expired' | 'needs_attention'`.
- `ProviderAttemptEventType = 'attempt_started' | 'attempt_succeeded' | 'attempt_failed' | 'attempt_cancelled' | 'attempt_not_consumed' | 'attempt_unknown_after_crash'`.
- `ProviderConsumptionStatus = 'consumed' | 'not_consumed' | 'unknown'`.
- `SubscriptionFailureClass = 'auth_expired' | 'credential_source_mismatch' | 'binary_identity_mismatch' | 'containment_failure' | 'capability_mismatch' | 'temporary_capacity' | 'transient_client_failure' | 'timeout' | 'cancelled' | 'unsafe_unknown'`.
- `READINESS_MAX_AGE_SECONDS = 600`, `READINESS_POLICY_VERSION = 'ready-lease-v1'`, and `SECURITY_PROFILE_VERSION = 'subscription-isolation-v1'`; both versions participate in the execution fingerprint.
- `ai_provider_runtime_state`: one worker-owned row per provider.
- `ai_provider_capability_attestations`: immutable adapter/model capability evidence.
- `ai_provider_containment_attestations`: immutable hostile-probe evidence.
- `provider_attempt_events`: immutable write-ahead attempt evidence.
- `commit_ai_provider_probe`: CAS RPC that records a successful or failed full probe and is the only issuer of a Ready lease.
- `apply_ai_provider_runtime_failure`: CAS RPC that applies the normative execution/probe failure matrix and optional model invalidation.
- `fence_ai_provider_auth`: RPC that disables availability and increments `auth_generation` before auth mutation.
- `expire_ai_provider_ready_lease`: CAS RPC that marks an observed expired lease unavailable and enqueues/deduplicates a readiness probe.
- `begin_ai_provider_attempt`: pre-spawn RPC that atomically verifies the provider/bindings, allocates `attempt_sequence`, and appends `attempt_started`.
- `append_ai_provider_attempt_outcome`: RPC that appends exactly one normal or reconciliation outcome; unique-conflict losers reload the winner.
- `reconcile_ai_provider_attempts`: RPC/repository operation that returns durable attempted-provider exclusions and converts orphan starts to `attempt_unknown_after_crash` unless affirmative non-consumption proof exists.
- `rearm_candidate_normalization`: row-locked RPC that advances `normalization_generation` and inserts one generation-keyed normalization job atomically.
- `PROBE_AI_PROVIDER_READINESS`: worker-owned queue job for a full subscription readiness/attestation refresh; `TEST_AI_PROVIDER_CONNECTION` remains a user test and never performs login.
- `SubscriptionExecutionProfile`: immutable adapter execution, auth-home, credential-source, parser, and isolation identity.
- `SubscriptionProcessTransport`: low-level fixed-profile process runner only.
- `CodexSubscriptionAdapter` and `GrokSubscriptionAdapter`: adapter-specific credentials, argv, parsing, capability, and error classification.
- `AdapterSemaphoreRegistry`: one current-process permit per subscription adapter.
- `NormalizationExecutionCoordinator`: durable routing, pre-spawn, attempt outcome, failure writeback, and bounded fallback owner.

## Dependency Order

```text
019 schema and generated DB types
  -> shared/exhaustive kind model
  -> runtime-state CAS repository
  -> attempt-event/pre-spawn repository
  -> secure process transport + semaphore
  -> Codex/Grok adapter infrastructure
  -> readiness/attestation orchestration
  -> normalization execution coordinator and fallback
  -> Waiting rearm
  -> settings API/UI
  -> regression/integration gates
  -> deployment/acceptance tooling
  -> terms gate -> independent Codex/Grok gates -> controlled Plan 04 acceptance
```

## Task 1: Add migration 019 provider, runtime, attestation, and attempt schema

**Spec:** Sections 10–13, 19, 21–22, 30.

**Files**
- Create: `supabase/migrations/202608290019_subscription_ai_provider_schema.sql`
- Create: `packages/db/src/subscription-provider-schema.integration.test.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `package.json`
- Test: `packages/db/src/subscription-provider-schema.integration.test.ts`

**Interfaces**
- Consumes: existing `ai_providers`, `ai_models`, `provider_secrets`, `ai_analyses`, `candidates`, `jobs`, service-role RLS convention, and migration 018 baseline.
- Produces: `adapter`, `normalization_generation`, `ai_provider_runtime_state`, both attestation tables, `provider_attempt_events`, database constraints/triggers, and generated TypeScript table types consumed by Tasks 2–18.

- [ ] Write failing integration cases named `accepts only the approved kind-adapter-billing matrix`, `rejects subscription provider secrets and cross-family config`, `keeps provider family immutable`, `requires provider and model billing agreement`, `permits one provider row per subscription adapter`, `keeps unproven subscription models disabled`, `rejects updates and deletes of provider attempt events`, and `rejects contradictory attempt outcomes`; run `pnpm --filter @ara/db exec vitest run src/subscription-provider-schema.integration.test.ts` and record RED because migration 019 objects do not exist.
- [ ] Create migration 019 without editing 001–018. Add nullable `ai_providers.adapter`, extend kind CHECK to `subscription_command`, enforce the matrix in Global Constraint 1, add a partial unique index on adapter for subscription rows, reject subscription secrets with a constraint trigger, reject model/provider billing mismatch with a constraint trigger, reject family-specific JSON keys across families, and reject kind/adapter family mutation with a `BEFORE UPDATE` trigger.
- [ ] Add `candidates.normalization_generation bigint NOT NULL DEFAULT 0 CHECK (normalization_generation >= 0)`; do not alter initial scheduling or enqueue behavior in this task.
- [ ] Create `ai_provider_runtime_state` with the exact fields from spec Section 11: provider PK, state, available/state CHECK, sanitized reason, checked/lease/retry times, bounded transient count, settings revision, execution fingerprint, auth generation, security/readiness policy versions, capability/containment attestation FKs/digests, and updated timestamp. Revoke public/anon/authenticated access; grant service role only.
- [ ] Create immutable capability and containment attestation tables bound to provider, adapter, model where applicable, binary/profile/auth-home/security/readiness/host-policy identities, pass result, checked time, and sanitized evidence digest/reference; add no raw evidence, prompt, output, token, or credential columns.
- [ ] Create `provider_attempt_events` with event/attempt/logical-analysis/provider/model/adapter/role/billing IDs, nullable sequence, timestamps, bindings, fallback parent, safe worker/job/lease context, sanitized result/error/proof metadata, reliable usage JSON, and consumption status. Enforce one start per attempt, unique `(logical_analysis_id, attempt_sequence)` on start rows, at most one outcome across all outcome types, legal event/status combinations, and an append-only update/delete rejection trigger.
- [ ] Regenerate `packages/db/src/types.ts` from the local migrated schema using the repository’s Supabase type-generation workflow; add the new integration test to `test:integration` in `package.json`; run the focused test to GREEN, then `pnpm --filter @ara/db test`, `pnpm --filter @ara/db typecheck`, and `git diff --check`.
- [ ] Commit only migration 019, generated DB types, test registration, and schema tests with message `db: add subscription provider execution schema`.

## Task 2: Make provider-kind and adapter dispatch exhaustive

**Spec:** Sections 1, 3, 9–10, 15, 24–25.

**Files**
- Create: none
- Modify: `packages/shared/src/ai.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/ai.test.ts`
- Modify: `packages/db/src/execution-identity.ts`
- Modify: `packages/db/src/provider-repository.ts`
- Modify: `packages/db/src/provider-repository.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/worker/src/providers/provider-catalog.ts`
- Modify: `apps/worker/src/providers/provider-catalog.test.ts`
- Test: `packages/shared/src/ai.test.ts`, `packages/db/src/provider-repository.test.ts`, `apps/worker/src/providers/provider-catalog.test.ts`

**Interfaces**
- Consumes: migration 019 row types and current provider fingerprint/catalog interfaces.
- Produces: exported `SubscriptionAdapterSchema`, `ProviderRuntimeStateSchema`, attempt/failure enums, discriminated persisted provider configuration, subscription-aware fingerprint inputs, and exhaustive provider-kind dispatch with unknown kinds fail-closed.

- [ ] Write failing tests named `parses only codex and grok subscription adapters`, `requires subscription kind adapter and subscription billing`, `includes auth and security bindings in subscription fingerprints`, `maps adapter and runtime state from repository rows`, and `never sends an unknown kind through CommandProvider`; run the three focused test files and record RED on missing schemas/branches.
- [ ] Extend `ProviderKindSchema`; add/export the canonical adapter, runtime, attempt, consumption, and failure schemas/types. Define a discriminated `PersistedAiProviderConfigSchema` whose subscription branch accepts only fixed role `niche_normalization` plus product-visible model/priority state and contains no executable, argv, auth-home, base URL, API key, or command profile.
- [ ] Replace `fingerprintFromProviderConfig`’s family-agnostic key scan with exhaustive family functions. For subscription input require adapter, absolute binary identity digest/version, execution-profile ID, auth-home identity, auth generation, settings revision, security/readiness policy versions, hostile-probe binding, and capability binding; preserve the existing HTTP fingerprint result for identical HTTP input.
- [ ] Extend `savedProviderFromRpc`, repository row exports, and tests for `adapter`; remove any implicit `openai_http else command` assumptions. Unknown kind/adapter yields `ProviderCatalogError` and an unavailable catalog omission, never `CommandProvider` construction.
- [ ] Add a temporary explicit `subscription_command` catalog branch that returns unavailable without constructing a process until Tasks 7–9 provide current runtime/profiles. This is the mixed-version fail-closed worker stage, not a readiness override.
- [ ] Run focused tests to GREEN, then `pnpm --filter @ara/shared test`, `pnpm --filter @ara/db test`, `pnpm --filter @ara/worker test`, corresponding typechecks, and `git diff --check`.
- [ ] Commit with message `refactor: make AI provider dispatch exhaustive`.

## Task 3: Implement authoritative runtime state and stale-safe CAS

**Spec:** Sections 4–5, 10–14, 16–17, 21, 27.

**Files**
- Create: `supabase/migrations/202608290020_subscription_ai_runtime_cas.sql`
- Create: `packages/db/src/provider-runtime-repository.ts`
- Create: `packages/db/src/provider-runtime-repository.test.ts`
- Create: `packages/db/src/provider-runtime.integration.test.ts`
- Modify: `packages/db/src/provider-repository.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `package.json`
- Test: runtime repository unit/integration files

**Interfaces**
- Consumes: migration 019 runtime/attestation schema, provider settings revisions, canonical constants and failure classes.
- Produces: `ProviderRuntimeRepository`, `commit_ai_provider_probe`, `apply_ai_provider_runtime_failure`, `fence_ai_provider_auth`, `expire_ai_provider_ready_lease`, and current-routability reads.

- [ ] Write failing DB cases for a Ready lease at 9:59 versus 10:00, DB-clock lease issuance, stale settings/auth/fingerprint CAS, reauth/logout fencing, disable-without-revoke, auth expiry, credential/binary/containment/capability mismatch, temporary capacity Retry-After clamps, transient backoff sequence, retry expiry without auto-Ready, and stale-lease probe deduplication; prove RED before migration 020.
- [ ] Implement `commit_ai_provider_probe` so only the worker service role can write runtime state. A successful full probe must validate current provider kind/adapter/enabled/settings, current auth generation/fingerprint, passed current capability/containment/credential/binary/terms bindings, write DB `checked_at`, and issue exactly `ready_valid_until = checked_at + 10 minutes`; success resets retry/transient state. Failed probes apply the normative classifier and issue no lease.
- [ ] Implement `apply_ai_provider_runtime_failure` with the exact Section 12 matrix. Clamp capacity retry to 1–15 minutes with 5-minute default; derive transient retry at 30 seconds, 1 minute, 2 minutes, then 5 minutes maximum; unknown classes become `needs_attention`. Capability mismatch invalidates model-only or provider-level evidence according to supplied scope.
- [ ] Implement `fence_ai_provider_auth` to lock the provider/runtime row, set unavailable, clear lease/retry, increment `auth_generation`, and return the new generation before initial auth, logout, reauthorization, auth-home replacement, revoke, adoption/reset, or adapter/auth identity change. Disable updates only `enabled=false` and never calls revoke.
- [ ] Implement `expire_ai_provider_ready_lease` so `now() >= ready_valid_until` CAS-writes `available=false`, reason `readiness_stale`, and inserts one `PROBE_AI_PROVIDER_READINESS` job using an identity-keyed idempotency key. It must not create a probe or overwrite state when bindings changed.
- [ ] Implement repository methods `findRuntimeState`, `readRoutableSubscriptionProvider`, `commitProbe`, `applyFailure`, `fenceAuth`, and `expireLease`; parse RPC responses strictly and expose no general `upsertRuntimeState` method.
- [ ] Remove `config.executionProbe` preservation and `recordExecutionProbe` as subscription routing truth from `save_ai_provider_settings`; retain the current HTTP execution-probe behavior behind an explicit HTTP-only repository method until Task 13 confirms compatibility.
- [ ] Regenerate DB types, add integration test registration, run focused GREEN plus `@ara/db` test/typecheck and `git diff --check`, then commit `db: enforce subscription provider runtime leases`.

## Task 4: Add atomic pre-spawn authorization and immutable attempt APIs

**Spec:** Sections 17, 19–20, 27; residual finding R2.

**Files**
- Create: `supabase/migrations/202608290021_provider_attempt_transactions.sql`
- Create: `packages/db/src/provider-attempt-repository.ts`
- Create: `packages/db/src/provider-attempt-repository.test.ts`
- Create: `packages/db/src/provider-attempts.integration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `package.json`
- Test: provider-attempt unit/integration files

**Interfaces**
- Consumes: provider/runtime/attestation schema, analysis ownership, worker/job lease context.
- Produces: `begin_ai_provider_attempt`, `append_ai_provider_attempt_outcome`, `reconcile_ai_provider_attempts`, `ProviderAttemptRepository`, and `AttemptAuthorization`.

- [ ] Write failing tests proving all twelve pre-spawn assertions: provider ID, enabled, Ready, available, unexpired DB lease, retry permission, settings revision, auth generation, fingerprint, capability/security/containment bindings, next sequence, and durable start. Also test failed start persistence blocks an injected spawn callback; record RED.
- [ ] Implement `begin_ai_provider_attempt` as one transaction/RPC. Lock the logical `ai_analyses` row and provider/runtime rows; reject lost analysis lease/epoch; reject PAYG when the request disallows it; verify model ownership/billing/capability and every subscription binding; derive the next monotonic start sequence; insert `attempt_started` with request-count intent 1; commit before returning `attempt_id`, sequence, and DB start time. Do not split assertion and append into application calls.
- [ ] For `openai_http`, the same RPC records attempt evidence while applying existing enabled/model/billing/no-PAYG predicates without requiring a subscription runtime row. For legacy `command`, allow only explicit non-production test context and fail closed otherwise.
- [ ] Implement `append_ai_provider_attempt_outcome` with strict event/result/consumption combinations. Normal completion emits one of succeeded/failed/cancelled. `attempt_not_consumed` requires allowlisted affirmative proof (`spawn_rejected_before_child`, `profile_verification_failed_before_spawn`, or `semaphore_cancelled_before_authorization`). Crash reconciliation uses `attempt_unknown_after_crash` and `worker_process_loss`; it never claims zero usage.
- [ ] Implement unique-race behavior: when completion and reconciliation collide, return/reload the existing authoritative outcome rather than raising a retry that might execute a provider again.
- [ ] Implement `reconcile_ai_provider_attempts(logicalAnalysisId, currentJobId, currentLeaseEpoch)` to append unknown outcomes for orphan bare starts, return provider exclusions and external-attempt count, preserve successful/possibly-consumed/unknown exclusions, and permit at most one replacement after proven not-consumed. Never infer history from process memory.
- [ ] Verify event projections omit prompts, raw stdout/stderr, auth paths/content, environment values, API keys, and subscription USD; reliable token/request telemetry remains optional JSON separate from final `ai_usage`.
- [ ] Regenerate types, register integration tests, run focused GREEN plus DB tests/typecheck and `git diff --check`, then commit `db: authorize and audit provider attempts atomically`.

## Task 5: Extract a bounded fixed-profile subscription process transport

**Spec:** Sections 6–9, 30.

**Files**
- Create: `packages/ai-router/src/providers/subscription-process.ts`
- Create: `packages/ai-router/src/providers/subscription-process.test.ts`
- Create: `packages/ai-router/src/providers/subscription-errors.ts`
- Modify: `packages/ai-router/src/providers/command.ts`
- Modify: `packages/ai-router/src/providers/command.test.ts`
- Modify: `packages/ai-router/src/index.ts`
- Test: process and legacy command tests

**Interfaces**
- Consumes: safe spawn/cancel/termination behavior currently embedded in `CommandProvider`.
- Produces: `SubscriptionProcessTransport.run(profile, invocation, signal)`, bounded stream events, sanitized `SubscriptionProcessError`, and unchanged test-only `CommandProvider` behavior.

- [ ] Write failing tests for fixed absolute executable enforcement, `shell=false`, empty-base environment allowlist, fresh empty cwd, combined stdout+stderr limit, per-channel parser bounds, stdin prompt mode, timeout, abort, process-group soft/hard termination, cleanup on all exits, and no child launch after profile verification failure; prove RED.
- [ ] Extract only low-level process primitives from `CommandProvider`; do not make `SubscriptionProcessTransport` accept `CommandProviderConfig`, arbitrary executable/argv/cwd/env, database values, or a generic JSON extraction mode.
- [ ] Define `SubscriptionExecutionProfile` with immutable profile ID, adapter, absolute executable identity, fixed args builder identifier, environment names/values allowlist, auth-home identity (not credential content), output bounds, timeout/kill grace, invocation-root identity, isolation-policy identity, and profile digest. Construction is module-private to worker-owned profile factories.
- [ ] Stream stdout/stderr into adapter callbacks while enforcing one combined byte counter and bounded per-channel frames. Never use first/last-brace extraction; return bytes/frames to the dedicated adapter parser.
- [ ] Create each invocation directory with restrictive permissions, assert it is outside repository/auth homes, use prompt stdin where the adapter supports it, and remove artifacts in `finally`; startup cleanup accepts only stale directories under the fixed invocation root and never follows symlinks.
- [ ] Preserve legacy `CommandProvider`’s existing public behavior and tests while changing it to reuse only verified low-level termination/bounds helpers. Keep its 2 MiB-per-stream contract unless its own tests intentionally change; subscription combined bound is separate.
- [ ] Run focused tests to GREEN, then `pnpm --filter @ara/ai-router test`, typecheck, lint, and `git diff --check`; commit `refactor: add bounded subscription process transport`.

## Task 6: Enforce one in-process permit per subscription adapter

**Spec:** Section 18.

**Files**
- Create: `apps/worker/src/providers/adapter-semaphore.ts`
- Create: `apps/worker/src/providers/adapter-semaphore.test.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/src/providers/adapter-semaphore.test.ts`, `apps/worker/src/main.test.ts`

**Interfaces**
- Consumes: `SubscriptionAdapter`, worker abort signals, current one-process deployment topology.
- Produces: singleton `AdapterSemaphoreRegistry` with `withPermit(adapter, signal, work)` and limit 1 per adapter.

- [ ] Write failing tests that two Codex calls serialize, Codex and Grok may each hold one permit, queued cancellation never runs work, and permits release after success/error/timeout/cancellation; prove RED.
- [ ] Implement a FIFO, abort-aware semaphore with one permit keyed by `codex` and `grok`. Do not add PostgreSQL locks or pretend the mechanism supports multiple workers.
- [ ] Construct one registry in `main()` and inject it into handlers/coordinator; never instantiate one per job.
- [ ] Add startup assertion/config documentation that subscription routing is disabled if configured worker-process count exceeds one or a distributed coordination marker is absent.
- [ ] Run focused GREEN, worker test/typecheck/lint, and `git diff --check`.
- [ ] Commit `worker: serialize subscription adapters`.

## Task 7: Implement fail-closed Codex adapter infrastructure

**Spec:** Sections 4–9, 13–14, 21, 29.

**Files**
- Create: `packages/ai-router/src/providers/codex-subscription.ts`
- Create: `packages/ai-router/src/providers/codex-subscription.test.ts`
- Create: `apps/worker/src/providers/subscription-profiles.ts`
- Create: `apps/worker/src/providers/subscription-profiles.test.ts`
- Create: `apps/worker/src/providers/subscription-auth-home.ts`
- Create: `apps/worker/src/providers/subscription-auth-home.test.ts`
- Modify: `packages/ai-router/src/index.ts`
- Test: Codex adapter/profile/auth-home files

**Interfaces**
- Consumes: `SubscriptionProcessTransport`, canonical failure classes, app-owned profile inputs.
- Produces: `CodexSubscriptionAdapter`, `createCodexExecutionProfile`, credential-source/auth/binary inspection results, strict normalization parser, and disabled-by-default profile activation.

- [ ] Write failing tests for profile immutability, absolute binary owner/mode/version/digest mismatch, dedicated 0700 auth home and 0600 credential-file checks where supported, empty inherited environment, fixed model/arguments, strict single-envelope output, trailing-data rejection, timeout/cancel, auth expiry, capacity, transient, capability, and unsafe error classification; prove RED without invoking a real Codex client.
- [ ] Implement adapter methods for binary identity inspection, effective credential-source/endpoint inspection, auth status, structured capability probe, health probe, argv construction, stream framing, schema parsing, and sanitized error classification. No API key, raw token, endpoint override, or provider override is accepted.
- [ ] Define `createCodexExecutionProfile` from trusted worker configuration plus a committed accepted-profile manifest. The manifest stores only identity/policy data and begins `activation: 'disabled'`; no local help output or guessed client flag can set it active.
- [ ] Implement auth-home ownership/permission/symlink checks and stable identity hashing. Paths are app-managed, outside invocation directories and human/Hermes homes, never returned to browser/logs, and never stored as raw credentials in PostgreSQL.
- [ ] Keep exact live-client switches behind the accepted profile manifest. If the installed version has no independently proven fixed mechanism for config/tool/session/provider isolation or subscription credential source, profile creation returns a sanitized unavailable reason and cannot construct an executable adapter.
- [ ] Run focused GREEN using fake executable fixtures only, then router/worker tests/typechecks/lints and `git diff --check`.
- [ ] Commit `feat: add gated Codex subscription adapter`.

## Task 8: Implement independently gated Grok adapter infrastructure

**Spec:** Sections 4–9, 13–14, 21, 29.

**Files**
- Create: `packages/ai-router/src/providers/grok-subscription.ts`
- Create: `packages/ai-router/src/providers/grok-subscription.test.ts`
- Modify: `apps/worker/src/providers/subscription-profiles.ts`
- Modify: `apps/worker/src/providers/subscription-profiles.test.ts`
- Modify: `packages/ai-router/src/index.ts`
- Test: Grok adapter and shared profile tests

**Interfaces**
- Consumes: process transport/auth-home utilities without Codex credential or parser reuse.
- Produces: `GrokSubscriptionAdapter`, `createGrokExecutionProfile`, Grok-specific OAuth source proof/parser/classifier, and independent disabled activation.

- [ ] Write failing Grok-specific tests for OAuth/subscription source, API-key/custom-endpoint precedence rejection, independent auth home, fixed binary/profile/model identity, noninteractive envelope parsing, timeout/cancel, quota/transient/auth/capability/unsafe classifications, and proof that Codex evidence cannot activate Grok; prove RED.
- [ ] Implement the same narrow normalization contract through Grok-owned credential inspection, argv construction, parser, capability mapping, and error classifier; do not subclass Codex behavior or copy Codex attestation IDs.
- [ ] Add a separate committed Grok profile manifest with `activation: 'disabled'`. Unsupported installation, auth, headless mode, model selection, or isolation returns Setup Required/unavailable.
- [ ] Reject xAI API keys, inherited endpoints, or custom provider overrides even when a Grok subscription row exists. Never translate an xAI API response into subscription evidence.
- [ ] Run focused GREEN with fixtures only, full router/worker tests/typechecks/lints, and `git diff --check`.
- [ ] Commit `feat: add gated Grok subscription adapter`.

## Task 9: Orchestrate worker-owned readiness, capability, and containment probes

**Spec:** Sections 4–8, 11–14, 21, 27, 29.

**Files**
- Create: `apps/worker/src/jobs/probe-ai-provider-readiness.ts`
- Create: `apps/worker/src/jobs/probe-ai-provider-readiness.test.ts`
- Create: `apps/worker/src/providers/containment-probe.ts`
- Create: `apps/worker/src/providers/containment-probe.test.ts`
- Modify: `packages/queue/src/queue.ts`
- Modify: `packages/queue/src/queue.test.ts`
- Modify: `apps/worker/src/handlers.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/jobs/test-ai-provider.ts`
- Modify: `apps/worker/src/providers/provider-catalog.ts`
- Test: readiness/containment/handler/catalog tests

**Interfaces**
- Consumes: adapter inspection APIs, runtime CAS repository, attestation schema, adapter semaphore/profile, queue.
- Produces: `PROBE_AI_PROVIDER_READINESS`, `runProviderReadinessProbe`, `runHostileContainmentProbe`, deduplicated probe scheduling, and runtime-backed catalog eligibility.

- [ ] Write failing tests that a full probe requires every binary/auth-source/auth-home/generation/capability/containment/settings/fingerprint/security/terms item, stale completions lose CAS, lease expiry schedules one probe, retry expiry does not route, one failed hostile category prevents Ready, and `TEST_AI_PROVIDER_CONNECTION` cannot login or issue Ready; prove RED.
- [ ] Add `PROBE_AI_PROVIDER_READINESS` to `JobType` and handler dispatch. Its payload is provider ID plus expected settings/auth/fingerprint identity; idempotency is `provider-probe:<providerId>:<settingsRevision>:<authGeneration>:<executionFingerprint>`.
- [ ] Implement `runProviderReadinessProbe` in order: load/fence-check snapshot, acquire adapter permit, verify profile/binary/auth home, attest effective subscription credential source, execute strict capability probe, execute hostile containment probe, compute evidence digests, then call `commit_ai_provider_probe`. Any changed binding discards the result.
- [ ] Implement repeatable hostile fixtures for prohibited production source, worker env, unrelated home, SSH, Hermes, external writes, subprocess/shell, arbitrary network, MCP, hooks, rules/config, sessions/memory, subagents, and provider override. Unit tests validate the harness with a fake isolated client; production evidence is deferred to Tasks 16–17.
- [ ] Modify catalog loading so subscription entries are constructed only from a recognized active profile and current `ai_provider_runtime_state`; include only attested enabled models; derive health from runtime state/DB lease bindings, never adapter `health()` alone or `config.executionProbe`. Unknown/stale evidence creates an unavailable entry or omission and schedules the normal probe.
- [ ] Keep HTTP `runProviderConnectionTest` semantics and explicit real-completion disclosure unchanged. Subscription test returns authoritative sanitized status/guidance and queues a readiness probe; it performs no login and cannot bypass acceptance gates.
- [ ] Run focused GREEN, queue/router/worker tests and typechecks, `git diff --check`, then commit `worker: own subscription readiness attestations`.

## Task 10: Implement durable normalization attempts, fallback, and crash reconciliation

**Spec:** Sections 16–20, 27; residual finding R2.

**Files**
- Create: `apps/worker/src/providers/normalization-execution-coordinator.ts`
- Create: `apps/worker/src/providers/normalization-execution-coordinator.test.ts`
- Create: `apps/worker/src/providers/normalization-execution-coordinator.integration.test.ts`
- Modify: `apps/worker/src/jobs/normalize-opportunities.ts`
- Modify: `apps/worker/src/jobs/normalize-opportunities.integration.test.ts`
- Modify: `apps/worker/src/handlers.ts`
- Modify: `packages/ai-router/src/router.ts`
- Modify: `packages/ai-router/src/router.test.ts`
- Modify: `package.json`
- Test: coordinator, normalization, and router files

**Interfaces**
- Consumes: catalog/runtime bindings, `ProviderAttemptRepository`, semaphore, adapters, existing analysis claim/heartbeat/completion ownership.
- Produces: `NormalizationExecutionCoordinator.execute`, durable exclusion/reconciliation, approved bounded fallback, and clean-cutover normalization execution.

- [ ] Write failing tests for exact three mode comparators, PAYG pre-filtering, maximum three distinct external providers, durable exclusions after success/possible consumption/unknown/bare start, one replacement after not-consumed proof, writeback-before-fallback, disallowed fallback classes, Codex unknown then Grok success, and all-provider exhaustion to Waiting; prove RED.
- [ ] Make `routeAiRequest` accept persisted eligibility and durable exclusions but remain a pure ranker. It must not trust an in-memory Ready snapshot as authoritative permission; `begin_ai_provider_attempt` is the execution-time authority.
- [ ] Implement coordinator sequence per attempt: reconcile durable history; route with exclusions and `allowPaidFallback=false`; acquire adapter permit for subscription; call `begin_ai_provider_attempt`; only after it commits call the selected adapter; append outcome; apply runtime failure CAS when applicable; reload authoritative winner on race; update exclusions; repeat only for an approved class and below the bound.
- [ ] Treat invalid input/output schema, unsafe output, business-rule failure, containment/capability mismatch, and unknown error as non-fallback unless the canonical classifier marks an approved provider-transient class. Containment/capability/unknown state changes fail closed before returning.
- [ ] Preserve one `ai_analyses` ownership/heartbeat and one logical input hash across all attempts. Attempt events are subordinate; they do not claim a second analysis. Completion writes one final logical result/usage; failed/unknown attempt telemetry stays in attempt events and no subscription USD is inserted.
- [ ] Replace production `NormalizeJobDependencies.provider/modelId` execution with `NormalizationExecutionCoordinator`; update tests to inject a coordinator/fake catalog rather than a bypass provider. Remove the obsolete single-provider capacity special case and retain deterministic decision persistence.
- [ ] On job reclaim, reconcile orphan starts before selecting. If no eligible non-PAYG provider remains, fail/defer the same analysis and candidate without replaying a possibly consumed provider.
- [ ] Run focused unit/integration GREEN, then router/worker tests/typechecks and `git diff --check`; commit `worker: add crash-safe provider fallback`.

## Task 11: Rearm Waiting normalization with one generation-keyed transaction

**Spec:** Section 22 and Plan 04 pipeline boundary.

**Files**
- Create: `supabase/migrations/202608290022_rearm_normalization_generation.sql`
- Create: `packages/db/src/normalization-rearm-repository.ts`
- Create: `packages/db/src/normalization-rearm.integration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/shared/src/ai.ts`
- Modify: `apps/worker/src/jobs/daily-research.ts`
- Modify: `apps/worker/src/jobs/daily-research.integration.test.ts`
- Modify: `apps/web/app/api/research-now/route.ts`
- Modify: `apps/web/app/api/research-now/route.test.ts`
- Modify: `apps/worker/src/jobs/probe-ai-provider-readiness.ts`
- Modify: `package.json`
- Test: rearm, daily, Research Now, and readiness tests

**Interfaces**
- Consumes: `normalization_generation`, runtime eligibility, analysis/job ownership, current daily orchestrator.
- Produces: `rearm_candidate_normalization`, `NormalizationRearmRepository.rearm`, and deterministic `normalize:<candidateId>:<generation>` scheduling.

- [ ] Write failing integration cases for Waiting eligibility, current usable non-PAYG provider, active analysis/job exclusion, expected state/generation CAS, concurrent provider-ready/daily/Research Now callers, failed job insert rollback, reclaim preserving generation, and successful normalization before Market Probe; prove RED.
- [ ] Implement `rearm_candidate_normalization(candidate_id, expected_generation, expected_state, locale, prompt_version)` as one service-role transaction. Lock candidate, relevant analysis/job rows, and current eligible provider rows; verify every current routability predicate; calculate next generation; insert one queued `NORMALIZE_OPPORTUNITIES` job with `normalize:<id>:<next>`; update generation only after insert succeeds; return the existing same-generation job to duplicate callers.
- [ ] Change generation-0 initial `AI Screening` scheduling to key `normalize:<candidateId>:0` without moving it out of `enqueueEligibleNormalizationJobs`. Do not use rearm for first scheduling.
- [ ] Extend daily selection to eligible Waiting candidates and call only the repository primitive. After a provider transitions to Ready, call the same primitive for eligible Waiting candidates in bounded pages. Research Now uses the same primitive and never edits candidate state directly.
- [ ] Add `normalizationGeneration` to normalization job payload and verify it against the candidate/analysis on claim/reclaim. Preserve generation throughout coordinator fallback and attempt reconciliation.
- [ ] Assert Market Probe selection still requires natural `Ready for API Validation`; no rearm code writes that state.
- [ ] Regenerate DB types, run focused GREEN plus DB/worker/web tests and typechecks, `git diff --check`, then commit `feat: rearm waiting normalization atomically`.

## Task 12: Add product-safe subscription provider settings API and UI

**Spec:** Sections 13–15, 24–25.

**Files**
- Create: none
- Modify: `apps/web/app/api/ai-providers/route.ts`
- Modify: `apps/web/app/api/ai-providers/route.test.ts`
- Modify: `apps/web/app/api/ai-providers/test/route.ts`
- Modify: `apps/web/app/api/ai-providers/test/route.test.ts`
- Modify: `apps/web/components/ai-provider-form.tsx`
- Modify: `apps/web/components/ai-provider-form.test.ts`
- Modify: `apps/web/app/ai-settings.e2e.spec.ts`
- Modify: `packages/shared/src/i18n.ts`
- Test: API, component, and AI settings E2E files

**Interfaces**
- Consumes: exhaustive product schema, provider/runtime repository projection, fixed subscription role/model choices.
- Produces: three product choices, safe provider cards, disable/test guidance, and no implementation-detail inputs.

- [ ] Write failing API/UI tests for the exact three labels, subscription billing/adapter mapping, fixed `niche_normalization`, no secret row, one adapter row, family immutability conflict, unavailable/setup-required projection, and absence of binary/argv/auth-home/profile/kind inputs; prove RED.
- [ ] Replace the raw kind selector with a product discriminant `codex_subscription | grok_subscription | openai_compatible_api`; map server-side to the canonical kind/adapter/billing matrix. Reject client attempts to submit a different kind, adapter, billing, role, executable, args, profile, auth home, endpoint, or API key for subscription products.
- [ ] Keep API-key/base URL/model discovery fields only for HTTP. Subscription creation persists disabled-by-default provider/model rows unless current worker-owned acceptance/readiness evidence permits explicit enablement; it never creates `provider_secrets`.
- [ ] Project subscription cards from provider plus authoritative runtime/model evidence: product name, Subscription, auth/readiness state, selected model, fixed role, priority, last probe, sanitized actionable reason, SSH-first authorize/reauthorize guidance, Test Status, and Disable. Do not add Delete.
- [ ] Explain mode priority accurately: Saver billing-first, Balanced priority-first, Highest Quality quality-first; lower numeric priority wins only at the priority comparison.
- [ ] Add HTTP Test Connection disclosure that it may issue a real completion and consume quota/cost; subscription test is status/readiness only and never authentication.
- [ ] Run API/component tests and `pnpm --filter @ara/web test:e2e` to GREEN, web typecheck/lint, and `git diff --check`; commit `feat: expose subscription providers safely`.

## Task 13: Lock HTTP compatibility and full integration behavior

**Spec:** Sections 15–17, 20, 23, 27.

**Files**
- Create: none
- Modify: `packages/secret-store/src/index.test.ts`
- Modify: `packages/ai-router/src/providers/openai-http.test.ts`
- Modify: `packages/ai-router/src/router.test.ts`
- Modify: `apps/worker/src/providers/provider-url-policy.test.ts`
- Modify: `apps/worker/src/providers/pinned-http-provider.test.ts`
- Modify: `apps/worker/src/providers/provider-catalog.integration.test.ts`
- Modify: `apps/worker/src/providers/normalization-execution-coordinator.integration.test.ts`
- Modify: `apps/web/app/api/ai-providers/settings-catalog.integration.test.ts`
- Modify: `apps/web/app/ai-settings.e2e.spec.ts`
- Test: all listed files and authoritative workspace gates

**Interfaces**
- Consumes: completed infrastructure through Task 12.
- Produces: regression proof that HTTP behavior is unchanged and cross-provider accounting/audit semantics are coherent.

- [ ] Write failing regression/integration tests named `preserves encrypted HTTP provider behavior`, `fails closed on unknown mixed-version provider kinds`, and `audits Codex unknown then Grok success without fake USD`; run the listed focused files and prove RED on regressions or missing cross-provider behavior.
- [ ] Add/name regression coverage for encrypted write-only secrets, blank-key preservation, SSRF, HTTPS, DNS/IP pinning, metadata/link-local denial, Host/TLS SNI, request/response bounds, HTTP execution-probe ownership, provider/model ownership, billing agreement, and no PAYG fallback.
- [ ] Add integration scenario `Codex failed unknown then Grok succeeds without fake USD`: verify two immutable attempts, unknown consumption on Codex, one Grok success, correct final logical `ai_analysis`/`ai_usage`, no duplicate provider execution, and no subscription USD field/value.
- [ ] Add mixed-version/unknown-kind tests proving old or partial workers fail closed and never dispatch subscription rows to legacy command.
- [ ] Implement the minimal regression fixes exposed by RED without weakening HTTP security or subscription gates; run all focused files to GREEN.
- [ ] Run authoritative local regression gates: `pnpm exec turbo run test --force`, `pnpm exec turbo run typecheck --force`, `pnpm exec turbo run lint --force`, `pnpm exec turbo run build --force`, `pnpm --filter @ara/web test:e2e`, the registered local Supabase integration suite, and `git diff --check`.
- [ ] Record exact pass counts and environment-limited gaps in the task commit body; commit `test: verify mixed AI provider behavior`.

## Task 14: Add deployment, containment, rollout, and rollback tooling

**Spec:** Sections 7–8, 13–14, 18, 25–30.

**Files**
- Create: `scripts/probe-subscription-provider.mjs`
- Create: `scripts/probe-subscription-provider.test.mjs`
- Create: `ops/subscription-providers/install-auth-homes.sh`
- Create: `ops/subscription-providers/verify-runtime-profile.sh`
- Create: `docs/deployment/subscription-providers.md`
- Modify: `docs/deployment/oracle.md`
- Modify: `docs/verification/ai-provider-probes.md`
- Modify: `ops/systemd/amazon-research-worker.service`
- Test: script tests, shell syntax, systemd verification on Oracle before production activation

**Interfaces**
- Consumes: inactive Codex/Grok profile manifests, readiness probe, auth-home/isolation requirements, current Oracle service.
- Produces: repeatable non-secret evidence tooling, dedicated persistent auth homes/invocation roots, staged rollout, and operational rollback procedure.

- [ ] Write failing script tests using fixtures for wrong user/owner/mode/path/digest/version, auth-home sharing, env leakage, forbidden filesystem/process/network/tool access, artifact persistence, and changed profile bindings; prove RED locally without contacting providers.
- [ ] Implement auth-home setup for separate service-owned Codex/Grok directories with 0700 roots and supported credential permissions, plus a separate 0700 invocation root. Refuse human/Hermes/shared homes, symlinks, or repository-relative paths; print no secrets.
- [ ] Implement one probe CLI that invokes the same worker profile and hostile-containment harness, emits bounded sanitized JSON evidence, and exits nonzero for every missing category. It must not guess CLI flags or make an adapter routable; only the worker CAS can commit accepted evidence.
- [ ] Harden the systemd service with verified service-level restrictions that do not break the worker, document adapter child-isolation requirements separately, and bind `SECURITY_PROFILE_VERSION`/host policy digest to the profile. Run `systemd-analyze verify` on Oracle before acceptance; a failure blocks activation.
- [ ] Document exact rollout order 1–14 from the approved spec, including worker-before-web ordering and existing HTTP verification before activation.
- [ ] Document operational rollback: fence/disable, settle/cancel attempts, increment auth generation, choose credential preserve versus supported revoke, retain immutable events, handle dependent rows, verify old-worker compatibility, roll back app, and consider schema narrowing last. Do not use “revert commit” as the procedure.
- [ ] Run local script tests to GREEN, `node --check scripts/probe-subscription-provider.mjs`, `bash -n` for shell files, workspace docs/link checks if present, and `git diff --check`; commit `ops: prepare subscription provider acceptance`.

## Task 15: Pass or fail the provider terms and supported-automation gate

**Spec:** Section 29 Gate 1.

**Files**
- Create: `docs/verification/subscription-provider-terms.md`
- Modify: `apps/worker/src/providers/subscription-profiles.ts` only when evidence passes for the named adapter
- Modify: `apps/worker/src/providers/subscription-profiles.test.ts`
- Modify: `apps/worker/src/jobs/probe-ai-provider-readiness.test.ts`
- Test: profile and readiness test cases `rejects profiles without approved terms evidence` and `accepts only the matching adapter terms digest`

**Interfaces**
- Consumes: official provider/client documentation or written product confirmation matching the service-identity/headless subscription workflow.
- Produces: evidence digests/references bound separately to Codex and Grok profile manifests; failed/missing evidence leaves activation disabled.

- [ ] Write failing tests `rejects profiles without approved terms evidence` and `accepts only the matching adapter terms digest`; before research, prove RED for the acceptance path while the inactive manifest makes readiness return `terms_not_approved`/unavailable.
- [ ] Record source title, official URL or written-confirmation reference, retrieval date, applicable account/product, supported auth mechanism, service-identity/headless allowance, automation limits, and prohibited fallback. Do not record account credentials or private tokens.
- [ ] Evaluate Codex and Grok independently even if one common terms statement exists. Mark each `PASS` only when evidence directly supports the intended workflow; ambiguity is `FAIL`, not inferred approval.
- [ ] On PASS, minimally bind the evidence digest/version into only that adapter’s immutable profile and execution fingerprint. On FAIL, leave `activation: 'disabled'`, record the missing contract precisely, and do not continue that adapter’s live gate.
- [ ] Run the named profile/readiness tests to GREEN for each PASS or verify the explicit fail-closed assertion for each FAIL; run related regressions and `git diff --check`; commit `docs: record subscription automation terms gate`.

## Task 16: Pass or fail Codex Oracle identity, auth, capability, and containment

**Spec:** Section 29 Gate 2 and live sequence prerequisites 1–6.

**Files**
- Create: `docs/verification/codex-oracle-acceptance.md`
- Modify: `apps/worker/src/providers/subscription-profiles.ts` only after every gate passes
- Modify: `apps/worker/src/providers/subscription-profiles.test.ts`
- Modify: `apps/worker/src/jobs/probe-ai-provider-readiness.test.ts`
- Modify: `docs/verification/ai-provider-probes.md`
- Test: production-profile probe plus test cases `rejects Codex before current Oracle evidence` and `routes Codex only after matching accepted evidence`

**Interfaces**
- Consumes: Gate 1 PASS for Codex, Oracle `amazon-research` identity, supported installed client, dedicated auth home, probe tooling.
- Produces: one fingerprint-bound Codex acceptance record and either active profile eligibility or an explicit disabled/unroutable result.

- [ ] Write failing acceptance tests `rejects Codex before current Oracle evidence` and `routes Codex only after matching accepted evidence`; prove RED for the activation path while the manifest is disabled and retain the fail-closed assertion as GREEN baseline.
- [ ] Verify and record without secrets: absolute binary path, owner, mode, digest, version, architecture, immutable profile, auth-home mechanism/identity, supported login/device-auth behavior, and persistence across restart.
- [ ] As `amazon-research`, perform only the supported operator/SSH subscription authorization flow; fence/increment auth generation before auth change. Do not import tokens, API keys, browser credentials, Hermes state, or another user’s home.
- [ ] Prove effective subscription credential source and endpoint for the exact pinned invocation; prove no API-key, custom-endpoint, inherited provider, or environment fallback.
- [ ] Run structured `niche_normalization` capability, output framing, selected model, timeout, cancellation, and bounded-output probes against the exact profile.
- [ ] Run every hostile containment category and cleanup/session-isolation check on Oracle. Any category that cannot be proven denied is failure; do not weaken the probe.
- [ ] If and only if all evidence passes, minimally update the Codex manifest with exact accepted identities, deploy the compatible worker, run `PROBE_AI_PROVIDER_READINESS`, and verify the DB-clock ten-minute Ready lease. Otherwise record FAIL and keep Codex disabled/unroutable.
- [ ] Run the named profile/readiness tests to GREEN on PASS or verify explicit unroutability on FAIL, then coordinator regressions, secret scan, and `git diff --check`; commit `ops: record Codex subscription acceptance`.

## Task 17: Pass or fail Grok Oracle identity, auth, capability, and containment

**Spec:** Section 29 Gate 3 and live sequence prerequisites 1–6.

**Files**
- Create: `docs/verification/grok-oracle-acceptance.md`
- Modify: `apps/worker/src/providers/subscription-profiles.ts` only after every gate passes
- Modify: `apps/worker/src/providers/subscription-profiles.test.ts`
- Modify: `apps/worker/src/jobs/probe-ai-provider-readiness.test.ts`
- Modify: `docs/verification/ai-provider-probes.md`
- Test: production-profile probe plus test cases `rejects Grok before current Oracle evidence` and `routes Grok only after matching independent evidence`

**Interfaces**
- Consumes: Gate 1 PASS for Grok, independently supported Oracle installation/auth, dedicated Grok auth home.
- Produces: independent fingerprint-bound Grok acceptance or Setup Required/unroutable state.

- [ ] Write failing acceptance tests `rejects Grok before current Oracle evidence` and `routes Grok only after matching independent evidence`; prove RED for the activation path while the Grok manifest is disabled and retain the fail-closed assertion as GREEN baseline.
- [ ] Verify and record Grok binary path/owner/mode/digest/version/architecture, accepted profile, auth-home identity, supported OAuth/subscription login, headless noninteractive behavior, and restart persistence; do not reuse Codex evidence.
- [ ] Fence/increment Grok auth generation before the supported operator authorization; reject API-key, custom-endpoint, raw-token, browser-cookie, or inherited credential paths.
- [ ] Prove effective OAuth source/endpoint precedence, selected model, strict structured output, timeout/cancel, bounded output, and classifier behavior for the exact production profile.
- [ ] Run all hostile config/session/memory/tool/MCP/filesystem/process/network/subagent/provider-override probes and cleanup isolation independently.
- [ ] If every item passes, minimally update only the Grok accepted manifest, deploy the compatible worker, run its full readiness job, and verify a fresh DB-clock lease. Otherwise record FAIL and leave Grok Setup Required/unroutable.
- [ ] Run the named profile/readiness tests to GREEN on PASS or verify explicit unroutability on FAIL, then coordinator regressions, secret scan, and `git diff --check`; commit `ops: record Grok subscription acceptance`.

## Task 18: Prove controlled Plan 04 natural recovery and crash/resume

**Spec:** Sections 22, 25, 28–29; controlled candidate `cccdb1c3-20eb-52ae-bd4f-5c8c0fd63454`.

**Files**
- Create: `scripts/verify-plan-04-subscription-acceptance.mjs`
- Create: `scripts/verify-plan-04-subscription-acceptance.test.mjs`
- Create: `docs/verification/subscription-provider-plan-04-acceptance.md`
- Modify: no production source unless the exercised path exposes a separately reproduced defect with its own RED/GREEN task
- Test: read-only acceptance verifier, controlled production scenario, and final authoritative gates

**Interfaces**
- Consumes: Gate 1 plus at least one fully passed adapter gate, active compatible worker, Ready lease, `rearm_candidate_normalization`, attempt events, Plan 04 market pipeline.
- Produces: evidence that the controlled candidate recovers naturally, executes real normalization, and preserves cached API work across worker restart.

- [ ] Write failing verifier tests `rejects manual candidate state hacks`, `requires one generation-keyed normalization job`, `requires immutable attempt evidence`, and `requires cached api_fetched reuse after restart`; run them and prove RED before the read-only verifier exists.
- [ ] Implement the minimal read-only verifier that accepts sanitized database/status exports, checks every named invariant, emits a bounded PASS/FAIL report, and never mutates provider, candidate, job, analysis, usage, or attempt state; run verifier tests to GREEN.
- [ ] Preflight and record branch/release SHA, migration versions, active worker version, provider/runtime fingerprint, unexpired Ready lease, candidate’s existing Waiting state/generation, absence of active normalization ownership, and `allowPaidFallback=false`. Do not mutate candidate state manually.
- [ ] Trigger recovery through provider-ready, Research Now, or daily sweep using `rearm_candidate_normalization`; verify exactly one `normalize:<candidateId>:<generation>` job and generation advances only with that job.
- [ ] Observe one real successful normalization and immutable attempt chain; verify the candidate reaches `Ready for API Validation` naturally before Market Probe and final logical usage has no fabricated subscription USD.
- [ ] Run Market Probe until an actual `api_fetched` checkpoint exists, then restart the worker through the documented service procedure.
- [ ] Verify job reclaim/restart reads durable events, does not replay a successful/possibly-consumed provider, reuses the cached API fetch, and performs no duplicate paid external work.
- [ ] If a crash is injected between `attempt_started` and outcome, verify unknown-after-crash reconciliation and distinct-provider fallback or durable Waiting/Needs Attention; never relabel unknown as not consumed.
- [ ] Run the read-only verifier to GREEN against the captured sanitized evidence, then final turbo test/typecheck/lint/build, web E2E, local integration suite, `systemd-analyze verify` on Oracle, runtime/status queries, and `git diff --check`; record exact observed IDs/timestamps and any failed gate.
- [ ] Commit only the verifier, its tests, and the acceptance record with message `docs: record subscription provider Plan 04 acceptance` when the scenario is complete; a failed adapter gate is recorded as failure and is not represented as implementation acceptance.

## Spec Coverage Map

| Approved spec section / invariant | Implementation tasks |
| --- | --- |
| 1 Decision / Approach B | 1, 2, 7, 8, 12 |
| 2 Goals and non-goals | Global Constraints; 7–18 |
| 3 Verified architecture / catch-all risk | 2, 5, 13 |
| 4 Routability gate | 1, 3, 9, 10 |
| 5 Credential-source attestation | 7–9, 15–17 |
| 6 Agent-capable narrow contract | 5, 7–9, 14, 16–17 |
| 7 Execution containment | 5, 7–9, 14, 16–17 |
| 8 Hostile isolation probe | 9, 14, 16–17 |
| 9 Dedicated adapters / reuse boundary | 5, 7, 8 |
| 10 Migration 019+ database model | 1–4, 11 |
| 11 Single runtime truth / Ready lease | 3, 9, 10 |
| 12 Auth generation / CAS / writeback (R1) | 3, 9, 10, 16–17 |
| 13 Auth-home cardinality | 1, 7–8, 14, 16–17 |
| 14 Authorization lifecycle | 3, 7–9, 12, 16–17 |
| 15 Exhaustive provider handling | 2, 9, 12–13 |
| 16 Router priority | 10, 12–13 |
| 17 Pre-spawn + fallback | 4, 6, 10 |
| 18 Per-adapter concurrency | 6, 9–10 |
| 19 Attempt events / crash recovery (R2) | 1, 4, 10, 13, 18 |
| 20 Usage / budget | 4, 10, 13, 18 |
| 21 Capability proof | 1, 7–9, 16–17 |
| 22 Waiting recovery | 1, 11, 18 |
| 23 HTTP compatibility | 2–3, 9–10, 12–13 |
| 24 MVP UI | 12 |
| 25 Mixed-version rollout | 2, 13–14, 18 |
| 26 Operational rollback | 14 |
| 27 Focused tests | Every task; consolidated in 13 |
| 28 Live acceptance | 16–18 |
| 29 Acceptance gates 1–3 | 15, 16, 17 |
| 30 Security invariants | Global Constraints; 1–17 |
| 31 Design self-review / C1, I1–I12, M1–M2, R1, R2 | Global Constraints; 1–18 |

## Verification Milestones

- After Task 4: local migrated database proves schema/CAS/attempt atomicity and immutability.
- After Task 9: inactive adapter infrastructure can never route without current worker evidence.
- After Task 11: fallback and Waiting recovery are durable, generation-bound, and analysis-owned.
- After Task 13: full local/integration/E2E gates prove HTTP compatibility and mixed-provider accounting.
- After Task 14: deployment/profile tooling is repeatable, sanitized, and fail-closed; no adapter is activated by tooling alone.
- After Tasks 15–17: each acceptance verdict is independently evidenced; failed gates remain unroutable.
- After Task 18: the controlled candidate proves natural recovery and crash/resume without state hacks or duplicate paid work.

## Commit Strategy

Each task ends in one focused commit. Schema, runtime CAS, attempt transactions, transport, adapters, routing, recovery, UI, regression proof, operations, and each live acceptance record remain separately reviewable and revertible. Never combine live acceptance evidence with infrastructure implementation. Never amend migrations 001–018. Before every commit, stage only the task’s listed files, inspect the staged diff, run its focused checks, and run `git diff --check`.

## Completion Verdict Rule

Implementation is complete only when Tasks 1–14 pass all authoritative local gates and each adapter remains fail-closed unless Tasks 15 plus its own Task 16 or 17 pass. Product acceptance is complete only after Task 18 succeeds with at least one accepted adapter. A failed terms, Codex, or Grok gate is an explicit safe outcome: record the failure and keep that adapter disabled; do not weaken the contract or substitute PAYG.
