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
22. Each invocation uses one fixed cross-UID IPC/start protocol from Task 5: root/systemd creates adapter-specific runtime roots; after `begin_ai_provider_attempt` commits, the worker validates the fixed adapter/unit/UUID identity and requests the fixed unit with `systemctl start --no-block`; root `ExecStartPre` creates one validated UUID invocation directory and boundedly waits for `request.json`; the worker boundedly observes and verifies that exact directory, then publishes the bounded fixed request by exclusive-create/fsync/atomic-rename; `ExecStartPre` independently validates the final request and releases MAIN; MAIN completes sandbox initialization, emits `READY=1`, and only then begins provider execution. The worker and exactly one adapter exchange only bounded fixed-name JSON files, and root `ExecStopPost` removes the directory only after cgroup termination. The directory is fresh; environment/profile/output/parser/timeout are bounded and fixed; production source, worker env, unrelated home/SSH/Hermes data, external writes, shell/tools, arbitrary network, MCP/hooks/rules/config, sessions/memory/subagents, and provider overrides remain denied and hostile-probed. Adapter stdout/stderr never carries prompts/results/credentials, and the worker never reads an adapter auth home or journal.
23. Catalog/model existence does not prove capability. An adapter/model remains disabled until current fingerprint-bound structured-normalization capability evidence passes.
24. Subscription telemetry records logical requests and reliable token data only. It never fabricates per-call USD. Existing PAYG monetary accounting remains authoritative and separate.
25. `jobs.attempts` returned by claim is `jobLeaseEpoch`; `ai_analyses.attempts` returned by analysis claim is `analysisLeaseEpoch`. Owner, epoch, running/pending status, and unexpired lease are asserted on every ownership-sensitive write so a reclaimed old process fails even when the worker ID is reused.
26. `normalization_generation` remains subordinate to existing analysis ownership. Waiting recovery uses one row-locked rearm RPC and deterministic key `normalize:<candidateId>:<generation>`; failed enqueue does not consume a generation. Migration 021 creates an application-read-only `legacy`/`canonical` writer capability. The immutable Phase-A worker writes only legacy generation-zero keys and refuses `canonical`; migration 022 rewrites all legacy keys and atomically flips capability to `canonical`; the immutable Phase-B worker writes only canonical keys and refuses anything else.
27. Initial `AI Screening` scheduling remains in the daily orchestrator. Provider-ready, Research Now, and daily sweep converge on the same rearm primitive for `Waiting for AI Capacity`.
28. Existing `openai_http` encryption, write-only secret UX, SSRF/DNS/IP pinning, HTTPS, response bounds, execution-probe ownership, provider/model ownership, billing, and no-PAYG behavior remain unchanged.
29. The web exposes only product choices: OpenAI Codex Subscription, Grok Subscription, and OpenAI-Compatible API. It never exposes kind strings, binary path, argv, auth home, profile, environment, acceptance mutation, or Ready controls.
30. Activation is two-stage and non-circular: disabled acceptance probes may persist immutable evidence but cannot issue Ready; only `activate_subscription_provider` may enable an accepted provider/model and request a fresh probe generation; only that full worker probe may issue Ready. `deactivate_subscription_provider` immediately fences routing without revoking credentials.
31. Infrastructure implementation and adapter activation are separate. No adapter is hard-coded Ready, no production development override exists, and each failed acceptance gate leaves the adapter disabled/unroutable.
32. Rollout is migration/preflight → fail-closed Phase-A worker → existing-provider verification → sandbox/auth/acceptance evidence → administrative activation → fresh Ready lease → web display/control → stop every normalization writer → migration-022 rewrite/capability flip → Phase-B worker → normalization routing → controlled recovery. Rollback fences execution and credentials before application/schema rollback; after migration 022, Phase A may never restart and data is never casually renamed back to legacy keys.
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
- `SubscriptionIpcProtocol`: adapter roots `/run/amazon-research/subscription/codex` and `/run/amazon-research/subscription/grok`, groups `ara-codex-ipc` and `ara-grok-ipc`, authoritative UUID instance directory, fixed `request.tmp` → `request.json`, `result.tmp` → `result.json`, and optional bounded `diagnostic.tmp` → `diagnostic.json`; no other data objects or caller-derived paths.
- `createExclusiveRegularFile`, `openVerifiedRegularFile`, `writeAtomicIpcJson`, `readVerifiedIpcJson`, and `verifyInvocationDirectory`: Task-5 helpers using directory-relative opens, numeric `O_CREAT|O_EXCL|O_NOFOLLOW`, `lstat`/`fstat`, regular-file/UID/GID/mode/size verification, same-directory fsync plus atomic rename, and no symlink traversal.
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
- `claim_completed_ai_analysis_finalization`: row-locked recovery RPC that, only after a current job reclaim, assigns a new analysis owner/epoch/lease to an already-completed analysis whose matching candidate-generation ledger row is absent; it never makes the analysis executable or permits provider routing.
- `reconcile_ai_provider_attempts`: RPC/repository operation that returns durable attempted-provider exclusions, reconciles orphan starts, and returns a staged successful winner before any new routing.
- `rearm_candidate_normalization`: row-locked RPC that advances `normalization_generation` and inserts one generation-keyed normalization job atomically.
- `normalized_candidate_finalizations`: migration-021 immutable idempotency ledger keyed by `(candidate_id, normalization_generation)`, retaining exact analysis, winning attempt, finalized-output SHA-256, target state, cluster, and decision identity.
- `finalize_normalized_candidate`: identity-only idempotent transaction that verifies both current lease epochs, completed staged winner, candidate state/generation, and normalization job payload; reads and validates authoritative `ai_analyses.output` itself; derives target state/reasons/cluster fields in the database; then atomically links analysis/entity, creates/reuses/links a cluster when applicable, updates the candidate, inserts exactly one decision event, and records the ledger row.
- `defer_candidate_normalization`: epoch/generation-guarded no-winner transaction for `Waiting for AI Capacity`; it is distinct from successful finalized-output application and replaces the remaining direct candidate/decision write.
- `normalization_writer_capability`: singleton application-read-only row created as `legacy` in migration 021 and changed to `canonical` only inside migration 022; `read_normalization_writer_capability()` is the only application projection.
- `NORMALIZATION_WRITER_LOCK_ID = 7241304022`: fixed PostgreSQL advisory-lock namespace. `enqueue_initial_candidate_normalization` takes `pg_advisory_xact_lock_shared(7241304022)`, verifies caller-supplied immutable writer mode equals the singleton capability, and inserts the exact mode-specific key/payload; migration 022 takes `pg_advisory_xact_lock(7241304022)` before rewrite and capability flip.
- `NORMALIZATION_WRITER_MODE`: immutable release constant. Phase A is `'legacy'` and writes only `normalize:<candidateId>`; Phase B is `'canonical'` and writes only `normalize:<candidateId>:<generation>`.
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
019 schema, existing-row preflight, probe generation, generated DB types, and the final migration-019 DB repository row/RPC cutover
  -> shared/exhaustive kind and failure model plus worker/catalog fail-closed dispatch
  -> runtime CAS, acceptance/activation, and repeatable probe-generation repository
  -> dual lease epochs, attempt transactions, staged winner, candidate-domain finalization, and legacy writer capability
  -> concrete cross-UID SystemdSubscriptionSandbox IPC transport + semaphore
  -> Codex/Grok adapter infrastructure consuming that sandbox
  -> readiness/acceptance/containment orchestration
  -> normalization execution coordinator, winner/domain finalization, fallback, and immutable Phase-A legacy writer
  -> full writer fence -> legacy generation-zero rewrite + atomic canonical capability -> immutable Phase-B canonical writer + Waiting rearm
  -> settings API/UI without acceptance or Ready mutation
  -> regression/integration gates
  -> production installation/verification of the already-defined sandbox and exact Phase-A/fence/Phase-B runbook
  -> terms gate -> independent Codex/Grok acceptance -> activation -> fresh Ready probe -> controlled Plan 04 acceptance
```

Tasks 7–9 may use fake sandbox fixtures locally, but no production adapter process can execute until Task 14 installs and verifies the exact Task 5 unit templates/policy digest. Task 14 configures host prerequisites; it may not introduce or substitute a different isolation primitive.

## Task 1: Add migration 019 provider, runtime, attestation, and attempt schema

**Spec:** Sections 10–13, 19, 21–22, 30.

**Files**
- Create: `supabase/migrations/202608290019_subscription_ai_provider_schema.sql`
- Create: `packages/db/src/subscription-provider-schema.integration.test.ts`
- Modify: `packages/db/src/core-schema.integration.test.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/provider-repository.ts`
- Modify: `packages/db/src/provider-repository.test.ts`
- Modify: `package.json`
- Test: `packages/db/src/subscription-provider-schema.integration.test.ts`, `packages/db/src/core-schema.integration.test.ts`, `packages/db/src/provider-repository.test.ts`

**Interfaces**
- Consumes: existing `ai_providers`, `ai_models`, `provider_secrets`, `ai_analyses`, `candidates`, `jobs`, `save_ai_provider_settings`, the current DB repository boundary, service-role RLS convention, and migration 018 baseline.
- Produces: `adapter`, `normalization_generation`, runtime state with `probe_generation`, both attestation tables, attempt events, protected staged-winner fields, authoritative generated types, and the final migration-019-compatible DB repository row/RPC mapping consumed by Tasks 2–18.
- Owns the complete migration-019 DB repository cutover once: `ProviderRow.adapter` is always present as `string | null`; HTTP/legacy rows map `adapter=null`; existing subscription rows preserve `codex|grok`; exported `ProviderRuntimeStateRow` plus `listRuntimeStates()` / `findRuntimeState(providerId)` expose read-only runtime rows with `probe_generation` unchanged; `save_ai_provider_settings` optional-only generated arguments are omitted when absent rather than passed as `null`; committed provider snapshots validate and return the stored kind/adapter without converting family. The existing settings RPC does not become a subscription-provider creation path. No temporary compatibility shim, generated-type weakening, or duplicate Task-2 mapping is permitted.

- [ ] Write failing integration cases named `preserves a valid existing HTTP provider`, `preserves a valid legacy command provider`, `aborts on existing provider-model billing mismatch`, `aborts on a forbidden existing secret`, `aborts on cross-family config or adapter collision`, `accepts only the approved kind-adapter-billing matrix`, `keeps provider family immutable`, `keeps unproven subscription models disabled`, `rejects updates and deletes of provider attempt events`, and `rejects contradictory attempt outcomes`. Run `pnpm --filter @ara/db exec vitest run src/subscription-provider-schema.integration.test.ts`; expected RED is missing migration-019 columns/tables/preflight constraints.
- [ ] Add repository/schema cutover cases named `maps null adapter from a committed HTTP provider snapshot`, `maps codex and grok adapters from committed subscription provider snapshots`, `maps runtime probe generation without coercion`, `omits absent optional settings revision instead of passing null`, and `preserves an existing provider kind and adapter in the committed settings snapshot`. Preserve the existing committed-snapshot and HTTP repository assertions. Run `pnpm --filter @ara/db exec vitest run src/provider-repository.test.ts && pnpm --filter @ara/db typecheck`; expected RED is the pre-019 mapper omitting required `adapter`, rejecting the generated optional-only RPC argument shape, and lacking `ProviderRuntimeStateRow` plus read-only runtime queries. These are the authoritative RED checks for the repository cutover; Task 2 must not recreate them.
- [ ] Legalize only the three obsolete fixtures in `core-schema.integration.test.ts` that test rollback, discovery preservation, and stale-revision protection: seed `openai_http` directly instead of incidental `command` secret ownership or `command -> openai_http` conversion. Keep every behavioral assertion unchanged and do not weaken HTTP-only secrets or family immutability.
- [ ] Begin migration 019 with deterministic `DO`-block preflight before any new validated constraint: preserve `openai_http` rows with optional secrets and HTTP-only config; preserve readable legacy `command` rows only when they have no secret and only command-family config; abort with sanitized provider IDs/counts on provider/model billing mismatch, command-owned secret, cross-family config, any pre-existing/future adapter key, unsupported kind, or a shape that would collide with one-row-per-adapter. Do not delete secrets, change billing, convert family, or silently disable data. The only deterministic additions are nullable `adapter`, candidate generation `0`, and runtime generation `0`.
- [ ] Extend kind CHECK to `subscription_command`; enforce kind/adapter/billing/secret/config matrix, one subscription row per adapter, provider/model billing agreement, subscription-model disabled-until-proof, and immutable family with validated constraints/triggers after preflight. Mixed-version old readers continue to read valid HTTP/legacy rows; unknown new kind remains worker-fail-closed.
- [ ] Add `candidates.normalization_generation bigint NOT NULL DEFAULT 0 CHECK (normalization_generation >= 0)`; do not alter initial enqueue behavior before migration 022 cutover.
- [ ] Create `ai_provider_runtime_state` with spec Section 11 fields plus `probe_generation bigint NOT NULL DEFAULT 0 CHECK (probe_generation >= 0)`, current probe job/reference metadata, and service-role-only RLS. Create immutable capability/containment attestation tables without raw prompt/output/auth columns.
- [ ] Create `provider_attempt_events` with dual lease owner/epoch context, bindings, safe metadata, usage, and consumption status. Enforce one start per attempt, unique `(logical_analysis_id, attempt_sequence)` on starts, one partial unique outcome across all outcome types, legal event/status combinations, and append-only update/delete rejection.
- [ ] Add protected nullable `ai_analyses.pending_winner_attempt_id`, `pending_output`, and `pending_usage` staging fields. Only migration-021 RPCs may write them; attempt events remain free of output.
- [ ] Regenerate DB types, implement the final schema-compatible provider row, exported `ProviderRuntimeStateRow`, `listRuntimeStates()` / `findRuntimeState(providerId)`, and settings-RPC argument/return mapping in `provider-repository.ts`, and register the integration file. Repository parsing must fail closed on invalid adapter/runtime shapes, preserve stored provider family values verbatim, preserve `probe_generation` as a non-negative integer, omit absent optional RPC keys instead of writing null, and adapt code to generated types rather than make `adapter` optional or use assertions/suppressions. Do not add subscription provider creation to the legacy settings RPC. Run `pnpm --filter @ara/db exec vitest run src/subscription-provider-schema.integration.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && git diff --check`; expected GREEN is all migration/preflight/immutability, legal fixture, repository mapping, optional-argument, and generated-schema compatibility cases passing. Commit only Task 1 files as `db: add subscription provider execution schema`.

## Task 2: Make provider dispatch exhaustive and propagate migration-019 worker types

**Spec:** Sections 1, 3, 9–10, 15, 24–25. The worker compatibility items below are migration-019 generated-type propagation only; they do not change the approved specification or database semantics.

**Files**
- Create: `packages/db/src/execution-identity.test.ts`
- Create: `packages/db/src/migration-019-compatibility.ts`
- Create: `packages/db/src/migration-019-compatibility.test.ts`
- Create: `packages/db/src/migration-019-compatibility.integration.test.ts`
- Modify: `packages/shared/src/ai.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/ai.test.ts`
- Modify: `packages/db/src/execution-identity.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/worker/src/providers/provider-catalog.ts`
- Modify: `apps/worker/src/providers/provider-catalog.test.ts`
- Modify: `apps/worker/src/jobs/daily-research.ts` only to call the typed compatibility repository for `advance_daily_research_checkpoint`; no writer-mode, scheduling, status, checkpoint, or completion semantics change
- Modify: `apps/worker/src/jobs/normalize-opportunities.ts` only to select the required `normalization_generation` field and call the typed compatibility repository for `upsert_niche_cluster`; no generation logic, coordinator, finalization, routing, fallback, or domain-write redesign
- Modify: `apps/worker/src/jobs/daily-research.test.ts` only for the migration-019 nullable-RPC propagation case
- Modify: `apps/worker/src/jobs/daily-research.integration.test.ts` only for exact `next_completed_at = NULL` behavior
- Modify: `apps/worker/src/jobs/normalize-opportunities.integration.test.ts` only for the required candidate projection and exact `canonical_english = NULL` behavior
- Test: all files listed above; the original shared/execution-identity/catalog cases remain the focused Task-2 suite

**Interfaces**
- Consumes: the fully GREEN and committed Task-1 migration-019 row types plus final provider/runtime repository contract, current fingerprint/catalog interfaces, the unchanged SQL functions `advance_daily_research_checkpoint` and `upsert_niche_cluster`, and the required `candidates.normalization_generation` row field.
- Produces: exported `SubscriptionAdapterSchema`, `ProviderRuntimeStateSchema`, attempt/failure enums, discriminated persisted provider configuration, subscription-aware fingerprint inputs, exhaustive provider-kind dispatch with unknown kinds fail-closed, and one narrowly typed migration-019 compatibility repository for the two nullable RPC arguments that Supabase CLI 2.116.0 cannot represent faithfully.
- Does not modify or remap `provider-repository.ts`; Task 1 already owns its complete migration-019 adapter/read-only-runtime/probe-generation and settings-RPC cutover. Task 2 consumes that contract and owns only the remaining shared schema, fingerprint, export, worker/catalog dispatch, and minimum worker compilation adaptations caused by the committed migration-019 generated-type cutover.
- Root-cause boundary is explicit: `normalization_generation` is schema-projection drift because `loadCandidates()` promises full `CandidateRow` values while its explicit select omitted the new required field. `next_completed_at` and `canonical_english` are generated RPC nullability limitations, not invalid application values: both PostgreSQL arguments accept explicit `NULL`, both have zero defaults so omission is not equivalent, and the pre-019 types represented both as `string | null`.
- `createMigration019CompatibilityRepository(client)` exposes exactly `advanceDailyResearchCheckpoint(...)` and `upsertNicheCluster(...)` with domain inputs whose affected values are `string | null`. Its implementation defines a private database type overlay that changes only `advance_daily_research_checkpoint.Args.next_completed_at` and `upsert_niche_cluster.Args.canonical_english` to `string | null`, then uses one localized direct type assertion on the bound `rpc` method to that exact two-function interface. No `any`, `unknown as`, worker-callsite cast, generated-type edit, global Supabase-client widening, or additional RPC name is allowed. The repository forwards explicit `null` unchanged; it never omits the argument or substitutes `''`, a timestamp, or another value.
- **TEMPORARY LEGACY EXCEPTION — TASK 10 OWNED:** until Task 10 completes its clean cutover, `service_role` retains EXECUTE only on the exact current signature `public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text)` because the approved pre-Task-10 normalization coordinator calls it through `createMigration019CompatibilityRepository`. The exception authorizes only the function's historical `niche_clusters` insert/update surface. It does not authorize direct mutation of `normalized_candidate_finalizations`, provider attempts/runtime/capability/containment state, protected analysis winner/staging fields, subscription activation state or secrets, lease epochs, or any other authority-owned generic helper. PUBLIC, `anon`, and `authenticated` remain denied. This is compatibility debt, not the final authority model.

- [ ] Extend the existing RED with cases named `selects normalization generation in the full candidate projection`, `forwards null daily completion unchanged`, `forwards null canonical English unchanged`, `database accepts explicit null daily completion`, and `database accepts explicit null canonical English`. The integration cases must also prove omission fails because neither function has an argument default and must clean up their own run/cluster fixtures. Run `pnpm --filter @ara/db exec vitest run src/migration-019-compatibility.test.ts src/migration-019-compatibility.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/daily-research.test.ts src/jobs/daily-research.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts && pnpm --filter @ara/worker typecheck`; expected RED is the missing compatibility repository, the candidate projection missing required `normalization_generation`, and the two generated `string` RPC arguments rejecting existing `string | null` values.
- [ ] Extend `ProviderKindSchema`; add/export the canonical adapter, runtime, attempt, consumption, expanded failure, dual-lease identity, and probe-generation schemas/types. Define a discriminated subscription config accepting only fixed role `niche_normalization` plus product-visible model/priority state and no executable, argv, auth-home, base URL, API key, or command profile.
- [ ] Replace family-agnostic fingerprint scanning with exhaustive family functions. Subscription fingerprint requires adapter, absolute binary digest/version, execution-profile ID, systemd unit/policy digest, dedicated auth-home identity, auth generation, settings revision, security/readiness versions, endpoint allowlist digest, containment binding, capability binding, and terms digest; preserve identical HTTP fingerprints.
- [ ] Consume Task 1's validated provider adapter and `listRuntimeStates()` / `findRuntimeState()` read contract in catalog snapshots, including exact `probe_generation`; remove implicit `openai_http else command`. Unknown kind/adapter yields `ProviderCatalogError` and unavailable omission, never legacy `CommandProvider` construction.
- [ ] Add a temporary explicit `subscription_command` catalog branch that is unavailable and cannot construct a sandbox process until Tasks 5, 7–9, and production Task 14 evidence match.
- [ ] Add `normalization_generation` to the exact `candidates` select list returned as `CandidateRow`; carry the database value unchanged but do not branch, increment, enqueue, finalize, or schedule on it. Task 10 still owns normalization coordinator/domain behavior and Task 11 still owns generation-zero writer cutover, Waiting recovery, and canonical scheduling.
- [ ] Route only the two affected worker RPC calls through `createMigration019CompatibilityRepository`. Preserve explicit SQL `NULL` exactly: daily checkpoint NULL leaves `completed_at` unchanged unless completion supplies a timestamp; niche-cluster NULL inserts NULL and, on conflict, preserves existing `canonical_english` through SQL `coalesce`. Do not fabricate values, omit required arguments, change SQL/migration 019, edit generated types, or use broad casts/suppressions.
- [ ] Run the compatibility GREEN first: `pnpm --filter @ara/db exec vitest run src/migration-019-compatibility.test.ts src/migration-019-compatibility.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/jobs/daily-research.test.ts src/jobs/daily-research.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts && pnpm --filter @ara/worker typecheck`; expected GREEN proves the full candidate projection compiles, both explicit NULLs reach PostgreSQL unchanged, omission remains invalid, and no fallback value is introduced.
- [ ] Preserve the existing focused Task-2 GREEN and full gate exactly: `pnpm --filter @ara/shared exec vitest run src/ai.test.ts && pnpm --filter @ara/db exec vitest run src/execution-identity.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/provider-catalog.test.ts && pnpm --filter @ara/shared test && pnpm --filter @ara/db test && pnpm --filter @ara/worker test && pnpm --filter @ara/shared typecheck && pnpm --filter @ara/db typecheck && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is exhaustive parsing, stable family-specific fingerprints, fail-closed dispatch, migration-019 worker compatibility, and no generated-type weakening. Review and commit all and only Task-2-authorized paths as `refactor: make AI provider dispatch exhaustive`.
- [ ] Stop after the Task-2 commit and confirm a clean worktree before Task 3. Tasks 3 and 4 retain their existing runtime-CAS and dual-epoch/finalization ownership without any forward dependency from this compatibility repository. Task 5 remains blocked until Tasks 2–4 are complete and Checkpoint 1 passes; no sandbox, adapter, provider execution, Task-10 coordinator, or Task-11 writer behavior may begin here.


## Task 3: Implement authoritative runtime state, repeatable probes, and activation CAS

**Spec:** Sections 4–5, 10–14, 16–17, 21, 25, 27.

**Files**
- Create: `supabase/migrations/202608290020_subscription_ai_runtime_cas.sql`
- Create: `packages/db/src/provider-runtime-repository.ts`
- Create: `packages/db/src/provider-runtime-repository.test.ts`
- Create: `packages/db/src/provider-runtime.integration.test.ts`
- Modify: `packages/db/src/provider-repository.ts` only to remove superseded subscription `config.executionProbe`/`recordExecutionProbe` writes after the new strict runtime repository exists; retain Task 1's provider-row and read-only `listRuntimeStates()` / `findRuntimeState()` contract and do not redo adapter/probe-generation parsing.
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

## Task 4: Add dual-epoch pre-spawn, immutable attempts, winner and candidate-domain finalization

**Spec:** Sections 17, 19–20, 22, 27; residual finding R2.

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
- Test: provider-attempt, candidate-domain finalization, queue, and worker ownership files

**Interfaces**
- Consumes: provider/runtime/attestation schema, `jobs.attempts` claim epoch, `ai_analyses.attempts` claim epoch, candidate/cluster/decision schema, and migration-019 generation.
- Produces: epoch-aware queue/analysis RPCs, `begin_ai_provider_attempt`, `append_ai_provider_attempt_outcome`, `finalize_ai_analysis_from_attempt`, `claim_completed_ai_analysis_finalization`, `finalize_normalized_candidate`, `defer_candidate_normalization`, `reconcile_ai_provider_attempts`, `normalized_candidate_finalizations`, `normalization_writer_capability`, `read_normalization_writer_capability`, `enqueue_initial_candidate_normalization`, `ProviderAttemptRepository`, and `AttemptAuthorization`.

- [ ] Write failing tests for old epoch rejected/new accepted, same worker ID old epoch rejected, reclaimed analysis unable to finalize, old job epoch unable to start, all pre-spawn predicates, concurrent sequence allocation, failed start persistence blocking sandbox callback, one outcome race, staged winner recovery, exactly-once usage, completed-analysis finalization reclaim, stale job/analysis epoch candidate finalization, wrong candidate state/generation/job payload, conflicting winner, exact-repeat idempotency, authoritative-output derivation, malformed/contradictory output rejection, cluster/link/decision atomicity, transaction rollback, no-winner defer fencing, wrong writer mode, and enqueue/cutover advisory-lock serialization. Run `pnpm --filter @ara/db exec vitest run src/provider-attempt-repository.test.ts src/provider-attempts.integration.test.ts && pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/main.test.ts`; expected RED is missing migration-021 epoch-aware, completed-analysis reclaim, DB-derived candidate-domain finalization, idempotency-ledger, and locked writer-capability APIs.
- [ ] In migration 021 replace claim/heartbeat/checkpoint/complete/fail job and analysis RPC signatures so claim returns the incremented positive epoch and every ownership-sensitive mutation checks row ID, owner, epoch, expected status, and unexpired lease. Carry `JobLeaseIdentity` in `Job`/handler context and `AnalysisLeaseIdentity` from analysis claim through coordinator; stale same-owner processes must fail. Successful analysis finalization retains its current owner/epoch/lease until candidate-domain finalization and job completion.
- [ ] Implement `begin_ai_provider_attempt` as one transaction. Lock analysis, job, provider/runtime; assert both lease identities, enabled/routable DB-clock state, no retry, all settings/auth/fingerprint/probe/capability/security/containment/terms bindings, model ownership/billing, no-PAYG, and logical ownership; allocate sequence and commit `attempt_started` before returning authorization. HTTP records evidence without a subscription runtime row; legacy command remains non-production only.
- [ ] Implement `append_ai_provider_attempt_outcome` with strict event/result/consumption combinations and both current lease identities. `attempt_not_consumed` accepts only durable `spawn_rejected_before_child`, `sandbox_not_started`, `profile_verification_failed_before_spawn`, or `semaphore_cancelled_before_authorization` proof. On success, the same transaction appends `attempt_succeeded` and writes schema-validated `pending_winner_attempt_id`, `pending_output`, and `pending_usage` on the protected analysis row; event projections never contain output.
- [ ] Implement `finalize_ai_analysis_from_attempt` idempotently: lock job/analysis and verify owner+epoch+lease, same logical analysis, staged winner, successful attempt outcome, provider/model/cost agreement, and no conflicting completion; atomically set final provider/model/cost/output/usage plus `extensions.digest(convert_to(output::text, 'UTF8'), 'sha256')` over PostgreSQL canonical JSONB text, complete analysis, retain current lease identity for domain finalization, clear staging, and insert `ai_usage` exactly once. Repeating the same winner returns the completed row; a different winner conflicts; no-winner paths never fabricate attribution.
- [ ] Create `normalized_candidate_finalizations` with primary key `(candidate_id, normalization_generation)`, unique exact `(analysis_id, winning_attempt_id)`, non-null finalized-output SHA-256/target-state/decision ID, nullable cluster ID, and immutable update/delete rejection. `finalize_normalized_candidate` accepts identities and expected candidate state/generation only—never client-derived state, reasons, canonical niche, aliases, catalog phrases, or cluster fields. It locks job, analysis, attempt, candidate, and ledger; requires current running job owner/epoch/unexpired lease, current completed analysis owner/epoch/unexpired lease, authoritative successful winner and matching stored output digest, job payload containing exactly the candidate and expected generation, candidate in the expected normalization-owned state/generation, and no conflicting finalization.
- [ ] In that one transaction validate required types/enums and allowed field combinations directly from authoritative `ai_analyses.output`. Preserve the existing mapping exactly: `brand_ip | broad_query | irrelevant` → `Reject`; otherwise `ambiguous`, confidence `< 0.7`, or null `canonicalNiche` → `Needs Review`; otherwise → `Ready for API Validation`. Derive the appended reason as `{ code: 'AI_' || upper(classification), detail: reason }`, preserve existing valid `{code,detail}` reasons, and dedupe by code in original order. For Ready only, call existing `canonical_niche_key(canonicalNiche)` and derive canonical name/English, aliases, catalog phrases, and required representative raw keyword link. Then insert/validate `ai_analysis_entities`, create/reuse `niche_clusters`, insert `niche_cluster_keywords`, update candidate state/reasons/cluster, insert exactly one `decision_history`, and insert the ledger. Malformed/contradictory output or a Ready candidate without a representative raw keyword writes nothing. Exact repeats return `already_committed`; a different generation/winner/output/state writes nothing. Transaction failure rolls everything back. A crash after analysis completion is resumed by a new current lease without provider replay; a crash after domain commit repeats to `already_committed` before job completion.
- [ ] Implement `claim_completed_ai_analysis_finalization` for the crash window after analysis completion and before candidate-domain commit. It locks the current running normalization job, analysis, candidate, and ledger; requires current job owner/epoch/unexpired lease, completed analysis with authoritative successful winner/output digest, expired prior analysis lease, matching input/candidate/generation payload, candidate still in expected state/generation, and no ledger row; then increments `ai_analyses.attempts`, assigns the new analysis owner/lease, and returns that `AnalysisLeaseIdentity`. It cannot change output/status, route, create attempts, or claim a conflicting/currently leased analysis. If the ledger already exists, return `already_committed` without changing the analysis epoch.
- [ ] Implement `defer_candidate_normalization` as the only no-winner candidate transition: verify current job owner/epoch/lease, candidate state/generation, matching payload, and durable exhaustion result; atomically write `Waiting for AI Capacity` plus one idempotent decision. It never consumes `normalized_candidate_finalizations` and never accepts a winner.
- [ ] Create singleton `normalization_writer_capability` as `legacy`, revoke application mutation, and expose only service-role execute on `read_normalization_writer_capability()`. Create `enqueue_initial_candidate_normalization(candidate_id, locale, writer_mode)` as the only initial-normalization writer: acquire `pg_advisory_xact_lock_shared(7241304022)`, lock/read the singleton, require the immutable caller mode equals it, verify candidate generation/state, and insert exactly legacy key/no generation payload for `legacy` or canonical key/generation payload for `canonical`. Duplicate same-mode calls return the existing job; wrong/missing mode fails before insert. Only migration 022 may change the singleton; missing/unknown/multiple rows fail closed.
- [ ] Implement reconciliation so a staged successful winner is returned before routing. If a worker dies before analysis finalization, the reclaimer finalizes that winner. If it dies after analysis completion but before candidate-domain commit, the newly reclaimed job calls `claim_completed_ai_analysis_finalization` and then `finalize_normalized_candidate`; neither path reruns or falls back. Bare starts become unknown unless affirmative durable no-consumption proof exists; race losers reload the winner/finalization ledger.
- [ ] Verify event projections omit prompt/raw stdout/stderr/auth/env/secrets/subscription USD and that runtime/candidate writeback tied to execution requires current epochs. Run `pnpm --filter @ara/db exec vitest run src/provider-attempt-repository.test.ts src/provider-attempts.integration.test.ts && pnpm --filter @ara/queue exec vitest run src/queue.test.ts && pnpm --filter @ara/worker exec vitest run src/main.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && pnpm --filter @ara/queue test && pnpm --filter @ara/queue typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is dual-epoch exclusion, atomic start, single outcome, exactly-once analysis and candidate-domain finalization, fenced defer, and immutable legacy capability. Commit only Task 4 files as `db: finalize provider attempts and candidate domains`.

## Task 5: Implement the bounded cross-UID SystemdSubscriptionSandbox transport

**Spec:** Sections 6–9, 30.

**Files**
- Create: `packages/ai-router/src/providers/subscription-process.ts`
- Create: `packages/ai-router/src/providers/subscription-process.test.ts`
- Create: `packages/ai-router/src/providers/subscription-errors.ts`
- Create: `apps/worker/src/providers/systemd-subscription-sandbox.ts`
- Create: `apps/worker/src/providers/systemd-subscription-sandbox.test.ts`
- Create: `ops/systemd/amazon-research-codex@.service`
- Create: `ops/subscription-providers/subscription-supervisor.mjs`
- Create: `ops/systemd/amazon-research-grok@.service`
- Create: `ops/subscription-providers/manage-invocation.sh`
- Create: `ops/systemd/amazon-research-subscription-gc.service`
- Create: `ops/systemd/amazon-research-subscription-gc.timer`
- Create: `ops/polkit/50-amazon-research-subscription.rules`
- Create: `ops/nftables/amazon-research-subscription.nft`
- Modify: `packages/ai-router/src/providers/command.ts`
- Modify: `packages/ai-router/src/providers/command.test.ts`
- Modify: `packages/ai-router/src/index.ts`
- Test: IPC, process, sandbox-control, unit-template, lifecycle-helper, root-GC, policy, and legacy command tests

**Interfaces**
- Consumes: safe termination/bounds helpers from `CommandProvider` and Ubuntu 24.04 systemd 255/cgroup-v2/nftables capabilities.
- Produces: `SubscriptionIpcProtocol`, the five canonical IPC helpers, `SystemdSubscriptionSandbox`, explicit pre-READY phases S0–S5, `SubscriptionProcessTransport.run(profile, invocation, signal)`, immutable unit/policy digests, bounded result/diagnostic envelopes, and unchanged test-only `CommandProvider` behavior.

- [ ] Write failing tests named `worker cannot publish before invocation directory exists`, `nonblocking start creates exact invocation directory`, `worker verifies directory before request write`, `worker publishes request only by exclusive tmp fsync rename`, `ExecStartPre waits before request json`, `valid request releases ExecStartPre`, `MAIN waits for ExecStartPre completion`, `READY follows MAIN sandbox validation`, `provider execution follows READY`, `cancellation while waiting for directory cleans exact unit`, `cancellation after directory before request cleans exact unit`, `cancellation after request before READY cleans exact unit`, `start failure before directory leaves nothing`, `start failure after directory removes directory`, `invalid request fails startup and cleans`, `request handoff timeout fails startup`, `nonblocking start avoids request publication deadlock`, and `READY result status and ExecStopPost lifecycle remains ordered`. Retain coverage for cross-UID ownership/modes and adapter isolation; request/result atomic publication; symlink/non-regular/wrong UID/GID/mode/oversize rejection; fixed adapter/unit selection; UUID-only instance; no direct client `spawn`; absolute binary/profile verification; empty environment; `systemctl kill --kill-who=all`; no unit start after verification failure; liveness-aware root GC; and hostile fs/exec/network policy. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/subscription-process.test.ts src/providers/command.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/systemd-subscription-sandbox.test.ts`; expected RED is that the current transport cannot execute the non-blocking start → directory creation/wait → verified request publication → MAIN → READY handshake and does not yet preserve all cancellation/failure cleanup boundaries alongside the existing READY/result/stop lifecycle.
- [ ] Define root-created parents `/run/amazon-research/subscription/codex` as `root:ara-codex-ipc` mode `0750` and `/run/amazon-research/subscription/grok` as `root:ara-grok-ipc` mode `0750`. Membership is exact: `amazon-research` is in both IPC groups, `ara-codex` only in `ara-codex-ipc`, and `ara-grok` only in `ara-grok-ipc`. Auth homes remain separate `ara-<adapter>:ara-<adapter>` mode `0700`; no IPC path is inside a repo, worker env directory, or auth home.
- [ ] Implement one start handshake after `begin_ai_provider_attempt` commits. In S0 the worker has validated adapter identity, fixed the authoritative attempt UUID and corresponding adapter/unit identity, and rechecked cancellation; it never publishes a request or creates an invocation directory. The worker advances to S1 only by invoking `systemctl start --no-block amazon-research-<adapter>@<uuid>.service` through the narrow polkit path. The non-blocking form is mandatory because a synchronous start would wait for `ExecStartPre` while preventing the same worker from publishing the request that releases it. Root-owned fixed `ExecStartPre=+.../manage-invocation.sh prepare-and-wait <adapter> <uuid>` validates the fixed adapter, canonical UUID-only instance, IPC root, absence of a conflicting live invocation, no symlink/path escape, and exact parent; creates exactly one invocation directory as `amazon-research:<adapter-ipc-group>` mode `2770`; verifies its owner/group/mode/path; and enters a bounded wait for fixed final `request.json`. The polkit rule permits `amazon-research` only start/stop/kill and fixed-property observation for the two fixed templates with canonical UUID instances; no transient property, executable, argv, path, UID, environment, or firewall value is caller-controlled.
- [ ] In S1 the worker polls only the exact invocation path plus allowlisted properties of that exact starting unit at a fixed bounded interval/deadline; no recursive scan or unrestricted journal parsing. It fails closed if the unit fails/disappears and stops on cancellation. Directory appearance advances to S2 only after `verifyInvocationDirectory` proves exact expected path, directory/not-symlink, expected worker UID, adapter IPC GID, mode `2770`, correct adapter root and UUID instance, unit still starting/alive, and cancellation still clear. Only then may the worker open directory-relative fixed `request.tmp` with numeric `O_CREAT|O_EXCL|O_NOFOLLOW`, mode `0640`, expected owner `amazon-research` and inherited adapter IPC group; write one schema-valid bounded envelope; fsync/close; verify `request.json` absent; atomically rename within that directory; and fsync the directory. Publication advances to S3. `ExecStartPre` observes only fixed final `request.json`, independently verifies regular-file/no-symlink, worker UID, adapter IPC GID, mode, maximum size, fixed filename, invocation root, and bounded envelope, and exits nonzero on any invalid artifact. Adapter MAIN later revalidates the request/invocation assumptions required by the sandbox contract. Filenames never include model/provider/user data.
- [ ] Adapter execution is the root-owned, digest-pinned `subscription-supervisor.mjs` MAIN process under the fixed runtime in the unit `ExecStart`; neither path nor arguments are caller-controlled. After the fixed invocation identity, IPC request file, and request envelope are validated and safely opened, and all pre-execution sandbox initialization is complete, MAIN emits `sd_notify("READY=1")` exactly once. This is the sole readiness transition: it means the accepted sandboxed invocation has entered its running state and systemd startup is complete, not that provider execution, provider authentication beyond required preconditions, or result publication succeeded. Only after readiness does MAIN invoke the fixed adapter client. It captures/parses bounded output, publishes `result.json`, reaps the client, emits the later and separate `sd_notify("STATUS=result-published")`, then remains alive without network/client work until an explicit systemd stop signal; it never exits merely because the result was published. The retention timeout is greater than the transport's maximum execution/read timeout plus cleanup grace and exists only as a crash backstop. Result publication mirrors the request: open fixed `result.tmp` exclusively/no-follow at mode `0640`, require adapter UID plus IPC group, write one bounded schema-valid result including client exit evidence, fsync/close, require `result.json` absent, atomic same-directory rename, and directory fsync. The worker opens only fixed `result.json`, verifies regular file/adapter UID/group/mode/size before parse, and never traverses the adapter auth home. Optional diagnostics use only bounded `diagnostic.tmp` → `diagnostic.json`; `StandardOutput=null`, `StandardError=null`, and no journal read.
- [ ] Implement explicit pre-READY phases without timing inference: S0 = attempt authorized/unit not requested; S1 = non-blocking start requested/directory absent; S2 = directory exists and is verified/request unpublished; S3 = `request.json` atomically published/`ExecStartPre` validating or releasing; S4 = `ExecStartPre` complete and MAIN running before READY; S5 = `READY=1` accepted and unit active. Implement the named IPC helpers with directory file descriptors, numeric no-follow flags, `lstat`/`fstat`, and explicit maxima for request, result, diagnostics, individual frame, and aggregate parsed output; partial tmp files are never consumed and invalid output is fail-closed. Each unit is `Type=notify` with `NotifyAccess=main`. A fixed request-handoff deadline bounds `ExecStartPre` within the broader `TimeoutStartSec`; `TimeoutStartSec` separately retains enough bounded budget for MAIN initialization through READY, while provider execution receives its distinct deadline only after S5. During startup the worker uses only allowlisted fixed `systemctl show` properties to distinguish directory wait, startup failure, cancellation, and the active/running state established solely by `READY=1`; `STATUS=result-published` updates status text only. During the separate execution phase, exact `StatusText=result-published` only signals validation/ingestion of fixed `result.json`; authority additionally requires the active MAIN and matching provider-client exit evidence.
- [ ] Observe only fixed `systemctl show` properties `ActiveState`, `SubState`, `StatusText`, `ExecMainCode`, `ExecMainStatus`, and `Result` plus the exact invocation path and bounded fixed-file presence. Normal success is exact: `begin_ai_provider_attempt` commits → cancellation/adapter/UUID/unit identity recheck → non-blocking fixed-unit start → `ExecStartPre` validates and creates exact directory then waits → worker boundedly observes and verifies directory → worker writes/fsyncs/closes `request.tmp` and atomically publishes `request.json` → `ExecStartPre` independently validates request and completes → MAIN revalidates fixed request/invocation and initializes sandbox → `READY=1` → active/running → provider execution → `result.tmp` fsync/close and atomic `result.json` publication → `STATUS=result-published` → worker validates/reads/closes result → records the existing provider outcome → explicitly requests stop → systemd terminates service processes and all cgroup writers → root-owned `ExecStopPost=+.../manage-invocation.sh cleanup <adapter> <uuid>` validates the fixed UUID/path, refuses symlink/path escape or a live adapter, removes only that invocation directory, and never touches auth homes/unrelated roots → stop transaction completes → unit reaches inactive/failed → worker verifies terminal state, empty cgroup, and absent directory → existing logical finalization/fallback continues. Provider execution never begins before S5.
- [ ] Preserve the existing failure/consumption matrix without new classes across every pre-READY boundary. Cancellation in S0 starts no unit and expects no directory/request. Cancellation in S1 stops the exact starting unit, publishes no request, waits for stop completion, then verifies terminal/empty/absent. Cancellation in S2 publishes no final request and follows the same stop/cleanup verification. Cancellation in S3 or S4 waits for no result, stops the exact starting unit, terminates its cgroup, permits `ExecStopPost` cleanup, then verifies terminal/empty/absent. A start refusal/failure before directory publishes nothing and verifies absence; failure after directory creation—including helper/permission failure, invalid request, bounded request-handoff expiry, or cancellation—never starts MAIN and removes the exact directory through the fixed failure/stop lifecycle; failure after request but before READY never waits for `STATUS=result-published` and cleans identically. On provider timeout/output failure or cancellation after READY, retain the approved stop/kill → cgroup termination → `ExecStopPost` → stop completion → terminal/empty/absent order. `ExecStopPost` is never a worker action after inactive, and result publication never triggers it. The root GC contract remains liveness-aware and unchanged.
- [ ] Enforce endpoint-only egress in root-owned nftables `inet` OUTPUT keyed by dedicated adapter UID: only required loopback IPC, TCP/UDP 53 to configured local resolvers, and TCP 443 to root-resolved accepted provider/auth prefixes; reject every other packet. Add matching systemd IP deny/allow defense. Bind ruleset text, prefixes, resolvers, hostnames, unit/supervisor/lifecycle-helper/GC text, UID/GID/modes, executable set, auth-home identity, and host capability to the security-profile digest; drift invalidates the profile.
- [ ] Encode the immutable unit policy: dedicated non-login `ara-codex`/`ara-grok` UIDs; `Type=notify`; `NotifyAccess=main`; bounded `TimeoutStartSec` owns the total `ExecStartPre` request handoff plus MAIN initialization through READY, with the helper's shorter fixed request-handoff deadline unable to consume it unboundedly; the worker/adapter execution contract owns the distinct provider deadline starting only after READY; bounded `TimeoutStopSec` plus `KillMode=control-group` hard-kill escalation owns stop/cgroup termination before `ExecStopPost`; `ProtectSystem=strict`; `ProtectHome=yes`; `PrivateTmp=yes`; explicit `InaccessiblePaths=/opt/amazon-research/current /etc/amazon-research /home /root`; `ReadWritePaths` only adapter auth home and invocation root; `NoExecPaths=/` plus exact accepted supervisor/client/runtime `ExecPaths`; fixed empty-base HOME/TMPDIR/locale; `NoNewPrivileges=yes`; empty capabilities; namespace/kernel/personality protections; `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`; bounded tasks/memory/CPU/file size; no shell/tool executable. Root-owned accepted-profile drop-ins contain fixed client args and digest-pinned executable/supervisor identity.
- [ ] Preserve legacy `CommandProvider` behavior and its 2 MiB-per-stream contract while reusing only safe generic bounds/termination helpers. Run `pnpm --filter @ara/ai-router exec vitest run src/providers/subscription-process.test.ts src/providers/command.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/systemd-subscription-sandbox.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/ai-router lint && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/worker lint && git diff --check`; expected GREEN proves the worker remains live after non-blocking start to observe/verify the exact directory and atomically publish the request, `ExecStartPre` boundedly waits and releases only for a valid request, MAIN/READY/provider ordering is exact, every pre-READY cancellation/failure window cleans safely, `READY=1` alone establishes startup, `STATUS=result-published` remains distinct, retained result IPC is ingested before explicit stop, `ExecStopPost` runs after writer termination but before terminal verification, exact cross-UID IPC/root GC/hostile containment remain intact, and command behavior is unchanged. Commit only Task 5 files as `refactor: add cross-uid systemd subscription transport`.

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

## Task 10: Implement durable normalization attempts, candidate-domain finalization, fallback, and Phase-A compatibility

**Spec:** Sections 16–20, 22, 27; residual finding R2.

**Files**
- Create: `apps/worker/src/providers/normalization-execution-coordinator.ts`
- Create: `apps/worker/src/providers/normalization-execution-coordinator.test.ts`
- Create: `apps/worker/src/providers/normalization-execution-coordinator.integration.test.ts`
- Create: `apps/worker/src/normalization-writer-mode.ts`
- Create: `apps/worker/src/normalization-writer-mode.test.ts`
- Modify: `apps/worker/src/jobs/normalize-opportunities.ts`
- Modify: `apps/worker/src/jobs/normalize-opportunities.integration.test.ts`
- Modify: `apps/worker/src/handlers.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `packages/ai-router/src/router.ts`
- Modify: `packages/ai-router/src/router.test.ts`
- Modify: `package.json`
- Test: coordinator, normalization/domain finalization, writer-mode startup, and router files

**Interfaces**
- Consumes: both lease identities, catalog/runtime bindings, attempt/analysis/candidate-finalization repository, semaphore, sandboxed adapters, existing analysis ownership, and `read_normalization_writer_capability()`.
- Produces: `NormalizationExecutionCoordinator.execute`, staged-winner recovery, exactly-once candidate-domain finalization, durable exclusions, canonical fallback, and immutable Phase-A legacy-writer artifact.

- [ ] Write failing tests for exact mode comparators, PAYG prefilter, three distinct external attempts, durable exclusions, one proven-not-consumed replacement, every failure-matrix fallback decision, no fallback on caller/job/shutdown cancellation, Codex fail→Grok success, HTTP fail→Codex success, all-fail no-winner attribution, analysis-finalized crash before domain commit with completed-analysis re-claim, domain-committed crash before job completion, stale job/analysis epochs, generation/state conflict, exact-repeat domain idempotency, DB-derived authoritative output semantics, transactional cluster/link/candidate/decision writes, no-winner defer, Phase A accepting only `legacy`, Phase A refusing `canonical`, and Phase A enqueueing only through the locked legacy RPC. Run `pnpm --filter @ara/ai-router exec vitest run src/router.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/normalization-execution-coordinator.test.ts src/providers/normalization-execution-coordinator.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts src/normalization-writer-mode.test.ts`; expected RED is missing coordinator clean cutover, completed-analysis reclaim, DB-derived candidate-domain RPC consumption, and locked immutable Phase-A capability guard.
- [ ] Keep router a pure ranker over persisted eligibility/exclusions. Coordinator order is exact: claimed job+analysis epochs → reconcile history/staged winner → finalize analysis winner then candidate domain, or route → acquire adapter semaphore → cancellation check → `begin_ai_provider_attempt` with both leases/bindings → commit start → sandbox start → append outcome/stage winner → runtime CAS → finalize analysis then candidate domain, or allowed fallback → release semaphore in `finally`.
- [ ] Preserve one analysis/input hash. After `finalize_ai_analysis_from_attempt`, call identity-only `finalize_normalized_candidate` with both current epochs, job/candidate/generation/expected state, and winning attempt; the RPC reads the stored digest and derives every domain value from authoritative finalized JSONB. On job reclaim, a completed analysis without a ledger first obtains a fresh finalization-only analysis epoch through `claim_completed_ai_analysis_finalization`; a matching ledger returns `already_committed` and proceeds to job completion. No provider routing/replay occurs in either crash window.
- [ ] Clean cutover `normalize-opportunities.ts`: delete `linkAnalysisEntity`, `upsertCluster`, `persistClusterLink`, and `persistDecision`; remove every successful direct service-role write to `ai_analysis_entities`, `niche_clusters`, `niche_cluster_keywords`, `candidates`, and `decision_history`. Replace the successful path with one repository call to `finalize_normalized_candidate`; replace exhausted-capacity direct mutation with `defer_candidate_normalization`. Do not retain a dual write or compatibility fallback.
- [ ] After every legacy direct `upsert_niche_cluster` callsite is removed, revoke `service_role` EXECUTE on `public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text)` in the Task-10 clean cutover; explicitly keep/reapply denial for PUBLIC, `anon`, and `authenticated`. Add Task-10 RED/GREEN actual-role tests proving the legacy call succeeds before cutover, fails for `service_role` after cutover, and canonical `finalize_normalized_candidate` still performs cluster mutation internally. After this revocation, only authority-owned canonical finalization may invoke cluster mutation.
- [ ] Replace production `NormalizeJobDependencies.provider/modelId` with coordinator and pass both lease identities from handler context/analysis claim. No eligible provider durably fails/defers the same analysis/candidate without replay; no-winner attribution remains null and subscription USD is never fabricated.
- [ ] Define `NORMALIZATION_WRITER_MODE = 'legacy'` and build-generated `NORMALIZATION_WRITER_RELEASE_SHA` in the immutable Phase-A artifact; expose them through `pnpm --filter @ara/worker writer:identity`. At worker startup call `read_normalization_writer_capability()` and exit nonzero unless exactly one row returns `legacy`; missing/unknown/`canonical` fails before claims or enqueue. Phase A understands legacy and canonical generation-zero records for safe draining, but `daily-research.ts` invokes only `enqueue_initial_candidate_normalization(..., 'legacy')`; it has no direct queue insert for normalization. Record the Task-10 commit SHA as the Phase-A release identity.
- [ ] Run `pnpm --filter @ara/ai-router exec vitest run src/router.test.ts && pnpm --filter @ara/worker exec vitest run src/providers/normalization-execution-coordinator.test.ts src/providers/normalization-execution-coordinator.integration.test.ts src/jobs/normalize-opportunities.integration.test.ts src/normalization-writer-mode.test.ts && pnpm --filter @ara/ai-router test && pnpm --filter @ara/ai-router typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && git diff --check`; expected GREEN is canonical fallback, dual-epoch winner/domain recovery, no direct domain writes, fenced no-winner defer, and a legacy-only Phase-A artifact that cannot run after canonical cutover. Commit only Task 10 files as `worker: finalize normalization domains crash safely`.

## Task 11: Fence writers, normalize legacy generation zero, and release Phase B

**Spec:** Section 22 and Plan 04 pipeline boundary.

**Files**
- Create: `supabase/migrations/202608290022_rearm_normalization_generation.sql`
- Create: `packages/db/src/normalization-rearm-repository.ts`
- Create: `packages/db/src/normalization-rearm.integration.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/shared/src/ai.ts`
- Modify: `apps/worker/src/normalization-writer-mode.ts`
- Modify: `apps/worker/src/normalization-writer-mode.test.ts`
- Modify: `apps/worker/src/jobs/daily-research.ts`
- Modify: `apps/worker/src/jobs/daily-research.integration.test.ts`
- Modify: `apps/web/app/api/research-now/route.ts`
- Modify: `apps/web/app/api/research-now/route.test.ts`
- Modify: `apps/worker/src/jobs/probe-ai-provider-readiness.ts`
- Modify: `package.json`
- Test: writer-mode, rearm, legacy cutover, daily, Research Now, and readiness tests

**Interfaces**
- Consumes: migration-019 generation, migration-021 read-only `legacy` capability, immutable Task-10 Phase-A artifact, runtime eligibility, analysis/job ownership, and legacy `normalize:<candidateId>` jobs.
- Produces: fenced migration-022 in-place rewrite plus atomic capability flip, `rearm_candidate_normalization`, deterministic generation keys, and immutable Phase-B canonical-writer artifact.

- [ ] Write failing cases for exact Phase-A/Phase-B artifact identity, Phase A refusing canonical, Phase B refusing legacy/missing capability, legacy queued/running/completed/failed jobs, AI Screening/Waiting/advanced candidates, stopped-old-writer prerequisite evidence, duplicate legacy+`:0` collision abort, malformed/mismatched payload abort, capability flip rollback on any rewrite failure, no legacy key after commit, current usable provider, active ownership exclusion, concurrent rearm callers, failed insert rollback, reclaim generation preservation, Research Now producing only `DAILY_RESEARCH`, and normalization before Market Probe. Run `pnpm --filter @ara/db exec vitest run src/normalization-rearm.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/normalization-writer-mode.test.ts src/jobs/daily-research.integration.test.ts && pnpm --filter @ara/web exec vitest run app/api/research-now/route.test.ts`; expected RED is missing migration-022 atomic rewrite/capability flip and canonical-only Phase-B artifact.
- [ ] Build and record two immutable release identities, never a mutable runtime/browser/operator flag. Phase A is exactly the Task-10 artifact: identity command returns `legacy` plus recorded SHA, startup requires DB `legacy`, and initial scheduling calls only the shared-lock RPC with `legacy`. Phase B is exactly the Task-11 artifact: identity command returns `canonical` plus recorded SHA, startup requires DB `canonical`, and initial scheduling calls only that RPC with `canonical`. Each artifact fails startup against the other mode before claims/enqueue; the RPC independently rejects wrong-mode calls.
- [ ] Before migration 022, deploy Phase A with migrations 019–021 and prove its identity/guard/RPC key behavior. Enter the full writer fence: `systemctl disable --now amazon-research-daily.timer`; `systemctl stop amazon-research-daily.service amazon-research-worker.service`; wait for all three units inactive and `MainPID=0`; confirm no worker/daily process; settle or record running job/analysis leases under the existing epoch contract. Keep Phase A stopped for the entire migration. Research Now is not a normalization writer: its route may enqueue only higher-level `DAILY_RESEARCH`, which remains inert while the worker is stopped and is processed by Phase B later; tests reject any direct normalization insert from web.
- [ ] In one migration-022 transaction, first acquire exclusive `pg_advisory_xact_lock(7241304022)`, which waits for every in-flight shared-lock enqueue RPC and prevents another until commit. Then require singleton capability exactly `legacy`; lock matching jobs/candidates; abort with sanitized IDs before mutation on malformed payload, nonmatching candidate, or simultaneous legacy and canonical key; deterministically rewrite every exact `normalize:<uuid>` to `normalize:<uuid>:0` and add `normalizationGeneration: 0`, preserving job ID/status/lease/attempt/checkpoint/history; atomically update the singleton to `canonical` with migration identity `202608290022`. Any assertion/rewrite/flip failure rolls back all data/capability and releases the lock; stopped Phase A prevents a later legacy caller, and both its startup guard and RPC mode check reject one after the flip.
- [ ] Before releasing the fence, run exact database assertions documented in Task 14: zero exact legacy keys; zero legacy/`:0` collisions; every rewritten payload has candidate match and numeric generation `0`; no malformed canonical key; singleton mode/migration identity is `canonical`; and an exclusive-lock cutover test proves a concurrent old-mode enqueue cannot commit. Verify the artifact identity command equals the recorded Phase-B SHA, deploy/start it, prove its startup guard accepted canonical and a canonical-mode RPC inserts only the canonical key/payload, then enable/start `amazon-research-daily.timer`. Phase A must never restart after the flip.
- [ ] Implement `rearm_candidate_normalization` as one service-role transaction: lock candidate, analysis/job/runtime rows; verify expected state/generation and current routability; require no active ownership; calculate next generation; insert one queued `normalize:<id>:<next>` job; update generation only after insert; duplicate callers return that job.
- [ ] Phase B changes the immutable constants to `NORMALIZATION_WRITER_MODE='canonical'` and its release SHA. Initial scheduling always calls `enqueue_initial_candidate_normalization(..., 'canonical')`, producing canonical keys and `normalizationGeneration`, including zero. Extend provider-ready/Research Now Waiting paths to `rearm_candidate_normalization`. Verify payload generation plus both lease identities on claim/reclaim; no rearm writes Ready-for-API state.
- [ ] Rollback after migration 022 may deactivate/fence adapters and stop Phase B, but may start only a canonical-key-compatible artifact derived from Phase B. Never restart Phase A. Reverse data migration requires a new reviewed migration under the same full writer fence; ordinary rollback does not rename keys or flip capability back.
- [ ] Run `pnpm --filter @ara/db exec vitest run src/normalization-rearm.integration.test.ts && pnpm --filter @ara/worker exec vitest run src/normalization-writer-mode.test.ts src/jobs/daily-research.integration.test.ts && pnpm --filter @ara/web exec vitest run app/api/research-now/route.test.ts && pnpm --filter @ara/db test && pnpm --filter @ara/db typecheck && pnpm --filter @ara/worker test && pnpm --filter @ara/worker typecheck && pnpm --filter @ara/web test && pnpm --filter @ara/web typecheck && git diff --check`; expected GREEN proves one in-place generation-zero identity, atomic legacy→canonical capability, startup exclusion on both sides, canonical-only Phase B, and atomic Waiting rearm. Commit only Task 11 files as `feat: cut normalization writers to generation keys` and record that SHA as the Phase-B release identity.

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
- Test: script tests, shell syntax, systemd/polkit/cgroup/nftables/IPC verification on Oracle
**Interfaces**
- Consumes: exact Task-5 templates/lifecycle helper/root-GC/polkit/nftables contract, disabled manifests, probe harness, current Oracle services, and Task-10/11 immutable writer identities.
- Produces: installed dedicated UIDs/auth homes/IPC groups/templates/profile drop-ins/endpoint policy, repeatable evidence, exact Phase-A/fence/migration/Phase-B runbook, and safe rollback; it cannot substitute another primitive.

- [ ] Write failing fixture tests for wrong systemd version/cgroup mode/nftables support, UID/GID membership, parent/invocation/file owner/mode/path/digest, cross-adapter access, shared auth home, mutable unit/helper/GC/drop-in/ruleset, env/journal leakage, forbidden fs/exec/network access, and atomic file publication. The lifecycle fixture must prove: non-blocking fixed-unit start; root `ExecStartPre` creates the exact UUID directory; a worker-equivalent process verifies it; pre-start remains waiting without `request.json`; worker-equivalent `request.tmp` → `request.json` publication releases validated `ExecStartPre`; only then MAIN starts, validates, emits READY, and becomes active; provider/result publication follows; worker-equivalent reads result before explicit stop; cgroup termination precedes `ExecStopPost`; and terminal/empty/absent verification follows stop completion. Add cancellation/failure fixtures before directory, after directory/before request, and after request/before READY; request-handoff expiry; invalid request; synchronous-start deadlock regression; no-READY timeout; STATUS-without-READY refusal; active/recent/ambiguous GC refusal; aged inactive orphan removal; resolver/endpoint drift; changed bindings; wrong writer artifact/capability pairing; and incomplete writer fence. Run `node --test scripts/probe-subscription-provider.test.mjs`; expected RED is missing exact start-handshake, pre-READY cleanup, READY/result/stop lifecycle, installation/profile, and cutover verification tooling.
- [ ] Implement root-run installation for Ubuntu 24.04: systemd >=255, unified cgroup v2, nftables, polkit, non-login `ara-codex`/`ara-grok`, 0700 auth homes, exact IPC memberships, root/group 0750 parents, and the exact Task-5 templates/protocol: fixed `systemctl start --no-block`; root lifecycle helper validates/creates mode-2770 UUID directory and boundedly waits for fixed `request.json`; worker verifies that directory and atomically publishes the request; helper validates/releases MAIN; MAIN reaches READY before provider execution. Install `Type=notify`/`NotifyAccess=main`, fixed request-handoff and total start budgets, distinct post-READY execution deadline, bounded stop deadline, digest-pinned supervisor/lifecycle helper/GC timer/polkit/nftables policy, fixed drop-ins, configured resolvers, and endpoint prefix sets. Do not introduce a second pre-start helper path, worker-owned directory creation, or another runtime flag. Refuse generic tmpfiles deletion, unsupported capability, human/Hermes/shared homes, symlinks, repo-relative paths, mutable artifacts, cross-group membership, missing reject rules, or broad egress; print no secrets.
- [ ] Probe CLI invokes the same fixed unit/profile and hostile fixture adapter, emits bounded sanitized JSON, and exits nonzero for every missing category. On Oracle, without a live subscription-provider call, prove the actual host handshake: non-blocking start returns while `ExecStartPre` creates the exact UUID directory and waits; worker-equivalent bounded exact-path plus fixed-property polling verifies that directory; no request keeps MAIN absent; atomic request publication releases independently validating `ExecStartPre`; MAIN starts and emits READY only after sandbox validation; provider fixture execution begins only after READY; the unit is active only then; STATUS without READY cannot establish startup; atomic result publication changes exact `StatusText=result-published` while MAIN and `result.json` remain available; reader ingestion precedes explicit stop; stop terminates cgroup writers, then runs `ExecStopPost`, then reaches terminal state; only afterward are inactive/failed, empty cgroup, and absent directory asserted. Prove cancellation/failure at before-directory, directory-before-request, and request-before-READY boundaries, invalid request, request-handoff timeout, start failure before/after directory, and no synchronous-start deadlock. Also verify systemd security/artifact hashes/live nft semantics/service UID/cgroup, all IPC ownership/modes, cross-adapter denial, liveness-aware GC, null stdout/stderr/no journal dependency, resolver-only 53, accepted-prefix-only 443, denial elsewhere, and auth persistence. Any failed transition, denial, cleanup order, or drift blocks activation.
- [ ] Harden the worker service without arbitrary unit control. Document exact rollout checkpoints: apply 019–021 → deploy recorded Phase-A SHA → assert identity command, DB `legacy`, startup, legacy-only shared-lock RPC writes, and HTTP behavior → install Task-5 sandbox → collect disabled acceptance evidence → activate accepted adapter and get current-generation Ready → prepare/verify Phase-B artifact but do not start it → `systemctl disable --now amazon-research-daily.timer` → `systemctl stop amazon-research-daily.service amazon-research-worker.service` → verify all inactive/`MainPID=0`, no worker/daily PID, and record/settle leases → apply migration 022 while holding the exclusive advisory xact lock → run zero-legacy/collision/payload/capability/concurrent-old-writer assertions → deploy/start recorded Phase-B SHA → assert identity, canonical startup, and canonical-only RPC enqueue → enable/start daily timer. Higher-level `DAILY_RESEARCH` rows queued by Research Now during the fence are allowed; no process may transform them until Phase B.
- [ ] Put copy-pasteable SQL in the runbook to exercise shared/exclusive `7241304022` lock serialization and count exact legacy `normalize:<uuid>` keys, legacy/`:0` collisions, malformed key/payload/generation mismatches, running normalization jobs with lease identities, and singleton capability/migration identity. Every defect/legacy count must be zero, exactly one canonical capability row must exist, the recorded Phase-B identity command must match, and a wrong-mode RPC call must fail before enabling the timer; capture sanitized results with both artifact SHAs.
- [ ] Document rollback: deactivate subscription providers; stop/kill adapter cgroups; settle attempts; increment auth generation only when auth changes; preserve or supported-revoke credentials; retain events/staged winner/domain-finalization ledger. Before migration 022, stop Phase A normally. After migration 022, stop Phase B and deploy only a tested canonical-compatible Phase-B-derived artifact; never start Phase A or rename data back. A reverse rewrite/capability flip is a separately reviewed forward migration under the full writer fence, never an application rollback step.
- [ ] Run `node --test scripts/probe-subscription-provider.test.mjs && node --check scripts/probe-subscription-provider.mjs && node --check ops/subscription-providers/subscription-supervisor.mjs && bash -n ops/subscription-providers/install-systemd-sandbox.sh && bash -n ops/subscription-providers/install-auth-homes.sh && bash -n ops/subscription-providers/verify-runtime-profile.sh && git diff --check`; expected local GREEN validates the exact non-blocking start/directory-wait/request-release/MAIN/READY fixture; all pre-READY cancellation, invalid-request, request-timeout, and start-failure boundaries; previous READY/result/retention/stop/`ExecStopPost` order; root-GC and hostile-profile fixtures; and Phase-A/fence/Phase-B runbook syntax. On Oracle additionally require `systemd-analyze verify ops/systemd/amazon-research-codex@.service ops/systemd/amazon-research-grok@.service ops/systemd/amazon-research-subscription-gc.service ops/systemd/amazon-research-subscription-gc.timer ops/systemd/amazon-research-worker.service`, the same fixture-adapter handshake/readiness/result/stop probes, hostile IPC/network/GC probes, and recorded writer/capability queries before acceptance. Commit only Task 14 files as `ops: prepare subscription provider acceptance`.

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
- Consumes: Gate 1 plus at least one fully passed adapter gate, recorded Phase-B artifact, DB capability `canonical`, active compatible worker, Ready lease, `rearm_candidate_normalization`, attempt events, `normalized_candidate_finalizations`, and Plan 04 market pipeline.
- Produces: evidence that the controlled candidate recovers naturally under the canonical writer, finalizes its candidate domain exactly once, executes real normalization, and preserves cached API work across restart.

- [ ] Write verifier tests `rejects manual candidate state hacks`, `requires recorded phase b artifact and canonical capability`, `requires one canonical generation-keyed job`, `requires immutable attempts and finalized winner`, `requires exactly one matching candidate finalization and decision`, `rejects direct or duplicate cluster candidate decision writes`, and `requires cached api_fetched reuse after restart`. Run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs`; expected RED is missing verifier and Phase-B/domain-finalization evidence.
- [ ] Implement read-only sanitized evidence verification only; run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs`; expected GREEN is bounded PASS/FAIL without mutation.
- [ ] Preflight exact recorded Phase-B SHA through `writer:identity`, migrations through 022, singleton capability `canonical`, Phase-A absence, canonical-only startup/locked-RPC key behavior, accepted sandbox/profile, current Ready/probe generation, candidate Waiting generation, no active ownership, and no PAYG. Trigger only via provider-ready/Research Now/daily rearm; verify one canonical generation-keyed job without manual cleanup or state/key edits.
- [ ] Observe real normalization, immutable attempt chain, `finalize_ai_analysis_from_attempt` winner attribution, then one matching `normalized_candidate_finalizations` row covering analysis entity, optional cluster/link, candidate transition, and exactly one decision. If crashing after analysis finalization but before domain commit, verify the reclaimed job uses `claim_completed_ai_analysis_finalization` for a new finalization-only epoch and calls `finalize_normalized_candidate` without provider routing/replay; if crashing after domain commit but before job completion, verify `already_committed` and no duplicate domain writes.
- [ ] Reach natural `Ready for API Validation`, then real `api_fetched`; restart worker and verify event/finalization reconstruction, cached fetch reuse, and no duplicate paid work. A start/outcome crash retains unknown and distinct-provider/Waiting behavior.
- [ ] Run `node --test scripts/verify-plan-04-subscription-acceptance.test.mjs && pnpm exec turbo run test --force && pnpm exec turbo run typecheck --force && pnpm exec turbo run lint --force && pnpm exec turbo run build --force && pnpm --filter @ara/web test:e2e && pnpm run test:integration && git diff --check`; on Oracle also require documented `systemd-analyze verify`, hostile probes, exact Phase-B/capability assertions, and runtime/finalization queries. Expected GREEN is complete controlled acceptance with canonical writer identity and exactly-once candidate domain. Commit only verifier/tests/record as `docs: record subscription provider Plan 04 acceptance`; failed gates are recorded as failure, never acceptance.

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

- After Task 4 / Checkpoint 1: local migrated database proves preflight, repeatable probe generation, activation CAS, dual lease epochs, atomic starts, immutable outcomes, exactly-once analysis and candidate-domain finalization, fenced no-winner transition, and immutable legacy writer capability. Authority acceptance requires no unauthorized direct mutation of protected provider, attempt, or finalization surfaces. The one known pre-Task-10 exception is exact-signature `upsert_niche_cluster`, temporarily executable by `service_role` only because the approved current coordinator depends on it and Task 10 owns its removal and revocation; this must never be generalized to permit other generic authority helpers.
- After Task 5: the worker can execute the non-blocking start → root `ExecStartPre` exact-directory creation/bounded wait → worker directory verification/atomic request publication → helper release → MAIN validation → READY handshake without deadlock; every pre-READY cancellation/failure boundary and the existing result/stop cleanup lifecycle pass alongside exact cross-UID fixed-file IPC, no-journal results, liveness-aware root cleanup, concrete templates, and policy artifacts before any adapter consumes a request.
- After Task 9: disabled acceptance and enabled current-generation readiness are distinct; inactive adapters cannot route.
- After Task 10: fallback and both winner/domain crash windows are durable and epoch/generation-bound; direct post-analysis domain writes are gone; recorded Phase A writes only legacy keys and refuses canonical DB capability.
- After Task 11: all normalization writers were fenced, migration 022 rewrote history and atomically flipped capability, recorded Phase B writes only canonical keys and refuses legacy, Phase A cannot restart, and Waiting rearm is atomic.
- After Task 13: full local/integration/E2E gates prove HTTP compatibility and mixed-provider accounting.
- After Task 14: Oracle installs and proves the exact Task-5 start handshake and pre-READY failure matrix with a fixture adapter, preserves READY/result/stop/`ExecStopPost` order, hostile-denial verifies the same sandbox/IPC, and exercises the Phase-A/fence/Phase-B runbook; tooling alone activates nothing and no Codex/Grok subscription is consumed for handshake proof.
- After Tasks 15–17: each terms/adapter verdict is independently evidenced; PASS still requires administrative activation and a fresh full Ready probe, while failed gates remain unroutable.
- After Task 18: the controlled candidate proves Phase-B-only natural recovery, both finalization crash windows, exactly-once domain state, and cache reuse without hacks or duplicate paid work.

## Plan Remediation Closure Map

| Finding | Closure |
| --- | --- |
| I1 | Task 5 now has one executable start protocol: after `begin_ai_provider_attempt`, the worker validates fixed identity and uses non-blocking start; root `ExecStartPre` creates/verifies the exact directory and boundedly waits; the worker boundedly observes/verifies it and atomically publishes the request; `ExecStartPre` independently validates/releases MAIN; MAIN validates/initializes, emits `READY=1`, and only then executes the provider. Explicit S0–S5 phases, request-handoff versus total-start versus post-READY deadlines, and every cancellation/start-failure window remove the former directory/publication cycle. Existing exact cross-UID ownership/modes, tmp/fsync/atomic-final handoff, no-journal result retention, distinct `STATUS=result-published`, explicit stop, cgroup termination, `ExecStopPost`, terminal verification, and liveness-aware root GC remain unchanged. Task 14 installs and proves that same protocol and lifecycle on Oracle with a fixture adapter. |
| I2 | Task 4 creates `claim_completed_ai_analysis_finalization`, immutable `normalized_candidate_finalizations`, and one epoch/winner/state/generation-guarded `finalize_normalized_candidate` transaction for analysis entity, cluster/link, candidate, and decision; Task 10 deletes all direct writes, uses fenced defer for no-winner, and proves both crash windows without provider replay. |
| I3 | Runtime `probe_generation`, `request_ai_provider_probe`, generation key, CAS, and repeated/concurrent tests remain in Tasks 1, 3, 9. |
| I4 | Migration 021 creates the capability plus shared-lock mode-checked enqueue RPC; Task 10 produces immutable legacy-only Phase A; Task 11 stops named units, takes the exclusive cutover lock, rewrites and flips capability atomically, then produces canonical-only Phase B with reciprocal startup/RPC guards; Task 14 makes the sequence and post-022 rollback executable. |
| I5 | Disabled acceptance → operator activation RPC → fresh generated probe → Ready remains explicit in Tasks 3, 9, 12, 16–17. |
| I6 | Task 4 stages successful output outside events and defines `finalize_ai_analysis_from_attempt`; Task 10 recovers/finalizes it before candidate domain. |
| I7 | Canonical Failure Matrix remains the source of runtime, retry, consumption, replay, fallback, and logical outcomes for every class. |
| I8 | Task 1 still performs aborting existing-row preflight before validated constraints and tests all legacy shapes. |
| M1 | Every modified task retains a copy-pasteable RED command/reason, full GREEN/regression command/expected result, `git diff --check`, and focused commit instruction. |
| M2 | Milestones attribute fallback/domain recovery to Task 10 and writer cutover/Waiting recovery to Task 11. |

## Commit Strategy

Each task ends in one focused commit. Schema, runtime CAS, attempt/finalization transactions, sandbox, adapters, routing, recovery, UI, regression proof, operations, and live acceptance remain separately reviewable and revertible. Never combine acceptance evidence with infrastructure, amend migrations 001–018, or let Task 14 replace the Task-5 sandbox. Before each commit stage only listed files, inspect the staged diff, run that task’s exact GREEN command, and run `git diff --check`.

## Completion Verdict Rule

Implementation is complete only when Tasks 1–14 pass their exact local/host gates and each adapter remains fail-closed unless Task 15 plus its own Task 16 or 17 passes, `activate_subscription_provider` succeeds, and the subsequent current-generation worker probe issues Ready. Product acceptance is complete only after Task 18 succeeds with at least one accepted adapter. A failed terms, Codex, Grok, sandbox, or endpoint-policy gate is an explicit safe outcome: record failure and keep that adapter disabled; never weaken containment or substitute PAYG.
