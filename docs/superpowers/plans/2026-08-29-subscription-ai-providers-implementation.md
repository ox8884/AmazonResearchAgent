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
7. `ai_provider_runtime_state` is the only mutable auth/readiness truth. Remove `config.executionProbe` and `config.authStatus` as subscription routing inputs; web/provider/model writes cannot mark a subscription provider Ready.
8. A successful full worker probe writes `checked_at` and `ready_valid_until = checked_at + interval '10 minutes'` from the database clock in one transaction. The policy is server-controlled, fingerprinted, and not browser-configurable.
9. Routing requires enabled provider, `state=ready`, `available=true`, database time strictly before `ready_valid_until`, null `retry_not_before`, and exact settings-revision, auth-generation, execution-fingerprint, security-profile, capability, containment, terms, and probe-generation bindings.
10. Time passage never restores routing. Reaching `retry_not_before` only permits requesting a new full probe generation; only a successful current-generation probe issues a Ready lease.
11. Every runtime mutation uses stale-safe CAS on provider ID, settings revision, auth generation, execution fingerprint, and probe generation where probe evidence is involved. A stale probe, auth operation, lease expiry, or execution completion cannot overwrite newer state.
12. Immediately before possible subscription consumption, one authoritative `begin_ai_provider_attempt` transaction verifies all routability and dual-lease predicates, allocates the next sequence, and appends durable `attempt_started`. No successful transaction means no sandboxed child or provider call.
13. Provider attempt events are append-only, contain no prompt/raw output/auth material, have one start and at most one authoritative outcome per attempt, and represent unknown consumption honestly.
14. Job retry/reclaim reconstructs attempted providers from durable events. Success, possible consumption, unknown-after-crash, and bare starts exclude replay; only affirmative `attempt_not_consumed` proof permits one bounded replacement.
15. One logical normalization analysis makes at most three distinct externally consumable provider attempts. The same provider is not replayed when consumption is possible.
16. Failure writeback commits before fallback selection. Only classes explicitly allowed by the canonical failure matrix may cross-provider fallback; unknown, unsafe, schema, business, capability, containment, and cancellation paths fail closed as specified.
17. `allowPaidFallback=false` removes PAYG before ranking in Saver, Balanced, and Highest Quality modes. Subscription failure never enables PAYG.
18. Preserve mode ordering exactly: Saver = billing, priority, quality; Balanced = priority, billing, quality; Highest Quality = quality, priority, billing. Lower numeric priority wins.
19. Per-adapter concurrency is one in-process permit for the current single-worker topology, acquired before pre-spawn authorization and released in `finally` on every terminal path. Multi-worker activation remains blocked on distributed coordination.
20. Codex and Grok use separate app-managed auth homes, separate dedicated service identities, separate attestations, separate acceptance evidence, and at most one provider row per adapter. No Hermes, human, browser, or shared auth home is reused.
21. Production subscription execution uses the root-owned `SystemdSubscriptionSandbox`: fixed adapter-specific systemd template units, dedicated `ara-codex`/`ara-grok` UIDs, cgroup-v2 process ownership, systemd filesystem/exec policy, and root-owned nftables UID/IP/port egress policy. A narrow polkit rule permits only fixed-unit lifecycle control; direct `spawn()` of a subscription client is prohibited.
22. Each invocation uses a fresh empty runtime directory, empty-base environment, fixed profile, bounded combined output, streaming-safe parser, strict schema validation, timeout/cancel/cgroup termination, and cleanup. Production source, worker env, unrelated home/SSH/Hermes data, external writes, shell/tool execution, arbitrary network, MCP/hooks/rules/config, sessions/memory/subagents, and provider overrides are denied by the sandbox and verified by hostile probes.
23. Catalog/model existence does not prove capability. An adapter/model remains disabled until current fingerprint-bound structured-normalization capability evidence passes.
24. Subscription telemetry records logical requests and reliable token data only. It never fabricates per-call USD. Existing PAYG monetary accounting remains authoritative and separate.
25. `jobs.attempts` returned by claim is `jobLeaseEpoch`; `ai_analyses.attempts` returned by analysis claim is `analysisLeaseEpoch`. Owner, epoch, running/pending status, and unexpired lease are asserted on every ownership-sensitive write so a reclaimed old process fails even when the worker ID is reused.
26. `normalization_generation` remains subordinate to existing analysis ownership. Waiting recovery uses one row-locked rearm RPC and deterministic key `normalize:<candidateId>:<generation>`; failed enqueue does not consume a generation. Migration 022 first normalizes every legacy generation-zero job key without deleting history.
27. Initial `AI Screening` scheduling remains in the daily orchestrator. Provider-ready, Research Now, and daily sweep converge on the same rearm primitive for `Waiting for AI Capacity`.
28. Existing `openai_http` encryption, write-only secret UX, SSRF/DNS/IP pinning, HTTPS, response bounds, execution-probe ownership, provider/model ownership, billing, and no-PAYG behavior remain unchanged.
29. The web exposes only product choices: OpenAI Codex Subscription, Grok Subscription, and OpenAI-Compatible API. It never exposes kind strings, binary path, argv, auth home, profile, environment, acceptance mutation, or Ready controls.
30. Activation is two-stage and non-circular: disabled acceptance probes may persist immutable evidence but cannot issue Ready; only `activate_subscription_provider` may enable an accepted provider/model and request a fresh probe generation; only that full worker probe may issue Ready. `deactivate_subscription_provider` immediately fences routing without revoking credentials.
31. Infrastructure implementation and adapter activation are separate. No adapter is hard-coded Ready, no production development override exists, and each failed acceptance gate leaves the adapter disabled/unroutable.
32. Rollout is migration/preflight → fail-closed worker → existing-provider verification → sandbox/auth/acceptance evidence → administrative activation → fresh Ready lease → web display/control → normalization routing → controlled recovery. Rollback fences execution and credentials before application/schema rollback.
33. This plan does not authorize live provider calls, provider authentication, Oracle changes, Supabase production changes, deployment, candidate mutation, or Codex/Grok acceptance while the plan itself is being created.

## Canonical Interfaces and Names

Define these names once and use them unchanged in every task:

- `ProviderKind = 'openai_http' | 'command' | 'subscription_command'`.
- `SubscriptionAdapter = 'codex' | 'grok'`.
- `ProviderRuntimeState = 'authorization_required' | 'ready' | 'expired' | 'needs_attention'`.
- `ProviderAttemptEventType = 'attempt_started' | 'attempt_succeeded' | 'attempt_failed' | 'attempt_cancelled' | 'attempt_not_consumed' | 'attempt_unknown_after_crash'`.
- `ProviderConsumptionStatus = 'consumed' | 'not_consumed' | 'unknown'`.
- `SubscriptionFailureClass = 'auth_expired' | 'credential_source_mismatch' | 'binary_identity_mismatch' | 'profile_mismatch' | 'containment_failure' | 'capability_failure' | 'capacity_exhausted' | 'rate_limited' | 'transient_network' | 'client_transient' | 'timeout' | 'cancelled_by_caller' | 'cancelled_by_job_lease_loss' | 'cancelled_by_shutdown' | 'unsafe_unknown' | 'schema_invalid_output' | 'business_validation_failure' | 'process_spawn_failure_pre_consumption'`.
- `JobLeaseIdentity = { jobId: string; jobLeaseOwner: string; jobLeaseEpoch: number }`, where epoch is the positive `jobs.attempts` value returned by claim.
- `AnalysisLeaseIdentity = { analysisId: string; analysisLeaseOwner: string; analysisLeaseEpoch: number }`, where epoch is the positive `ai_analyses.attempts` value returned by claim.
- `READINESS_MAX_AGE_SECONDS = 600`, `READINESS_POLICY_VERSION = 'ready-lease-v1'`, and `SECURITY_PROFILE_VERSION = 'subscription-isolation-v1'`; both versions participate in the execution fingerprint.
- `SystemdSubscriptionSandbox`: the only production subscription launcher; root-owned fixed systemd templates `amazon-research-codex@.service` and `amazon-research-grok@.service`, dedicated service UIDs, fixed cgroup/fs/exec policy, nftables UID/IP/port egress policy, and UUID-only invocation instances.
- `ai_provider_runtime_state`: one worker-owned row per provider, including `probe_generation bigint NOT NULL DEFAULT 0`.
- `ai_provider_capability_attestations`: immutable adapter/model capability evidence.
- `ai_provider_containment_attestations`: immutable hostile-probe evidence.
- `provider_attempt_events`: immutable write-ahead attempt evidence.
- `commit_ai_provider_acceptance_probe`: CAS RPC that stores fingerprint-bound acceptance attestations while administratively disabled and can never set Ready/available.
- `request_ai_provider_probe`: transaction that locks provider/runtime, converges concurrent observers on an active current generation, otherwise increments `probe_generation` and inserts `provider-probe:<providerId>:<settingsRevision>:<authGeneration>:<executionFingerprint>:<probeGeneration>`.
- `commit_ai_provider_probe`: CAS RPC that records a full enabled-provider probe and is the only issuer of a Ready lease; CAS includes probe generation.
- `apply_ai_provider_runtime_failure`: CAS RPC that applies the canonical failure matrix and optional model invalidation.
- `fence_ai_provider_auth`: RPC that disables availability and increments `auth_generation` before auth mutation.
- `activate_subscription_provider`: service-role/operator RPC that verifies current terms/profile/capability/containment evidence, enables exactly one accepted provider/model, clears stale runtime state, and atomically requests a new full probe generation.
- `deactivate_subscription_provider`: service-role RPC used by Disable/rollback to set provider/model unroutable and clear the lease without revoking auth.
- `expire_ai_provider_ready_lease`: CAS RPC that marks an observed expired lease unavailable and calls the same probe-generation transaction.
- `begin_ai_provider_attempt`: pre-spawn RPC that atomically verifies provider bindings plus both lease identities, allocates `attempt_sequence`, and appends `attempt_started`.
- `append_ai_provider_attempt_outcome`: RPC that appends exactly one normal/reconciliation outcome; a succeeded outcome also stages the schema-validated winner output/usage on the protected analysis row, never in the event.
- `finalize_ai_analysis_from_attempt`: idempotent RPC that verifies both leases and the staged successful attempt, assigns final provider/model/cost/output/usage, completes the logical analysis, and creates `ai_usage` exactly once.
- `reconcile_ai_provider_attempts`: RPC/repository operation that returns durable attempted-provider exclusions, reconciles orphan starts, and returns a staged successful winner before any new routing.
- `rearm_candidate_normalization`: row-locked RPC that advances `normalization_generation` and inserts one generation-keyed normalization job atomically.
- `PROBE_AI_PROVIDER_READINESS`: worker-owned queue job for a full subscription readiness refresh; `TEST_AI_PROVIDER_CONNECTION` requests status/probe only and never performs login or acceptance.
- `SubscriptionExecutionProfile`: immutable adapter execution, auth-home, credential-source, parser, accepted endpoint set, and systemd sandbox identity.
- `SubscriptionProcessTransport`: low-level bounded I/O/control client for `SystemdSubscriptionSandbox`; it never directly spawns a subscription executable.
- `CodexSubscriptionAdapter` and `GrokSubscriptionAdapter`: adapter-specific credentials, fixed arguments, parsing, capability, and error classification.
- `AdapterSemaphoreRegistry`: one current-process permit per subscription adapter.
- `NormalizationExecutionCoordinator`: durable routing, dual-epoch pre-spawn, attempt outcome, failure writeback, winner finalization, and bounded fallback owner.

## Canonical Failure Matrix

`append_ai_provider_attempt_outcome` records the evidence first; any listed runtime mutation must commit before fallback. `Replay` means same-provider replay for the same logical analysis.

| Failure class | Runtime writeback | Retry / attestation effect | Consumption | Replay | Cross-provider fallback | Logical outcome |
| --- | --- | --- | --- | --- | --- | --- |
| `auth_expired` | `expired`, unavailable, clear lease/retry | auth remediation + fresh probe; preserve evidence history | `unknown` if spawned, otherwise proven status | No if consumed/unknown | Yes after writeback | continue if eligible, else Waiting |
| `credential_source_mismatch` | `needs_attention`, unavailable | clear lease/retry; invalidate credential-source evidence | `not_consumed` only if pre-spawn proof, else `unknown` | Only one bounded retry when proven not consumed and remediated | No | Needs Attention |
| `binary_identity_mismatch` | `needs_attention`, unavailable | clear lease/retry; invalidate binary evidence | normally `not_consumed` | One bounded retry only after new accepted identity | No | Needs Attention |
| `profile_mismatch` | `needs_attention`, unavailable | clear lease/retry; invalidate profile/security evidence | normally `not_consumed` | One bounded retry only after new accepted profile | No | Needs Attention |
| `containment_failure` | `needs_attention`, unavailable | clear lease/retry; invalidate containment evidence | `unknown` if client started | No | No | Needs Attention |
| `capability_failure` | model unavailable; provider also `needs_attention` when framing/provider-level | invalidate affected capability evidence | `unknown` if provider called | No | No | Needs Attention |
| `capacity_exhausted` | preserve `ready`, unavailable | `retry_not_before` from 1–15 minute clamped Retry-After, default 5; new probe generation after delay | `consumed` or `unknown` | No | Yes after writeback | continue, else Waiting |
| `rate_limited` | preserve `ready`, unavailable | same clamped Retry-After rule | `consumed` or `unknown` | No | Yes after writeback | continue, else Waiting |
| `transient_network` | preserve `ready`, unavailable | deterministic 30s/1m/2m/5m backoff; fresh probe after delay | evidence-derived, default `unknown` after spawn | No when consumed/unknown | Yes after writeback | continue, else Waiting |
| `client_transient` | preserve `ready`, unavailable | same deterministic backoff | evidence-derived, default `unknown` after spawn | No when consumed/unknown | Yes after writeback | continue, else Waiting |
| `timeout` | preserve `ready`, unavailable | deterministic transient backoff and fresh probe | `unknown` unless affirmative provider evidence proves otherwise | No | Yes only after writeback; never on caller/job cancellation | continue, else Waiting |
| `cancelled_by_caller` | no provider-state mutation absent independent provider failure | terminate sandbox/cgroup | honest evidence, usually `unknown` after start | No when started | No | terminate request |
| `cancelled_by_job_lease_loss` | no provider-state mutation absent independent provider failure | terminate sandbox/cgroup; stale owner cannot write further | honest evidence, usually `unknown` after start | No when started | No | reclaim/reconcile only |
| `cancelled_by_shutdown` | no provider-state mutation absent independent provider failure | terminate sandbox/cgroup | honest evidence, usually `unknown` after start | No when started | No | reclaim/reconcile only |
| `unsafe_unknown` | `needs_attention`, unavailable | clear lease/retry | `unknown` | No | No | Needs Attention |
| `schema_invalid_output` | no runtime mutation unless independently classified capability failure | preserve current attestation unless explicit capability proof fails | `consumed` | No | No | Needs Attention |
| `business_validation_failure` | no runtime mutation | none | `consumed` | No | No | deterministic Reject/Needs Review |
| `process_spawn_failure_pre_consumption` | no runtime mutation | none | `not_consumed` with allowlisted supervisor proof | One bounded replacement | No | retry same provider once, else Waiting/Needs Attention |

Cancellation checkpoints are normative: cancellation while waiting for the semaphore or after acquisition but before `begin_ai_provider_attempt` creates no start event; cancellation after start commit but before sandbox start appends `attempt_not_consumed` only with durable supervisor proof; cancellation during sandbox execution terminates the whole cgroup and records `unknown` unless stronger provider evidence exists.

## Dependency Order

```text
019 schema, existing-row preflight, probe generation, and generated DB types
  -> shared/exhaustive kind and failure model
  -> runtime CAS, acceptance/activation, and repeatable probe-generation repository
  -> dual lease epochs, attempt transactions, staged winner, and finalization RPC
  -> concrete SystemdSubscriptionSandbox transport + semaphore
  -> Codex/Grok adapter infrastructure consuming that sandbox
  -> readiness/acceptance/containment orchestration
  -> normalization execution coordinator, winner finalization, and fallback
  -> legacy generation-zero normalization cutover + Waiting rearm
  -> settings API/UI without acceptance or Ready mutation
  -> regression/integration gates
  -> production installation/verification of the already-defined sandbox
  -> terms gate -> independent Codex/Grok acceptance -> activation -> fresh Ready probe -> controlled Plan 04 acceptance
```

Tasks 7–9 may use fake sandbox fixtures locally, but no production adapter process can execute until Task 14 installs and verifies the exact Task 5 unit templates/policy digest. Task 14 configures host prerequisites; it may not introduce or substitute a different isolation primitive.

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
- Produces: `adapter`, `normalization_generation`, runtime state with `probe_generation`, both attestation tables, attempt events, protected staged-winner fields, database constraints/triggers, and generated types consumed by Tasks 2–18.

- [ ] Write failing integration cases named `preserves a valid existing HTTP provider`, `preserves a valid legacy command provider`, `aborts on existing provider-model billing mismatch`, `aborts on a forbidden existing secret`, `aborts on cross-family config or adapter collision`, `accepts only the approved kind-adapter-billing matrix`, `keeps provider family immutable`, `keeps unproven subscription models disabled`, `rejects updates and deletes of provider attempt events`, and `rejects contradictory attempt outcomes`. Run `pnpm --filter @ara/db exec vitest run src/subscription-provider-schema.integration.test.ts`; expected RED is missing migration-019 columns/tables/preflight constraints.
- [ ] Begin migration 019 with deterministic `DO`-block preflight before any new validated constraint: preserve `openai_http` rows with optional secrets and HTTP-only config; preserve readable legacy `command` rows only when they have no secret and only command-family config; abort with sanitized provider IDs/counts on provider/model billing mismatch, command-owned secret, cross-family config, any pre-existing/future adapter key, unsupported kind, or a shape that would collide with one-row-per-adapter. Do not delete secrets, change billing, convert family, or silently disable data. The only deterministic additions are nullable `adapter`, candidate generation `0`, and runtime generation `0`.
- [ ] Extend kind CHECK to `subscription_command`; enforce kind/adapter/billing/secret/config matrix, one subscription row per adapter, provider/model billing agreement, subscription-model disabled-until-proof, and immutable family with validated constraints/triggers after preflight. Mixed-version old readers continue to read valid HTTP/legacy rows; unknown new kind remains worker-fail-closed.
- [ ] Add `candidates.normalization_generation bigint NOT NULL DEFAULT 0 CHECK (normalization_generation >= 0)`; do not alter initial enqueue behavior before migration 022 cutover.
- [ ] Create `ai_provider_runtime_state` with spec Section 11 fields plus `probe_generation bigint NOT NULL DEFAULT 0 CHECK (probe_generation >= 0)`, current probe job/reference metadata, and service-role-only RLS. Create immutable capability/containment attestation tables without raw prompt/output/auth columns.
- [ ] Create `provider_attempt_events` with dual lease owner/epoch context, bindings, safe metadata, usage, and consumption status. Enforce one start per attempt, unique `(logical_analysis_id, attempt_sequence)` on starts, one partial unique outcome across all outcome types, legal event/status combinations, and append-only update/delete rejection.
- [ ] Add protected nullable `ai_analyses.pending_winner_attempt_id`, `pending_output`, and `pending_usage` staging fields. Only migration-021 RPCs may write them; attempt events remain free of output.
- [ ] Regenerate DB types and register the integration file. Run `pnpm --filter @ara/db exec vitest run src/subscription-provider-schema.integration.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && git diff --check`; expected GREEN is all migration/preflight/immutability cases passing. Commit only Task 1 files as `db: add subscription provider execution schema`.

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

- [ ] Write failing tests named `parses only canonical subscription failure classes`, `parses only codex and grok subscription adapters`, `requires subscription kind adapter and subscription billing`, `includes auth security and sandbox bindings in subscription fingerprints`, `maps adapter runtime and probe generation from repository rows`, and `never sends an unknown kind through CommandProvider`. Run `pnpm --filter @ara/shared exec vitest run src/ai.test.ts && pnpm --filter @ara/db exec vitest run src/provider-repository.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/provider-catalog.test.ts`; expected RED is missing schemas/exhaustive branches.
- [ ] Extend `ProviderKindSchema`; add/export the canonical adapter, runtime, attempt, consumption, expanded failure, dual-lease identity, and probe-generation schemas/types. Define a discriminated subscription config accepting only fixed role `niche_normalization` plus product-visible model/priority state and no executable, argv, auth-home, base URL, API key, or command profile.
- [ ] Replace family-agnostic fingerprint scanning with exhaustive family functions. Subscription fingerprint requires adapter, absolute binary digest/version, execution-profile ID, systemd unit/policy digest, dedicated auth-home identity, auth generation, settings revision, security/readiness versions, endpoint allowlist digest, containment binding, capability binding, and terms digest; preserve identical HTTP fingerprints.
- [ ] Extend repository mapping for `adapter` and `probe_generation`; remove implicit `openai_http else command`. Unknown kind/adapter yields `ProviderCatalogError` and unavailable omission, never legacy `CommandProvider` construction.
- [ ] Add a temporary explicit `subscription_command` catalog branch that is unavailable and cannot construct a sandbox process until Tasks 5, 7–9, and production Task 14 evidence match.
- [ ] Run `pnpm --filter @ara/shared exec vitest run src/ai.test.ts && pnpm --filter @ara/db exec vitest run src/provider-repository.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/provider-catalog.test.ts && pnpm --filter @ara/shared test && pnpm --filter @ara/db test && pnpm --filter @ara/worker test && pnpm --filter @ara/shared typecheck && pnpm --filter @ara/db typecheck && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is exhaustive parsing/fail-closed dispatch. Commit `refactor: make AI provider dispatch exhaustive`.


## Task 3: Implement authoritative runtime state, repeatable probes, and activation CAS

**Spec:** Sections 4–5, 10–14, 16–17, 21, 25, 27.

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
- Consumes: migration 019 runtime/attestation schema, provider settings revisions, canonical constants/failure matrix.
- Produces: `ProviderRuntimeRepository`, `commit_ai_provider_acceptance_probe`, `request_ai_provider_probe`, `commit_ai_provider_probe`, `apply_ai_provider_runtime_failure`, `fence_ai_provider_auth`, `activate_subscription_provider`, `deactivate_subscription_provider`, `expire_ai_provider_ready_lease`, and routability reads.

- [ ] Write failing cases for 9:59 versus 10:00 lease boundary, DB-clock issuance, stale settings/auth/fingerprint/probe-generation CAS, first and second probes with unchanged bindings, concurrent expiry dedupe, retry-delay refresh, acceptance-while-disabled, activation without/stale evidence rejection, activation/auth-generation race, activation/settings-change race, activation scheduling a fresh probe, unavailable-until-full-probe, deactivation fencing, every canonical failure-matrix row, and stale-lease probe dedupe. Run `pnpm --filter @ara/db exec vitest run src/provider-runtime-repository.test.ts src/provider-runtime.integration.test.ts`; expected RED is missing migration-020 RPCs and repeatable generation behavior.
- [ ] Implement `request_ai_provider_probe` as one transaction: lock provider/runtime; reject changed expected bindings; if the latest generation has a queued/running matching probe return it; otherwise increment `probe_generation` and insert `provider-probe:<provider>:<settings>:<auth>:<fingerprint>:<generation>`. Completed/failed older jobs never block a later generation. Use it for lease expiry, elapsed retry, activation, reauthorization, explicit Test/Probe, and profile/policy change.
- [ ] Implement `commit_ai_provider_acceptance_probe` for administratively disabled providers. It CAS-validates settings/auth/fingerprint/sandbox evidence and persists immutable terms/capability/containment/credential/binary attestations, but cannot write `ready`, `available`, lease, or enable flags.
- [ ] Implement `activate_subscription_provider` as service-role/operator-only: lock provider/model/runtime; verify current disabled row, accepted terms and exact fingerprint-bound binary/auth/capability/containment evidence; reject any concurrent settings/auth change; enable exactly the accepted provider/model; clear runtime lease/retry/availability; and call the same probe-generation transaction atomically. Implement `deactivate_subscription_provider` to disable provider/model, clear Ready/retry, invalidate the active probe generation, and leave credentials intact.
- [ ] Implement `commit_ai_provider_probe` so only the worker service role can issue Ready for an enabled provider/model. Require exact current settings/auth/fingerprint/security/terms/attestation/probe-generation bindings, write DB `checked_at` and exactly ten minutes, reset retry/transient state, and reject older generation completion. Failed probes issue no lease and apply the canonical matrix.
- [ ] Implement `apply_ai_provider_runtime_failure` exactly from the canonical table, including timeout unknown-consumption handling and no runtime mutation/no fallback for cancellation/schema/business cases. Implement `fence_ai_provider_auth` and `expire_ai_provider_ready_lease`; expiry marks stale and requests one new generation, never auto-Ready.
- [ ] Expose strict repository methods only; remove subscription use of `config.executionProbe`/`recordExecutionProbe` while retaining explicit HTTP-only behavior.
- [ ] Regenerate types and register tests. Run `pnpm --filter @ara/db exec vitest run src/provider-runtime-repository.test.ts src/provider-runtime.integration.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && git diff --check`; expected GREEN is repeatable probe, activation, lease, CAS, and failure-matrix coverage. Commit `db: enforce subscription provider runtime leases`.

## Task 4: Add dual-epoch pre-spawn, immutable attempts, and winner finalization

**Spec:** Sections 17, 19–20, 27; residual finding R2.

**Files**
- Create: `supabase/migrations/202608290021_provider_attempt_transactions.sql`
- Create: `packages/db/src/provider-attempt-repository.ts`
- Create: `packages/db/src/provider-attempt-repository.test.ts`
- Create: `packages/db/src/provider-attempts.integration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/queue/src/queue.ts`
- Modify: `packages/queue/src/queue.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`
- Modify: `apps/worker/src/handlers.ts`
- Modify: `package.json`
- Test: provider-attempt, queue, and worker ownership files

**Interfaces**
- Consumes: provider/runtime/attestation schema, `jobs.attempts` claim epoch, `ai_analyses.attempts` claim epoch.
- Produces: epoch-aware queue/analysis RPCs, `begin_ai_provider_attempt`, `append_ai_provider_attempt_outcome`, `finalize_ai_analysis_from_attempt`, `reconcile_ai_provider_attempts`, `ProviderAttemptRepository`, and `AttemptAuthorization`.

- [ ] Write failing tests for old epoch rejected/new accepted, same worker ID old epoch rejected, reclaimed analysis unable to finalize, old job epoch unable to start, all pre-spawn provider/runtime predicates, concurrent sequence allocation, failed start persistence blocking sandbox callback, one outcome race, staged winner recovery, and exactly-once usage finalization. Run `pnpm --filter @ara/db exec vitest run src/provider-attempt-repository.test.ts src/provider-attempts.integration.test.ts && pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/main.test.ts`; expected RED is missing epoch-aware RPCs and winner-finalization API.
- [ ] In migration 021 replace claim/heartbeat/checkpoint/complete/fail job and analysis RPC signatures so claim returns the incremented positive epoch and every ownership-sensitive mutation checks row ID, owner, epoch, expected status, and unexpired lease. Carry `JobLeaseIdentity` in `Job`/handler context and `AnalysisLeaseIdentity` from analysis claim through coordinator; stale same-owner processes must fail.
- [ ] Implement `begin_ai_provider_attempt` as one transaction. Lock analysis, job, provider/runtime; assert both lease identities, enabled/routable DB-clock state, no retry, all settings/auth/fingerprint/probe/capability/security/containment/terms bindings, model ownership/billing, no-PAYG, and logical ownership; allocate sequence and commit `attempt_started` before returning authorization. HTTP records evidence without a subscription runtime row; legacy command remains non-production only.
- [ ] Implement `append_ai_provider_attempt_outcome` with strict event/result/consumption combinations and both current lease identities. `attempt_not_consumed` accepts only durable `spawn_rejected_before_child`, `sandbox_not_started`, `profile_verification_failed_before_spawn`, or `semaphore_cancelled_before_authorization` proof. On success, the same transaction appends `attempt_succeeded` and writes schema-validated `pending_winner_attempt_id`, `pending_output`, and `pending_usage` on the protected analysis row; event projections never contain output.
- [ ] Implement `finalize_ai_analysis_from_attempt` idempotently: lock job/analysis and verify owner+epoch+lease, same logical analysis, staged winner, successful attempt outcome, provider/model/cost agreement, and no conflicting completion; atomically set final provider/model/cost/output/usage, complete analysis, clear staging, and insert `ai_usage` exactly once. Repeating the same winner returns the completed row; a different winner conflicts; no-winner paths never fabricate attribution.
- [ ] Implement reconciliation so a staged successful winner is returned before routing. If a worker dies after success outcome but before logical finalization, the reclaimer calls `finalize_ai_analysis_from_attempt` for that winner, never reruns/falls back. Bare starts become unknown unless affirmative durable no-consumption proof exists; outcome/finalization race losers reload the winner.
- [ ] Verify event projections omit prompt/raw stdout/stderr/auth/env/secrets/subscription USD and that runtime writeback tied to an execution also requires both epochs. Run `pnpm --filter @ara/db exec vitest run src/provider-attempt-repository.test.ts src/provider-attempts.integration.test.ts && pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/main.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && pnpm --filter @ara/queue test && pnpm --filter @ara/queue typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is dual-epoch exclusion, atomic start, single outcome, and winner finalization. Commit `db: authorize and audit provider attempts atomically`.

## Task 5: Implement the bounded SystemdSubscriptionSandbox transport

**Spec:** Sections 6–9, 30.

**Files**
- Create: `packages/ai-router/src/providers/subscription-process.ts`
- Create: `packages/ai-router/src/providers/subscription-process.test.ts`
- Create: `packages/ai-router/src/providers/subscription-errors.ts`
- Create: `apps/worker/src/providers/systemd-subscription-sandbox.ts`
- Create: `apps/worker/src/providers/systemd-subscription-sandbox.test.ts`
- Create: `ops/systemd/amazon-research-codex@.service`
- Create: `ops/systemd/amazon-research-grok@.service`
- Create: `ops/polkit/50-amazon-research-subscription.rules`
- Modify: `packages/ai-router/src/providers/command.ts`
- Create: `ops/nftables/amazon-research-subscription.nft`
- Modify: `packages/ai-router/src/providers/command.test.ts`
- Modify: `packages/ai-router/src/index.ts`
- Test: process, sandbox-control, unit-template, and legacy command tests

**Interfaces**
- Consumes: safe termination/bounds helpers from `CommandProvider` and Ubuntu 24.04 systemd 255/cgroup-v2/nftables capabilities.
- Produces: `SystemdSubscriptionSandbox`, `SubscriptionProcessTransport.run(profile, invocation, signal)`, immutable unit/policy digests, bounded stream events, and unchanged test-only `CommandProvider` behavior.

- [ ] Write failing tests for fixed adapter/unit selection, UUID-only instance, no direct client `spawn`, absolute binary/profile verification, empty environment, fresh runtime workspace, combined output cap, parser frame cap, stdin transport, timeout/abort, `systemctl kill --kill-who=all`, cleanup, and no unit start after verification failure. Add policy-fixture tests proving repo/worker.env/home/SSH/Hermes denial, auth-home/workspace-only writes, shell/tool executable denial, and nftables rules that allow only the configured resolver on TCP/UDP 53 plus accepted endpoint prefixes on TCP 443 for the dedicated UID. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/subscription-process.test.ts src/providers/command.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/systemd-subscription-sandbox.test.ts`; expected RED is missing sandbox contract/artifacts.
- [ ] Define the production primitive now: root-owned fixed templates `amazon-research-codex@.service` and `amazon-research-grok@.service`, dedicated non-login `ara-codex`/`ara-grok` UIDs, adapter-specific 0700 auth homes under `/var/lib/amazon-research/subscription/<adapter>`, per-invocation `/run/amazon-research-subscription/<adapter>/<uuid>` IPC workspace, and a polkit rule allowing `amazon-research` only start/stop/kill/status of those UUID instances. No transient property, executable, argv, path, UID, environment, or firewall value is caller-controlled.
- [ ] Encode the immutable unit policy: `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, explicit `InaccessiblePaths=/opt/amazon-research/current /etc/amazon-research /home /root`, `ReadWritePaths` only the adapter auth home and invocation workspace, `NoExecPaths=/` plus exact accepted client/runtime `ExecPaths`, empty environment with fixed HOME/TMPDIR/locale only, `NoNewPrivileges=yes`, empty capabilities, namespace/kernel/personality protections, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `TasksMax`, memory/CPU/file-size limits, `KillMode=control-group`, hard-kill escalation, and no executable shell/tool path. Root-owned accepted-profile drop-ins contain fixed client args and digest-pinned executable identity.
- [ ] Enforce endpoint-only egress in the root-owned nftables `inet` OUTPUT chain keyed by the dedicated adapter UID: accept loopback IPC only where required; accept TCP/UDP 53 only to the configured local resolver IPs; accept TCP 443 only to root-resolved accepted provider/auth endpoint prefixes; reject every other packet from that UID. Also set systemd `IPAddressDeny=any`/matching `IPAddressAllow` as defense in depth. Bind ruleset text, resolved prefixes, resolver addresses, endpoint hostnames, unit text, UID, executable set, auth-home identity, and host nftables/cgroup capability into the security-profile digest. DNS/IP drift, ruleset mismatch, or unverifiable enforcement invalidates the profile; never broaden egress to obtain a pass.
- [ ] Implement `SystemdSubscriptionSandbox` as the only production controller: create safe IPC artifacts, verify root-owned unit/polkit/nftables/profile digests and live ruleset, start fixed unit, stream bounded output, monitor unit/cgroup state, kill the whole cgroup on output cap/timeout/cancel, classify whether the service ever reached `ExecStart`, and remove artifacts without following symlinks. `SubscriptionProcessTransport` accepts only a module-private immutable profile and this controller; adapter parsing remains outside it.
- [ ] Preserve legacy `CommandProvider` behavior and its 2 MiB-per-stream contract while reusing only safe generic bounds/termination helpers. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/subscription-process.test.ts src/providers/command.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/systemd-subscription-sandbox.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/ai-router lint && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN is bounded sandbox control and unchanged command behavior. Commit `refactor: add systemd subscription sandbox transport`.

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

- [ ] Write failing tests that two Codex calls serialize, Codex and Grok may each hold one permit, queued cancellation never runs work or creates an attempt, and permits release after success/error/timeout/cancellation. Run `pnpm --filter @ara/worker exec vitest run src/providers/adapter-semaphore.test.ts src/main.test.ts`; expected RED is missing registry/injection.
- [ ] Implement a FIFO, abort-aware semaphore with one permit keyed by adapter. Construct one registry in `main()` and inject it; never instantiate per job. Subscription routing fails startup/config validation when worker-process count exceeds one or distributed coordination is absent.
- [ ] Preserve order: existing job/analysis claims with epochs → route → acquire semaphore → recheck cancellation → `begin_ai_provider_attempt` with both leases/bindings → commit start → sandbox start → outcome → runtime CAS → fallback/finalization → release in `finally`.
- [ ] Run `pnpm --filter @ara/worker exec vitest run src/providers/adapter-semaphore.test.ts src/main.test.ts && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN is serialization/cancellation/release behavior. Commit `worker: serialize subscription adapters`.


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

- [ ] Write failing tests for profile immutability, exact systemd sandbox/policy digest, binary owner/mode/version/digest mismatch, dedicated auth home, empty environment, fixed model/args, strict envelope/trailing-data rejection, timeout/cancel, and every Codex-relevant canonical failure class. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/codex-subscription.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/providers/subscription-auth-home.test.ts`; expected RED is missing Codex profile/adapter.
- [ ] Implement binary/credential-source/endpoint/auth inspection, capability/health probe, fixed args, stream framing, schema parsing, and canonical classification. No API key/raw token/endpoint/provider override is accepted. `CodexSubscriptionAdapter` can invoke only `SubscriptionProcessTransport` backed by `SystemdSubscriptionSandbox`.
- [ ] Define the committed Codex manifest `activation: 'disabled'` with exact accepted sandbox policy identity. Auth-home ownership/symlink checks use dedicated `ara-codex`; paths/credentials never reach browser/logs/PostgreSQL. Unknown live-client switches or isolation mechanisms keep construction unavailable.
- [ ] Run `pnpm --filter @ara/ai-router exec vitest run src/providers/codex-subscription.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/providers/subscription-auth-home.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/ai-router lint && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN uses fake sandbox fixtures only. Commit `feat: add gated Codex subscription adapter`.


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

- [ ] Write failing Grok-specific tests for OAuth source, API-key/custom-endpoint rejection, independent UID/auth home/sandbox digest, fixed identity/model, strict envelope, timeout/cancel, canonical failure classes, and proof Codex evidence cannot activate Grok. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/grok-subscription.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts`; expected RED is missing independent Grok adapter/profile.
- [ ] Implement Grok-owned credential inspection, fixed args, parser, capability mapping, and classifier through `SystemdSubscriptionSandbox`; do not subclass Codex semantics or reuse attestations. Add independent disabled manifest bound to `ara-grok`, Grok unit/policy digest, and dedicated auth home.
- [ ] Unsupported installation/auth/headless/model/isolation returns Setup Required. Reject xAI API keys, inherited endpoints, raw tokens, and provider overrides.
- [ ] Run `pnpm --filter @ara/ai-router exec vitest run src/providers/grok-subscription.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/ai-router lint && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN uses fake sandbox fixtures only. Commit `feat: add gated Grok subscription adapter`.


## Task 9: Orchestrate acceptance and repeatable readiness probes

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
- Consumes: adapter inspection, concrete sandbox, runtime CAS/probe-generation repository, semaphore, queue.
- Produces: disabled acceptance-probe path, `PROBE_AI_PROVIDER_READINESS`, hostile sandbox probe, generation-aware scheduling, and runtime-backed eligibility.

- [ ] Write failing tests that disabled acceptance persists evidence but cannot route/Ready, full readiness requires every binding, first/second same-binding probe generations both run, concurrent observers dedupe, old generation/settings/auth completions lose CAS, activation/auth race rejects, retry expiry requests new generation, one hostile failure prevents evidence, and Test cannot login/accept/Ready. Run `pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/probe-ai-provider-readiness.test.ts src/providers/containment-probe.test.ts src/providers/provider-catalog.test.ts`; expected RED is missing jobs/orchestration.
- [ ] Add generation-bearing payload and key to `PROBE_AI_PROVIDER_READINESS`. All scheduling calls `request_ai_provider_probe`; handlers reject payload generation/bindings that no longer equal runtime state.
- [ ] Implement disabled Stage-A acceptance in Tasks 16–17 through the same adapter/sandbox probe harness but `commit_ai_provider_acceptance_probe`; it can persist attestations only. Implement enabled full readiness: snapshot → semaphore → cancellation check → profile/binary/auth/source → capability → hostile sandbox → evidence digests → current-generation `commit_ai_provider_probe`.
- [ ] Hostile fixtures attempt production/env/home/SSH/Hermes reads, external writes, shell/subprocess/tool execution, arbitrary network, MCP/hooks/rules/config/session/memory/subagents/provider override, artifact persistence, and cross-invocation observation. Fake sandbox tests validate detection; Task 14 installs identical policy; Tasks 16–17 prove actual Oracle denial.
- [ ] Catalog includes subscription entries only for active accepted profile plus current runtime/model evidence and DB lease; stale evidence is unavailable and requests a new generation. HTTP connection-test behavior remains unchanged; subscription Test only returns sanitized state and requests a generation.
- [ ] Run `pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/probe-ai-provider-readiness.test.ts src/providers/containment-probe.test.ts src/providers/provider-catalog.test.ts && pnpm --filter @ara/queue test && pnpm --filter @ara/queue typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN is disabled acceptance, repeatable probes, hostile denial harness, and stale CAS. Commit `worker: own subscription readiness attestations`.

## Task 10: Implement durable normalization attempts, winner finalization, fallback, and recovery

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
- Consumes: both lease identities, catalog/runtime bindings, attempt/finalization repository, semaphore, sandboxed adapters, existing analysis ownership.
- Produces: `NormalizationExecutionCoordinator.execute`, staged-winner recovery/finalization, durable exclusions, canonical fallback, and clean-cutover execution.

- [ ] Write failing tests for exact mode comparators, PAYG prefilter, three distinct external attempts, durable exclusions, one proven-not-consumed replacement, every failure-matrix fallback decision, no fallback on caller/job/shutdown cancellation, Codex fail→Grok success, HTTP fail→Codex success, all-fail no-winner attribution, success-outcome crash before finalization, idempotent winner finalization, and all-provider exhaustion. Run `pnpm --filter @ara/ai-router exec vitest run src/router.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/normalization-execution-coordinator.test.ts src/providers/normalization-execution-coordinator.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts`; expected RED is missing coordinator/finalization behavior.
- [ ] Keep router a pure ranker over persisted eligibility/exclusions. Coordinator order is exact: claimed job+analysis epochs → reconcile history/staged winner → finalize winner or route → acquire adapter semaphore → recheck cancellation → `begin_ai_provider_attempt` with both leases/bindings → commit start → only then sandbox start → append outcome/stage winner → runtime CAS → finalize or allowed fallback → release semaphore in `finally`.
- [ ] Implement cancellation semantics from the canonical matrix at all four checkpoints. Failure writeback commits before fallback. Schema/business/unsafe/containment/capability failures do not cross providers; timeout may cross only after honest unknown-consumption evidence and runtime writeback; same provider remains excluded.
- [ ] Preserve one analysis/input hash. On successful outcome call `finalize_ai_analysis_from_attempt`; final provider/model/cost/usage are the winner. On reclaim, a staged successful winner finalizes before any routing, never reruns or falls back. Failed/unknown attempts remain immutable and no subscription USD is inserted.
- [ ] Replace production `NormalizeJobDependencies.provider/modelId` with coordinator and pass both lease identities from handler context/analysis claim. Remove obsolete capacity special case. No eligible provider durably fails/defers the same analysis/candidate without replay.
- [ ] Run `pnpm --filter @ara/ai-router exec vitest run src/router.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/normalization-execution-coordinator.test.ts src/providers/normalization-execution-coordinator.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is exact ranking, dual-epoch start, canonical fallback, and winner attribution/recovery. Commit `worker: add crash-safe provider fallback`.

## Task 11: Normalize legacy generation zero and rearm Waiting atomically

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
- Test: rearm, legacy cutover, daily, Research Now, and readiness tests

**Interfaces**
- Consumes: migration-019 generation, runtime eligibility, analysis/job ownership, legacy `normalize:<candidateId>` jobs.
- Produces: one-time legacy-key normalization, `rearm_candidate_normalization`, repository method, and deterministic generation keys.

- [ ] Write failing cases for legacy queued/running/completed/failed jobs, AI Screening/Waiting/advanced candidates, old-worker enqueue racing migration, duplicate legacy+`:0` collision abort, current usable provider, active ownership exclusion, concurrent rearm callers, failed insert rollback, reclaim generation preservation, and normalization before Market Probe. Run `pnpm --filter @ara/db exec vitest run src/normalization-rearm.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/daily-research.integration.test.ts && pnpm --filter @ara/web exec vitest run app/api/research-now/route.test.ts`; expected RED is missing migration-022 compatibility/RPC.
- [ ] Require a rollout fence before migration 022: deploy worker code that recognizes both legacy and canonical generation-zero identities but continues writing legacy keys; pause daily/Research Now normalization enqueue; verify no running generation-zero enqueue transaction; apply 022; then enable canonical writers. Old workers must be stopped before the key rewrite, preventing a post-migration legacy insert.
- [ ] In migration 022 lock matching jobs/candidates and deterministically rewrite every exact legacy key `normalize:<uuid>` to `normalize:<uuid>:0`, add `normalizationGeneration: 0` to payload, and preserve job ID/status/lease/attempt/checkpoint/history. Abort with sanitized IDs on malformed payload, nonmatching candidate, or simultaneous legacy and canonical key; never delete/merge history. AI Screening generation remains 0; Waiting candidates retain generation 0 until successful rearm; advanced candidates/jobs remain historical and non-executable by state checks.
- [ ] Implement `rearm_candidate_normalization` as one service-role transaction: lock candidate, analysis/job/runtime rows; verify expected state/generation and current routability; require no active ownership; calculate next generation; insert one queued `normalize:<id>:<next>` job; update generation only after insert; duplicate callers return that job.
- [ ] Switch initial scheduling to `normalize:<id>:0` only after migration fence. Extend daily/provider-ready/Research Now Waiting paths to the same RPC. Add `normalizationGeneration` to payload and verify it plus both lease identities on claim/reclaim; no rearm writes Ready-for-API state.
- [ ] Run `pnpm --filter @ara/db exec vitest run src/normalization-rearm.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/daily-research.integration.test.ts && pnpm --filter @ara/web exec vitest run app/api/research-now/route.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/web test && pnpm --filter @ara/web typecheck && git diff --check`; expected GREEN proves single generation-zero identity and atomic rearm. Commit `feat: rearm waiting normalization atomically`.

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

- [ ] Write failing API/UI tests for exact labels, mapping, fixed role, no secret, one row, family immutability, disabled acceptance/setup status, no implementation inputs, no browser acceptance/activation/Ready mutation, and Disable using deactivation. Run `pnpm --filter @ara/web exec vitest run app/api/ai-providers/route.test.ts app/api/ai-providers/test/route.test.ts components/ai-provider-form.test.ts`; expected RED is missing product mapping/projection.
- [ ] Replace raw kind selector with `codex_subscription | grok_subscription | openai_compatible_api`; server maps canonical matrix and rejects subscription executable/args/profile/auth-home/endpoint/key/acceptance/Ready inputs.
- [ ] HTTP alone keeps key/base URL/discovery. Subscription creation always persists administratively disabled provider/model rows and no secret. UI/API never performs `activate_subscription_provider`; Task 16/17 operator workflow owns activation after evidence.
- [ ] Project authoritative status/guidance and Disable. Disable calls `deactivate_subscription_provider`, immediately fences routing, and does not revoke credentials. Do not add Delete.
- [ ] Preserve mode explanations and HTTP cost disclosure; subscription Test only requests a new probe generation/status and never logs in, accepts, activates, or issues Ready.
- [ ] Run `pnpm --filter @ara/web exec vitest run app/api/ai-providers/route.test.ts app/api/ai-providers/test/route.test.ts components/ai-provider-form.test.ts && pnpm --filter @ara/web test && pnpm --filter @ara/web test:e2e && pnpm --filter @ara/web typecheck && pnpm --filter @ara/web lint && git diff --check`; expected GREEN is safe product UI and fenced Disable. Commit `feat: expose subscription providers safely`.


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

- [ ] Write regression cases `preserves encrypted HTTP provider behavior`, `fails closed on unknown mixed-version provider kinds`, `audits Codex unknown then Grok success without fake USD`, `finalizes HTTP failure then Codex winner`, and `reclaims staged winner without replay`. Run `pnpm --filter @ara/secret-store exec vitest run src/index.test.ts && pnpm --filter @ara/ai-router exec vitest run src/providers/openai-http.test.ts src/router.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/provider-url-policy.test.ts src/providers/pinned-http-provider.test.ts src/providers/provider-catalog.integration.test.ts src/providers/normalization-execution-coordinator.integration.test.ts && pnpm --filter @ara/web exec vitest run app/api/ai-providers/settings-catalog.integration.test.ts`; expected RED is any missing cross-provider/finalization behavior.
- [ ] Preserve/write named coverage for secrets, blank key, SSRF/HTTPS/DNS/IP/metadata/Host/SNI/bounds, HTTP probe ownership, provider/model ownership, billing, no PAYG, and unknown-kind fail-closed.
- [ ] Verify immutable attempt chains, final winner analysis/usage, staged-success recovery, no duplicate execution, and no subscription USD for Codex→Grok and HTTP→Codex.
- [ ] Apply only minimal regression fixes, then run the focused command above to GREEN.
- [ ] Run `pnpm exec turbo run test --force && pnpm exec turbo run typecheck --force && pnpm exec turbo run lint --force && pnpm exec turbo run build --force && pnpm --filter @ara/web test:e2e && pnpm run test:integration && git diff --check`; expected GREEN is the authoritative local suite. Record exact counts/gaps and commit `test: verify mixed AI provider behavior`.


## Task 14: Install and verify the defined sandbox, rollout, and rollback tooling

**Spec:** Sections 7–8, 13–14, 18, 25–30.

**Files**
- Create: `scripts/probe-subscription-provider.mjs`
- Create: `scripts/probe-subscription-provider.test.mjs`
- Create: `ops/subscription-providers/install-systemd-sandbox.sh`
- Create: `ops/subscription-providers/install-auth-homes.sh`
- Create: `ops/subscription-providers/verify-runtime-profile.sh`
- Create: `docs/deployment/subscription-providers.md`
- Modify: `docs/deployment/oracle.md`
- Modify: `docs/verification/ai-provider-probes.md`
- Modify: `ops/systemd/amazon-research-worker.service`
- Test: script tests, shell syntax, systemd/polkit/cgroup/BPF verification on Oracle

**Interfaces**
- Consumes: exact Task-5 systemd templates/polkit contract, disabled manifests, probe harness, current Oracle service.
- Produces: installed dedicated UIDs/auth homes/templates/profile drop-ins/endpoint policy, repeatable evidence, staged rollout, and rollback procedure; it cannot substitute another primitive.

- [ ] Write failing fixture tests for wrong systemd version/cgroup mode/nftables support, user/owner/mode/path/digest, shared auth home, mutable unit/drop-in/ruleset, env leakage, forbidden fs/exec/network access, artifact persistence, resolver/endpoint drift, and changed bindings. Run `node --test scripts/probe-subscription-provider.test.mjs`; expected RED is missing installation/verification tooling.
- [ ] Implement root-run installation for Ubuntu 24.04 requirements: systemd >=255, unified cgroup v2, nftables, polkit, dedicated non-login `ara-codex`/`ara-grok`, 0700 auth homes, per-adapter IPC groups, 0700 invocation roots, root-owned Task-5 unit templates/polkit/nftables policy, fixed accepted-profile drop-ins, configured resolver IPs, and resolved endpoint prefix sets. Refuse unsupported host capability, human/Hermes/shared homes, symlinks, repo-relative paths, mutable artifacts, missing UID/IP/port reject rules, or broad egress; print no secrets.
- [ ] Probe CLI invokes the same fixed unit/profile and hostile harness, emits bounded sanitized JSON, and exits nonzero for every missing category. Verify `systemd-analyze verify`, `systemd-analyze security`, unit/polkit/nftables hashes, live `nft list ruleset` semantic match, service UID, cgroup containment, resolver-only 53, accepted-prefix-only 443, denial to non-allowlisted IP and alternate port, process cleanup, and auth persistence. Any failed denial or endpoint drift blocks activation.
- [ ] Harden the worker service without granting arbitrary unit control. Document rollout: migration 019–021 → fail-closed worker → HTTP verification → Task-5 sandbox install → auth/acceptance evidence while disabled → `activate_subscription_provider` → new probe generation/current Ready → web display → migration-022 enqueue fence/cutover → routing/recovery. Web never precedes compatible worker.
- [ ] Document rollback: `deactivate_subscription_provider`, stop/kill adapter cgroups, settle attempts, increment auth generation when auth changes, choose preserve versus supported revoke, retain events/staged winner, stop canonical enqueue before generation-key rollback considerations, verify old-worker-compatible rows, roll back app, schema narrowing last.
- [ ] Run `node --test scripts/probe-subscription-provider.test.mjs && node --check scripts/probe-subscription-provider.mjs && bash -n ops/subscription-providers/install-systemd-sandbox.sh && bash -n ops/subscription-providers/install-auth-homes.sh && bash -n ops/subscription-providers/verify-runtime-profile.sh && git diff --check`; expected local GREEN validates fixtures/syntax. On Oracle additionally require `systemd-analyze verify ops/systemd/amazon-research-codex@.service ops/systemd/amazon-research-grok@.service ops/systemd/amazon-research-worker.service` plus documented hostile/status commands before acceptance. Commit `ops: prepare subscription provider acceptance`.

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

- [ ] Write tests `rejects profiles without approved terms evidence` and `accepts only the matching adapter terms digest`. Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts`; expected RED is the disabled acceptance path lacking a terms digest, while fail-closed rejection remains GREEN.
- [ ] Record official/written evidence metadata without credentials; evaluate adapters independently. Ambiguity is FAIL.
- [ ] On PASS bind only that adapter’s terms digest/version into its disabled manifest/fingerprint; on FAIL keep disabled and stop that live gate. Terms PASS alone cannot activate or issue Ready.
- [ ] Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is matching-digest acceptance or explicit unroutability. Commit `docs: record subscription automation terms gate`.


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

- [ ] Write tests `accepts Codex evidence while disabled but cannot route`, `rejects Codex activation before current Oracle evidence`, `rejects activation after concurrent auth/settings change`, and `routes Codex only after activation plus matching new-generation Ready`. Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts`; expected RED is missing accepted evidence/activation sequence.
- [ ] Verify exact Oracle identity/profile/auth persistence without secrets. Fence/increment auth generation before supported operator authorization as `ara-codex`; never import external credentials.
- [ ] Prove effective subscription source/endpoint, fixed model/framing, timeout/cancel/bounds, and every hostile sandbox denial with the installed Task-5/14 unit. Any unproven category is FAIL.
- [ ] While provider/model remain disabled, run acceptance probe and `commit_ai_provider_acceptance_probe`; confirm it cannot issue Ready. If every item passes, update only exact accepted identities, deploy compatible worker, invoke `activate_subscription_provider` as reviewed service-role operator, verify it enables only accepted rows and schedules generation N, then run full readiness and verify DB-clock Ready. Concurrent auth/settings change rejects activation or generation-N completion and requires N+1.
- [ ] On failure keep Codex disabled/unroutable. Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts src/providers/normalization-execution-coordinator.test.ts && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is full sequence or explicit fail-closed result. Commit `ops: record Codex subscription acceptance`.


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

- [ ] Write tests `accepts Grok evidence while disabled but cannot route`, `rejects Grok activation before independent Oracle evidence`, `rejects activation after concurrent auth/settings change`, and `routes Grok only after activation plus matching new-generation Ready`. Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts`; expected RED is missing independent evidence/activation sequence.
- [ ] Verify Grok binary/profile/auth/headless/restart behavior independently. Fence/increment Grok auth generation before supported operator OAuth as `ara-grok`; reject API key/custom endpoint/raw token/browser cookie/inherited credentials.
- [ ] Prove OAuth source/endpoint, model/framing, timeout/cancel/bounds/classifier, and all hostile sandbox categories with the installed Grok unit.
- [ ] Persist acceptance while disabled; if every item passes, update only Grok accepted identities, deploy compatible worker, invoke `activate_subscription_provider`, verify generation N and fresh Ready. Concurrent binding change rejects stale activation/completion and requests a newer generation. Otherwise leave Setup Required/unroutable.
- [ ] Run `pnpm --filter @ara/worker exec vitest run src/providers/subscription-profiles.test.ts src/jobs/probe-ai-provider-readiness.test.ts src/providers/normalization-execution-coordinator.test.ts && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is independent sequence or explicit fail-closed result. Commit `ops: record Grok subscription acceptance`.


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

- [ ] Write verifier tests `rejects manual candidate state hacks`, `requires one canonical generation-keyed job`, `requires immutable attempts and finalized winner`, and `requires cached api_fetched reuse after restart`. Run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs`; expected RED is missing verifier.
- [ ] Implement read-only sanitized evidence verification only; run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs`; expected GREEN is bounded PASS/FAIL without mutation.
- [ ] Preflight release/migrations/worker, accepted sandbox/profile, current Ready/probe generation, candidate Waiting generation, no active ownership, and no PAYG. Trigger only via provider-ready/Research Now/daily rearm; verify one canonical job.
- [ ] Observe real normalization, attempt chain, `finalize_ai_analysis_from_attempt` winner attribution, natural Ready-for-API state, and no fake USD. If injecting crash after success outcome before finalization, verify reclaim finalizes the staged same winner with no provider replay/fallback.
- [ ] Reach real `api_fetched`, restart worker, and verify event reconstruction, cached fetch reuse, and no duplicate paid work. A start/outcome crash retains unknown and distinct-provider/Waiting behavior.
- [ ] Run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs && pnpm exec turbo run test --force && pnpm exec turbo run typecheck --force && pnpm exec turbo run lint --force && pnpm exec turbo run build --force && pnpm --filter @ara/web test:e2e && pnpm run test:integration && git diff --check`; on Oracle also require documented `systemd-analyze verify`, hostile probes, and runtime queries. Expected GREEN is complete controlled acceptance. Commit only verifier/tests/record as `docs: record subscription provider Plan 04 acceptance`; failed gates are recorded as failure, never acceptance.


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

- After Task 4: local migrated database proves preflight, repeatable probe generation, activation CAS, dual lease epochs, atomic starts, immutable outcomes, and idempotent winner finalization.
- After Task 5: the concrete systemd sandbox contract and unit/polkit artifacts exist before any adapter consumes them.
- After Task 9: disabled acceptance and enabled current-generation readiness are distinct; inactive adapters cannot route.
- After Tasks 10–11: fallback, winner recovery, legacy generation-zero cutover, and Waiting rearm are durable, generation-bound, and analysis-owned.
- After Task 13: full local/integration/E2E gates prove HTTP compatibility and mixed-provider accounting.
- After Task 14: the exact Task-5 sandbox is installed and hostile-denial verified; tooling alone activates nothing.
- After Tasks 15–17: each terms/adapter verdict is independently evidenced; PASS still requires administrative activation and a fresh full Ready probe, while failed gates remain unroutable.
- After Task 18: the controlled candidate proves natural recovery, staged-winner crash completion, and cache reuse without state hacks or duplicate paid work.

## Plan Remediation Closure Map

| Finding | Closure |
| --- | --- |
| I1 | Task 5 fixes `SystemdSubscriptionSandbox`; Task 14 installs/verifies the same artifacts and endpoint-only cgroup policy. |
| I2 | Global 25 and Task 4 define/propagate `jobs.attempts` and `ai_analyses.attempts` epochs through every ownership write. |
| I3 | Runtime `probe_generation`, `request_ai_provider_probe`, generation key, CAS, and repeated/concurrent tests are in Tasks 1, 3, 9. |
| I4 | Task 11 fences writers and rewrites all legacy generation-zero keys in place without deleting history. |
| I5 | Disabled acceptance → operator activation RPC → fresh generated probe → Ready is explicit in Tasks 3, 9, 12, 16–17. |
| I6 | Task 4 stages successful output outside events and defines `finalize_ai_analysis_from_attempt`; Task 10 recovers/finalizes it. |
| I7 | Canonical Failure Matrix gives runtime, retry, consumption, replay, fallback, and logical outcomes for every class. |
| I8 | Task 1 performs aborting existing-row preflight before validated constraints and tests all legacy shapes. |
| M1 | Every task now provides copy-pasteable RED/GREEN commands and expected result. |
| M2 | Milestone correctly attributes fallback and Waiting recovery to Tasks 10–11. |

## Commit Strategy

Each task ends in one focused commit. Schema, runtime CAS, attempt/finalization transactions, sandbox, adapters, routing, recovery, UI, regression proof, operations, and live acceptance remain separately reviewable and revertible. Never combine acceptance evidence with infrastructure, amend migrations 001–018, or let Task 14 replace the Task-5 sandbox. Before each commit stage only listed files, inspect the staged diff, run that task’s exact GREEN command, and run `git diff --check`.

## Completion Verdict Rule

Implementation is complete only when Tasks 1–14 pass their exact local/host gates and each adapter remains fail-closed unless Task 15 plus its own Task 16 or 17 passes, `activate_subscription_provider` succeeds, and the subsequent current-generation worker probe issues Ready. Product acceptance is complete only after Task 18 succeeds with at least one accepted adapter. A failed terms, Codex, Grok, sandbox, or endpoint-policy gate is an explicit safe outcome: record failure and keep that adapter disabled; never weaken containment or substitute PAYG.
