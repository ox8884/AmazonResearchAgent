# Subscription AI Providers Design

Date: 2026-08-29
Status: Remediated architecture specification. Design only; not implemented.
Branch baseline: `plan-04-production-automation` at production pipeline commit `98cf5b1a4ed5e8571f17dae1d446761d2b420b8a`
Original design commit: `00abbe97a5d51d91da987d639523849cdbcfbbb8`

## 1. Decision

Use Approach B: two execution families and two dedicated subscription adapters.

| Product choice | Execution family (`kind`) | Adapter | Billing |
| --- | --- | --- | --- |
| OpenAI Codex Subscription | `subscription_command` | `codex` | `subscription` |
| Grok Subscription | `subscription_command` | `grok` | `subscription` |
| OpenAI-Compatible API | `openai_http` | `NULL` | `free`, `subscription`, or `payg` |

The legacy `command` family remains test-only and fails closed in production. It is not the Codex or Grok product implementation.

The immediate and only subscription-provider role in this cycle is `niche_normalization`. Automatic PAYG fallback remains off. A subscription adapter must use supported subscription/OAuth authorization; it must never silently select an API key, custom endpoint, unrelated credentials, provider override, or PAYG API billing.

## 2. Goals and non-goals

### Goals

- Present the three product choices above without exposing implementation details.
- Use supported subscription access when the pinned client and account/product terms permit it.
- Fail closed until credential source, client identity, capability, and containment are proven.
- Preserve the existing `openai_http` provider and Plan 04 pipeline architecture.
- Recover candidates durably after AI capacity returns.
- Produce immutable evidence for every provider attempt without recording secrets or sensitive prompts.

### Non-goals

- Production code, migrations, deployment, provider installation, authorization, or Oracle state changes in this design session.
- Browser-cookie scraping, undocumented endpoint replay, raw-token import, or generic API-key use under a subscription label.
- A generalized agent platform or subscription roles beyond `niche_normalization`.
- User-configurable executable paths, argv, shells, working directories, auth homes, or command profiles.
- Per-call USD accounting for subscription usage.
- Moving normalization enqueue back into import or bypassing the frozen Plan 04 workflow.

## 3. Verified current architecture

The repository currently has `openai_http` and test-only `command`, billing classes `free|subscription|payg`, provider-owned models, role/capability filtering, and `allowPaidFallback=false` enforcement. The worker catalog and web API use `openai_http` followed by catch-all command handling, so adding a kind without exhaustive dispatch would be unsafe.

The generic `CommandProvider` is only a transport starting point. It currently uses `spawn(..., { shell: false })`, an environment allowlist, timeout, process-group termination on Linux, and a **2 MiB limit per stream**, not a combined limit. It buffers output until exit, has no adapter-specific auth or parser semantics, and must not be treated as a production subscription adapter.

HTTP provider keys are encrypted in the server/web write path and decrypted worker-side; the UI receives only `last4`. Existing HTTP Test Connection can issue a real structured completion and can consume quota or money. Current Settings supports Disable but does not establish an existing Delete flow.

The daily normalization sweep selects `AI Screening` candidates and uses fixed idempotency `normalize:<candidateId>`. A terminal job therefore prevents natural recovery of a candidate in `Waiting for AI Capacity`. Pipeline commit `98cf5b1a4ed5e8571f17dae1d446761d2b420b8a` correctly schedules accepted imports through the daily orchestrator; this design preserves that boundary.

## 4. Normative subscription-provider routability gate

A Codex or Grok provider MUST be unavailable and unroutable until every current adapter-specific item below passes:

1. fixed binary and execution identity attestation;
2. supported subscription/OAuth credential-source attestation;
3. dedicated app-managed auth-home identity and ownership validation;
4. current `authGeneration` match;
5. adapter/model capability proof for the structured `niche_normalization` contract;
6. hostile agent/tool containment proof;
7. provider `settingsRevision` match;
8. current health/execution probe success;
9. matching execution fingerprint and security-profile version;
10. applicable deployment terms/readiness approval.

None of the following alone, or in combination without all gates above, can set `available=true`: `billing_type=subscription`, an enabled provider row, a model row, installed executable, authenticated login status, UI status, previous successful probe, or a Ready label.

Routability is computed from the one worker-owned authoritative runtime record defined below. Missing, stale, contradictory, unknown, or unverifiable evidence MUST produce `available=false`. A stale completion is discarded. No operator, web request, provider row, or model catalog write can directly mark a subscription adapter Ready.

## 5. Credential-source attestation

The adapter must inspect the **effective runtime credential and endpoint configuration** of the exact pinned client invocation, not infer it from database labels or the absence of `provider_secrets`.

### Codex

The production client must prove that the exact execution profile uses supported ChatGPT/Codex subscription authorization. API-key login, raw access-token injection, environment API-key fallback, custom endpoints, and provider overrides are prohibited. Local client help is not Oracle runtime proof.

### Grok

Grok is independently gated. The production client must prove supported OAuth/subscription authorization and prove that configuration precedence does not select an API key, environment key, or custom endpoint. No xAI API PAYG fallback is permitted.

If the effective source cannot be proven, state is `authorization_required` or `needs_attention`, and `available=false`.

## 6. Codex and Grok are agent-capable clients

The application contract is narrow:

```text
structured niche-normalization input
  -> one bounded adapter invocation
  -> schema-validated normalized output
```

The client must receive no broader application authority. Codex and Grok may otherwise expose filesystem, process, network, tools, MCP, hooks, rules, user/project config, sessions, memory, subagents, or provider overrides. A logical “read-only sandbox” is not sufficient evidence of containment.

Each adapter must have an immutable, app-owned execution profile containing only verified mechanisms for its pinned client version. The profile cannot be edited through the database or UI.

## 7. Execution containment requirements

Every subscription invocation requires all of the following:

- fixed absolute executable path;
- owner, mode, version, and digest verification before use;
- immutable app-controlled adapter/security profile identity;
- dedicated app-managed auth home;
- fresh, empty OS-level invocation directory, never the production repository and never inherited arbitrary `cwd`;
- strict child environment allowlist built from an empty base;
- no inherited `SUPABASE_SERVICE_ROLE_KEY`, Jungle Scout key, Telegram token, provider encryption key, worker env file contents, or unrelated credentials;
- `shell=false`, no shell interpolation, no free-form executable, argv, prompt path, or environment settings;
- fixed adapter-specific arguments proven against the pinned client;
- prompt over stdin when supported; otherwise per-invocation `0700` directory and `0600` artifact with crash cleanup;
- explicit controls preventing inherited user/project config, rules, hooks, MCP, sessions, memory, subagents, and provider overrides;
- bounded combined stdout+stderr bytes, in addition to per-channel parser bounds;
- streaming-safe adapter-specific framing/parser, never generic “find first/last brace” extraction;
- strict output-schema validation and rejection of trailing or unrelated data;
- timeout, `AbortSignal` propagation, cancellation, process-group termination, and escalation to hard kill;
- cleanup on success, failure, timeout, cancellation, and worker restart;
- sanitized error classification and bounded fallback;
- per-adapter concurrency ownership.

No CLI flag or config mechanism is assumed by this specification. Exact controls are implementation acceptance evidence. If a pinned client cannot prove the required boundary, that adapter remains unavailable.

## 8. Hostile isolation acceptance probe

Before an adapter can become routable, a repeatable automated probe running as the production service identity must attempt and prove denial of:

- reads of production source, `/etc/amazon-research/worker.env`, unrelated home files, SSH material, Hermes files, and credentials outside the adapter auth home;
- writes outside the approved invocation directory;
- unintended subprocess or shell execution;
- arbitrary network egress beyond the minimum verified provider traffic;
- MCP, hooks, inherited rules/config, tools, subagents, session reuse, and memory persistence.

The probe must also verify that invocation artifacts are removed and that a later invocation cannot observe prior prompt/session state. Results bind to binary digest, adapter profile, auth-home identity, security-profile version, and host isolation policy. Any changed binding invalidates Ready. The gate is never weakened to obtain a pass.

## 9. Dedicated adapters and executor reuse boundary

Create adapter semantics for `CodexSubscriptionAdapter` and `GrokSubscriptionAdapter`. Each owns:

- immutable execution profile and fixed binary identity;
- effective credential-source inspection;
- auth inspection and readiness probe;
- model/capability mapping;
- argv construction;
- output framing and parsing;
- structured result validation;
- adapter-specific error, auth-expiry, quota/capacity, and retry classification.

Only safe low-level primitives may be extracted from `CommandProvider`: process spawn, cancellation, timeout, bounded I/O, and process-group termination. The production adapters do not accept `CommandProviderConfig`, generic command profiles, database executables, or database argv. Legacy `command` remains application-fail-closed in production.

## 10. Database model: migration 019+

Migrations 001–018 remain byte-for-byte frozen. Implementation begins at 019+.

Add a first-class nullable `ai_providers.adapter` constrained to `codex|grok`, plus database CHECKs enforcing:

| Kind | Adapter | Billing | Secret |
| --- | --- | --- | --- |
| `openai_http` | `NULL` | `free|subscription|payg` | optional HTTP API secret |
| `command` | `NULL` | existing test classifications | production execution prohibited |
| `subscription_command` | `codex|grok` | exactly `subscription` | prohibited |

Additional database invariants:

- a partial unique index permits at most one `subscription_command` provider row per adapter in MVP;
- subscription provider/model billing classifications must agree;
- model IDs remain provider-owned;
- subscription models remain disabled until adapter-owned capability proof passes;
- a subscription provider cannot own a `provider_secrets` row;
- family-specific configuration fields are rejected across families;
- unknown kind or adapter is rejected/fails closed.

The provider execution family is immutable after creation. Normal edit cannot convert `openai_http` to `subscription_command` or the reverse. MVP lifecycle is disable, explicitly clean up/revoke credentials where applicable, then recreate. A future conversion requires a separately reviewed transaction that removes incompatible secret material and invalidates runtime/auth state atomically.

## 11. Single authoritative auth and health state

Use one worker-owned `ai_provider_runtime_state` row per provider. Do not persist `config.authStatus` or any competing mutable auth truth.

Required fields:

- `provider_id` primary key;
- `state`: `authorization_required|ready|expired|needs_attention`;
- `available` boolean, constrained so only `state=ready` can be true;
- sanitized `reason`;
- `checked_at`;
- persisted `ready_valid_until`;
- nullable worker-owned `retry_not_before`;
- bounded transient-failure count used only to derive retry timing;
- `settings_revision`;
- `execution_fingerprint`;
- monotonically increasing `auth_generation`;
- `security_profile_version`;
- adapter capability/containment attestation references or digests.

The authoritative freshness semantic is a persisted readiness lease. A successful full worker probe writes `checked_at` and `ready_valid_until = checked_at + 10 minutes` in the same transaction using the database clock. Ten minutes is the MVP `readinessMaxAge`: finite and conservative enough to detect subscription auth or client drift without probing before every request. It is trusted server/worker configuration, never browser-controlled provider config. A later tightening changes a trusted readiness-policy version included in the execution fingerprint, invalidates existing Ready evidence, and requires a fresh probe.

A subscription provider is routable only when `state=ready`, `available=true`, database time is strictly earlier than `ready_valid_until`, `retry_not_before` is null, and the current settings revision, auth generation, execution fingerprint, security profile, capability proof, and containment proof all match. At `now >= ready_valid_until`, the row is stale and is unroutable even if it still says Ready/available. The first worker or router observation CAS-writes `available=false` with sanitized reason `readiness_stale` and durably requests the adapter's normal deduplicated readiness probe. Only a successful full probe can issue a new lease; time passage or reaching `retry_not_before` never restores availability by itself.

`Disabled` is derived from `ai_providers.enabled=false`. `Not configured` is derived from a missing/unsupported adapter or binary. UI and router derive all status from the provider row plus this runtime row. Web/API writes cannot set runtime state, expiry, retry timing, or availability.

## 12. Auth generation, fingerprint, CAS, and failure writeback

Increment `authGeneration` whenever auth identity may change: initial authorization, logout, reauthorization, auth-home replacement, credential revocation, provider adoption/reset, or adapter/auth identity change.

The execution fingerprint includes:

- provider kind and adapter;
- absolute binary path, version, and digest;
- immutable execution-profile identity;
- auth-home identity;
- `authGeneration`;
- provider settings revision;
- security-profile version, readiness-policy version, and hostile-probe binding.

Every probe, auth operation, lease-expiry transition, retry suspension, and execution-result writeback uses one CAS bound to provider ID, expected settings revision, expected auth generation, and expected execution fingerprint. A stale probe, auth operation, or execution completion cannot restore or invalidate state produced by a newer event. Auth mutations fence new execution before incrementing generation and invalidate Ready atomically.

Adapter error classification has the following normative MVP writeback:

| Classified result | Authoritative worker writeback |
| --- | --- |
| Auth expired or revoked | `state=expired`, `available=false`, sanitized `auth_expired` reason, clear lease/retry; blocked until supported reauthorization and a successful full probe. |
| Effective credential-source mismatch | `state=needs_attention`, `available=false`, sanitized reason, clear lease/retry. |
| Binary/version/digest/profile mismatch | `state=needs_attention`, `available=false`, sanitized reason, clear lease/retry. |
| Containment attestation failure | `state=needs_attention`, `available=false`, sanitized reason, clear lease/retry and invalidate the containment proof. |
| Capability mismatch | Invalidate the affected adapter/model capability proof and make that model unroutable; if provider-level structured capability or framing proof is invalid, also set provider `state=needs_attention`, `available=false`, and clear lease/retry. |
| Subscription quota/capacity temporarily exhausted | Preserve `state=ready` as identity/auth truth, set `available=false`, reason `temporary_capacity`, and set `retry_not_before` to a sanitized provider Retry-After clamped to 1–15 minutes, or 5 minutes when absent. |
| Recoverable network/client failure | Preserve `state=ready`, set `available=false`, reason `transient_client_failure`, and set `retry_not_before` by deterministic exponential backoff of 30 seconds, 1 minute, 2 minutes, then 5 minutes maximum. |

Temporary suspension never becomes a second auth truth. At or after `retry_not_before`, a fresh full probe is required; success resets the transient count, clears reason/retry, and issues a new ten-minute lease. A failed probe applies the same classifier and bounded timing. Unknown, unsafe, or unclassified failures fail closed as `needs_attention` rather than being mislabeled transient.

After any result that expires, invalidates, or suspends readiness, the CAS writeback completes before the current logical request can select a fallback. Every later router selection reads the current authoritative row and lease and therefore cannot reselect that provider until the required reauthorization/remediation and fresh probe succeed. The current request may consider only another eligible non-PAYG provider.

## 13. Auth-home cardinality and ownership

MVP allows one configured provider row per adapter. Each row owns one dedicated application-managed auth home; Codex and Grok never share one. Multiple-account support is out of scope and would require a distinct auth home per provider row.

Persistent auth state:

- lives outside PostgreSQL and the invocation directory;
- survives deploy/restart;
- is owned by the `amazon-research` service identity;
- uses a `0700` directory and `0600` credential files where supported;
- is not mixed with Hermes or copied from an existing `ubuntu`/human home;
- is never returned to the browser or logged.

The exact supported home mechanism and path are client-version acceptance evidence, not hard-coded from local behavior.

## 14. Authorization MVP and lifecycle semantics

Initial authorization is operator/SSH initiated as the `amazon-research` service identity using the pinned client’s supported subscription/OAuth flow. `TEST_AI_PROVIDER_CONNECTION` is not a login operation. The dashboard shows `Authorization required`, instructions, and last sanitized status; it does not stream raw client output.

A future browser-driven device flow requires a dedicated serialized auth job with incremental parsing, a short-lived challenge, heartbeat, cancellation, expiry, strict projection/redaction, and no raw token/stdout persistence. It is not required for MVP.

Actions are distinct:

- **Disable:** fence future routing by setting `enabled=false`; do not revoke credentials.
- **Reauthorize:** fence new execution, increment auth generation, run the supported operator flow, then perform fresh authoritative attestation/probes.
- **Logout/Revoke:** fence execution first, increment generation, invalidate Ready, invoke the supported client logout/revoke, and report partial failure without exposing output.
- **Delete:** not offered in MVP. Keep a disabled manageable row until supported revocation and explicit credential cleanup complete; do not silently orphan refresh credentials.

Auth mutations are serialized per adapter/auth home.

## 15. Exhaustive provider-kind handling

Every consumer must use exhaustive dispatch for `openai_http`, `command`, and `subscription_command`: shared schemas/types, generated DB types, DB mapper/repository, settings validation, web serialization, UI forms/cards, worker catalog, provider factory, probe job, auth status, router, execution, and tests.

No `if openai_http else command` branch may remain. Unknown kind/adapter is unavailable, surfaced as unsupported/Needs Attention where representable, and never enters legacy command execution.

## 16. Router priority semantics

Preserve the current mode-specific comparator and explain it in the UI:

- **Saver:** billing class first, then role/provider priority, then model quality.
- **Balanced:** role/provider priority first, then billing class, then model quality.
- **Highest Quality:** model quality first, then role/provider priority, then billing class.

Lower numeric priority wins at the priority step. Provider priority is therefore not a universal fallback order. With `allowPaidFallback=false`, PAYG providers/models are removed before ranking in every mode.

Eligibility also requires enabled provider, `state=ready`, persisted `available=true`, database time before `ready_valid_until`, no `retry_not_before`, exact settings/auth-generation/execution-fingerprint bindings, matching role, adapter-owned proven model capabilities, and consistent provider/model billing. Selection never trusts an in-memory Ready snapshot without rechecking these persisted predicates.

## 17. Execution-time precondition, writeback, and non-PAYG fallback

Preflight health is not sufficient. After acquiring the adapter semaphore and immediately before any external client spawn/network/provider consumption, the worker re-reads the authoritative runtime row and verifies every routability predicate, including the readiness lease and CAS bindings. The same transaction that authorizes the invocation must assert those predicates and commit the `attempt_started` event described below. If the lease is expired or any binding changed, no attempt event is created and no client executes: the worker CAS-marks unavailable where needed, durably runs/requeues the deduplicated supported readiness probe, and defers or reroutes through the normal worker flow. A stale Ready row can never launch a child process.

One logical normalization request may make at most three externally consumable, distinct-provider attempts. Each provider is externally executed at most once. After a classified recoverable failure, its authoritative runtime writeback must commit first; the router then reroutes the same logical analysis/request/role with the durable attempted-provider set excluded.

Eligible fallback classes are authentication expiry, timeout, subscription quota/capacity, temporary adapter unavailability, and explicitly classified recoverable client failure. Invalid input/output schema, business-rule failure, unsafe output, containment failure, capability mismatch, or unknown error is not cross-provider fallback unless a reviewed classifier proves it is provider-transient. Containment failure immediately invalidates adapter readiness. Runtime state changes follow Section 12 and are never inferred merely from whether fallback succeeded.

Fallback preserves logical analysis ownership and request identity, records each attempt through the write-ahead event model, and never duplicates a successful or possibly consumed attempt. It never selects PAYG when `allowPaidFallback=false`. After all eligible non-PAYG providers or the three-attempt bound are exhausted, durably defer to `Waiting for AI Capacity`/Needs Attention.

## 18. Per-adapter concurrency

Current deployment is one worker process. Use one in-process semaphore per adapter with MVP limit 1 because each adapter owns one mutable auth home/client state. Acquire immediately before process execution and release in `finally` on success, failure, timeout, or cancellation. Worker process restart clears local semaphore state after child process-group cleanup.

Queue leases and analysis leases are not concurrency controls. Before introducing multiple worker processes or hosts, replace or augment the local semaphore with a durable distributed lease/semaphore keyed by adapter/auth home.

## 19. Crash-safe immutable provider-attempt events

Migration 019+ adds immutable `provider_attempt_events` as write-ahead execution evidence, separate from final `ai_analysis`/`ai_usage`. Every intended provider invocation receives a stable `attempt_id` and a transactionally allocated, monotonically increasing `attempt_sequence` within its logical analysis.

Before any child spawn, network call, or possible provider consumption, the worker durably appends and commits `attempt_started`. If this commit fails, provider execution is prohibited. The event contains only sanitized metadata:

- `event_id`, `attempt_id`, logical analysis/request ID, and `attempt_sequence`;
- provider ID, model ID, adapter, role, and billing type;
- `started_at` from the database clock;
- settings revision, auth generation, and execution fingerprint;
- nullable `fallback_parent_attempt_id`;
- request-count intent exactly `1`;
- safe job/worker ownership and lease-epoch context needed for reconciliation.

After execution the worker appends exactly one immutable normal outcome where possible: `attempt_succeeded`, `attempt_failed`, or `attempt_cancelled`. It references `attempt_id` and records `finished_at`, latency, sanitized result/error class, reliable token counts only when available, provider/client request-count evidence, fallback relationship, and a consumption status of `consumed|not_consumed|unknown` supported by evidence. The original `attempt_started` event is never updated.

If failure occurs after `attempt_started` commits but the worker can prove that spawn/network/provider execution never began, it appends the reconciliation outcome `attempt_not_consumed` with result class `pre_spawn_failure`, `consumption_status=not_consumed`, and sanitized affirmative proof category. This permits at most one replacement write-ahead attempt with a new `attempt_id` and next `attempt_sequence` for that provider under the bounded job retry policy; it does not count as an externally consumable provider attempt.

If a worker/process/host is lost after `attempt_started` and before an outcome, restart/reclaim reconciliation appends `attempt_unknown_after_crash`. It records `detected_at`, prior `attempt_id`, safe job/worker ownership context, sanitized reason `worker_process_loss`, and `consumption_status=unknown`. It must never claim zero usage. `attempt_not_consumed` is allowed only when durable worker/supervisor evidence affirmatively proves that no child, network call, or provider execution began; an `attempt_started` timestamp alone is not proof. Absence or loss of that evidence always yields `attempt_unknown_after_crash`.

The migration conceptually enforces one `attempt_started` per `attempt_id`, unique `(logical_analysis_id, attempt_sequence)`, and at most one outcome across the normal and reconciliation outcome event types for an `attempt_id`, using unique/partial constraints. Append-only database permissions and constraints prohibit update/delete and contradictory outcomes such as succeeded plus failed or unknown-after-crash. Competing completion and reconciliation writers race on the unique outcome constraint; the loser reloads the committed outcome and does not append another.

Job retry/reclaim reconstructs provider history from durable events, never only in-memory router state:

- succeeded: do not execute that provider again;
- definitive failed/cancelled after possible consumption: provider remains attempted and bounded fallback applies;
- started with no outcome, or `attempt_unknown_after_crash`: reconcile as unknown and exclude that provider from replay;
- `attempt_not_consumed`: one bounded replacement attempt may be allocated because external execution is disproven.

Thus an orphaned Codex attempt may fall back to eligible Grok, but Codex is not silently repeated without an explicit provider-level idempotency guarantee. If no eligible non-PAYG provider remains, the same logical analysis is durably deferred/Needs Attention. Resume preserves logical analysis ownership, role, request identity, and the existing `normalization_generation`; attempt events are subordinate evidence and never create a second normalization ownership system.

No event stores raw prompt, raw stdout/stderr, auth tokens/files, API keys, credential paths/content, or invented subscription USD. A failed or orphaned attempt may still represent one consumed subscription request, and the event model preserves that uncertainty.

## 20. Subscription usage and budget semantics

Subscription usage is logical telemetry: request count, provider, model, adapter, role, latency, success/failure, and reliable token usage if available. It is not per-call monetary spend.

PAYG accounting remains separate and authoritative. PAYG budget exhaustion cannot block valid subscription execution. Subscription quota/capacity exhaustion cannot enable PAYG and instead updates runtime capacity/attention state through worker-owned logic.

## 21. Adapter-owned model capability proof

Catalog existence does not grant routability. Each adapter/model pair must prove the application’s strict structured-output contract for `niche_normalization`, including output framing, schema adherence, cancellation, and bounded behavior. Capability evidence is owned by provider, adapter, binary/profile fingerprint, and model ID.

A model remains disabled/unavailable when proof is absent or stale. Codex and Grok evidence is independent; capability from one cannot be copied to the other.

## 22. Durable recovery from Waiting for AI Capacity

Add `candidates.normalization_generation bigint NOT NULL DEFAULT 0` in migration 019+ and a controlled service-role RPC that atomically rearms normalization.
The RPC may increment generation and insert exactly one queued normalization job with idempotency key `normalize:<candidateId>:<generation>` only when all conditions hold under row locks:

- candidate state is `Waiting for AI Capacity`;
- candidate remains eligible for AI normalization;
- at least one role-compatible non-PAYG provider satisfies every current authoritative routability predicate, including an unexpired readiness lease and no retry suspension;
- no active normalization analysis ownership or queued/running normalization job exists;
- the candidate state/generation observed by the caller still matches.

The generation advances only inside this successful atomic rearm operation. Duplicate callers resolve to the same generation/job; a failed enqueue does not advance generation.

Triggers may be a provider transition to Ready, targeted Research Now, or the daily sweep. The daily sweep must explicitly include eligible Waiting candidates and call the same RPC; it must not mutate state directly. Existing initial `AI Screening` scheduling remains in the daily orchestrator and uses generation 0 semantics.

The named controlled candidate `cccdb1c3-20eb-52ae-bd4f-5c8c0fd63454` must recover through this path after a real provider becomes Ready. No manual candidate SQL, fake Ready/API Validation row, PAYG bypass, duplicate ownership, or Market Probe before successful real normalization is allowed.

## 23. OpenAI-compatible backward compatibility

Subscription work must not regress `openai_http`. Preserve:

- encrypted API-key storage and write-only key UX;
- server-side encryption and worker-side decryption responsibilities;
- HTTPS/domain/IP/credential policy, DNS resolution and IP pinning, metadata/link-local blocking, Host/TLS SNI handling, and SSRF defenses;
- request/response bounds;
- existing execution-probe ownership, extended without weakening;
- provider-owned models and capability checks;
- billing semantics and `allowPaidFallback=false` behavior.

HTTP Test Connection must disclose that it can issue a real completion and consume quota/cost. Subscription auth failures never map into HTTP credentials.

## 24. MVP UI

Add Provider choices are exactly:

1. OpenAI Codex Subscription
2. Grok Subscription
3. OpenAI-Compatible API

Do not expose `subscription_command`, executable/binary path, auth-home path, argv, environment, or command profile. Subscription cards show product name, Subscription, authoritative authorization state, model, fixed role `niche_normalization`, priority, last health/probe time, actionable sanitized reason, operator authorization/reauthorization guidance, and Disable.

API-key/baseURL/model discovery fields remain only for HTTP providers. Grok may remain visible as unavailable/setup-required until all Grok acceptance gates pass. UI text explains mode-specific priority semantics. No extra role UI is prebuilt.

## 25. Mixed-version-safe rollout

Required order:

1. apply migration 019+ with database invariants and disabled-by-default subscription records;
2. deploy worker code that exhaustively understands `subscription_command`, but keeps both adapters unavailable;
3. verify all old `openai_http` and test-only command behavior unchanged;
4. install and pin the adapter executable for the service identity;
5. establish the dedicated auth home;
6. perform supported operator authorization;
7. pass credential-source, binary identity, capability, hostile containment, and current health gates;
8. deploy web support only after every active worker safely understands the new kind;
9. create/enable the provider and `niche_normalization` role only after current worker attestation;
10. recover the controlled Plan 04 candidate through the atomic rearm path.

Web must not create an enabled/routable new kind before worker support. Old/new worker coexistence fails closed. Unknown kinds never enter catch-all command behavior.

## 26. Operational rollback

Rollback order:

1. fence subscription execution and stop new routing;
2. set subscription runtime state unavailable and disable provider rows;
3. cancel or safely resolve in-flight processes/attempts;
4. increment auth generation and invalidate Ready;
5. choose and record credential preservation versus supported revoke/cleanup;
6. retain immutable attempt evidence and handle dependent model/probe rows;
7. transform or remove new-kind provider/model/runtime rows if the older binary cannot read them;
8. verify the older worker sees only compatible provider records;
9. roll back web/worker application code;
10. only then consider a separately reviewed schema narrowing migration.

Rollback is not “revert commit.” Credential files cannot be silently orphaned, and migrations 001–018 are never rewritten.

## 27. Focused test strategy

### Database

- valid and invalid kind/adapter/billing matrices;
- subscription provider cannot own API secret;
- provider/model billing consistency;
- one-row-per-adapter cardinality;
- family immutability and stale-secret prevention.

### Dispatch

- exhaustive kinds in shared, DB, web, worker, probe, auth, router, and execution;
- unknown kind/adapter fails closed;
- legacy command remains production-disabled.

### Auth/state/readiness

- generation increments for every auth mutation;
- stale settings/generation/fingerprint probe or execution CAS is rejected and preserves the newer Ready state;
- Ready evidence inside its ten-minute lease is routable when every other binding passes;
- Ready evidence at/past `ready_valid_until` is unroutable and requires a fresh probe;
- auth expiry after prior Ready writes `expired`/unavailable and later requests cannot select it;
- credential-source mismatch writes Needs Attention/unavailable;
- binary/version/digest/profile mismatch writes Needs Attention/unavailable;
- containment attestation failure writes Needs Attention/unavailable and invalidates containment proof;
- provider-level capability mismatch writes Needs Attention/unavailable, while a model-only mismatch disables only that model;
- temporary capacity writes worker-owned `retry_not_before`, never enables PAYG, and requires a post-delay probe;
- recoverable transient failures use bounded backoff without becoming permanent auth failure;
- logout/reauthorize/probe races;
- auth-home isolation and serialized mutations;
- Disable does not revoke.

### Router/fallback

- exact Saver/Balanced/Highest Quality precedence;
- no PAYG fallback;
- immediate pre-spawn freshness/binding check rejects stale Ready and does not execute;
- execution-time fallback only for approved classes and only after authoritative writeback;
- later requests cannot select invalid, stale, expired, or temporarily suspended providers;
- durable attempted-provider exclusion and three externally consumable attempt bound;
- same logical analysis ownership.

### Concurrency/audit

- adapter limit 1 and release on success/error/timeout/cancel;
- `attempt_started` commit succeeds before provider spawn is allowed;
- failed `attempt_started` persistence means provider never executes;
- death after start but provably before spawn appends `attempt_not_consumed`;
- death after spawn before outcome appends `attempt_unknown_after_crash`, preserves unknown consumption, and excludes same-provider replay;
- Codex started/unknown then Grok success reconstructs both attempts;
- started+succeeded and started+failed each reject contradictory second outcomes;
- failed attempt evidence remains immutable after fallback;
- job resume reconstructs the attempted-provider set from durable events;
- event sanitization excludes prompt/stdout/stderr/auth material and no fake subscription USD is recorded.

### Recovery

- Waiting candidate plus currently leased Ready transition produces exactly one generation-keyed executable job;
- concurrent readiness/daily/Research Now calls do not duplicate ownership;
- job reclaim preserves the same normalization generation and reconstructs attempts from events;
- successful normalization is required before Market Probe.

### Security/capability

- hostile inherited config/rules/hooks/MCP/session fixtures;
- prohibited filesystem reads/writes;
- child environment secret exclusion;
- process/network/tool containment;
- model exists without structured capability remains unroutable;
- combined stdout/stderr bound, cancellation, cleanup, and parser framing.

### HTTP regression

- encrypted write-only secret handling;
- SSRF and DNS/IP pinning policy;
- explicit Test Connection quota/cost disclosure;
- existing routing/billing behavior unchanged.

## 28. Live acceptance sequence

Before using a subscription adapter for the Plan 04 crash/resume acceptance:

1. satisfy terms/deployment readiness gate;
2. install and pin the production client;
3. authorize through the supported subscription flow;
4. prove effective credential source and endpoint;
5. prove hostile containment and structured capability;
6. persist current Ready with a ten-minute lease only through worker CAS;
7. recover the controlled candidate naturally through generation rearm;
8. complete real normalization;
9. reach Ready for API Validation naturally;
10. run Market Probe and wait for actual `api_fetched`;
11. restart the worker;
12. verify cached fetch reuse and no duplicate paid external work.

No state hacks or temporary bypasses.

## 29. Implementation acceptance gates

These are mandatory evidence gates, not assumptions or TODOs.

### IMPLEMENTATION ACCEPTANCE GATE 1 — Provider terms and supported automation

Before production enablement, record that the intended headless subscription use is supported by the provider/client authentication mechanism and applicable account/product terms. Evidence: provider/client documentation or written product confirmation matching the intended service-identity workflow. Failure keeps the adapter disabled.

### IMPLEMENTATION ACCEPTANCE GATE 2 — Codex production identity, auth, capability, and containment

On Oracle as `amazon-research`, record without secrets: absolute binary path, owner, mode, digest, version; supported auth-home mechanism; login status behavior; device-auth output behavior; effective subscription credential source and endpoint; config/rules/hooks/MCP/session isolation; structured output envelope; model selection; timeout/cancellation; filesystem/process/network containment; hostile-probe result; auth persistence across restart. The evidence must bind to one execution/security profile. Any missing item keeps Codex unavailable.

### IMPLEMENTATION ACCEPTANCE GATE 3 — Grok production identity, auth, capability, and containment

After supported installation, independently record the Grok equivalents: fixed binary identity; supported OAuth/subscription login; effective OAuth source with no API-key/custom-endpoint precedence; headless noninteractive execution; model selection; structured output; timeout/cancellation; auth persistence; config/session/memory/tool/MCP/filesystem/process/network containment; hostile-probe result. Codex evidence cannot satisfy this gate. Any missing item keeps Grok unavailable/setup-required.

## 30. Security invariants summary

- Subscription label never substitutes for credential-source attestation.
- Agent client never runs with production repository, worker secrets, inherited config, or broad host authority.
- Ready is worker-owned, current, fingerprint-bound, generation-bound, and fail-closed.
- No database-controlled arbitrary command execution.
- No subscription-to-PAYG automatic fallback.
- No raw auth material, prompts, or stderr in audit/UI.
- No migration rewrite below 019.
- No provider recovery through manual state mutation.

## 31. Design self-review

The remediated design preserves the closed C1, I1–I12, and M1–M2 architecture and closes the two residual independent-review findings:

- R1: persisted ten-minute readiness leases, trusted policy versioning, immediate pre-spawn freshness enforcement, CAS-bound failure-class writeback, explicit auth/capability/containment invalidation, bounded capacity/transient suspension, and later-request exclusion;
- R2: durable write-ahead `attempt_started`, no external execution before commit, immutable single outcomes, honest crash reconciliation, unknown-versus-proven-not-consumed distinction, same-provider replay prevention, durable resume reconstruction, and contradiction-preventing constraints;
- normative credential-source and hostile-containment routability gate;
- dedicated adapter semantics with transport-only executor reuse;
- single worker-owned runtime truth, auth generation, fingerprint, and CAS;
- first-class constrained adapter column and database invariant matrix at migration 019+;
- one row/auth home per adapter and explicit auth lifecycle;
- immutable provider family and no stale secret transition;
- exhaustive dispatch and mixed-version fail-closed behavior;
- deterministic mode-specific priority and bounded non-PAYG execution fallback;
- adapter semaphore and adapter-owned capability proof;
- unchanged generation-keyed durable Waiting recovery ownership;
- ordered rollout/rollback, HTTP security, and preserved `openai_http` behavior;
- unchanged three implementation acceptance gates.

No production behavior is authorized by this document alone. The common terms gate and the relevant adapter-specific implementation acceptance gate must pass before that adapter becomes routable.
