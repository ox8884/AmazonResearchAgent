# Subscription AI Providers Design

Date: 2026-08-29
Status: Design proposal for user review. Not implemented.
Branch baseline: `plan-04-production-automation` @ `98cf5b1a4ed5e8571f17dae1d446761d2b420b8a`

## 1. Goals / non-goals

### Goals

The product must let the operator configure three explicit AI provider modes:

1. OpenAI Codex Subscription
2. Grok Subscription
3. OpenAI-Compatible API

Subscription modes consume the operator’s existing Codex / Grok subscriptions through supported worker-side clients. They must not silently become OpenAI or xAI PAYG HTTP.

The dashboard must make the three choices explicit, support multiple configured providers, and let the operator set routing priority.

PAYG automatic fallback remains off (`allowPaidFallback = false`) unless a later contract changes that default.

### Non-goals

- Implementing this design in this session
- Temporary provider hacks to unblock Plan 04 candidate `cccdb1c3-20eb-52ae-bd4f-5c8c0fd63454`
- Browser cookie scraping, undocumented HTTP replay, or treating ChatGPT/Codex/Grok session tokens as generic API keys
- User-supplied executables or free-form shell commands
- New AI roles beyond existing `AiRole` (immediate use is `niche_normalization`)
- Dollar cost accounting for subscription calls
- Replacing Hermes, changing host timezone, or installing host-global CLIs outside the amazon-research service user
- Changing frozen Plan 03 Jungle Scout / budget engines

## 2. Current architecture

Verified in this worktree:

| Piece | Current fact |
| --- | --- |
| Kinds | `openai_http`, `command` (`ProviderKindSchema` and `ai_providers.kind` CHECK) |
| Billing | `free`, `subscription`, `payg` |
| PAYG gate | `routeAiRequest` skips `billingType === 'payg'` unless `allowPaidFallback` |
| Secrets | `provider_secrets` AES-GCM worker-side; last4 only in UI |
| Command execution | `spawn(..., { shell: false })`, env allowlist, 2 MiB stdout/stderr cap, timeout, process-tree terminate |
| Production command profiles | only `fake-command`, disabled when `NODE_ENV === 'production'` |
| Production catalog | `ai_providers = 0`, `ai_models = 0` |
| Settings UI | `/[locale]/settings/ai` generic form (kind, billing, baseUrl, apiKey, commandProfileId) |
| Probe record | `docs/verification/ai-provider-probes.md` — fake-command and mock HTTP only; real subscription CLIs still gated |

Router already prefers free then subscription then PAYG in Saver mode, and never auto-selects PAYG when fallback is false. Subscription-to-subscription fallback is already possible if both are enabled, healthy, role-compatible, and non-PAYG.

## 3. Environment evidence (auth/clients)

Investigated on 2026-08-29. No login, no inference, no secrets printed.

### OpenAI Codex Subscription — supported path exists

Windows: `codex` on PATH (`AppData\Roaming\npm\codex.cmd`).
Oracle: `/usr/bin/codex` (`codex-cli 0.146.1`). Service user is `amazon-research` with home `/opt/amazon-research`. A separate `/home/ubuntu/.codex` exists and must not be reused.

Official CLI surface used by this design:

- `codex login --device-auth` — headless/device authorization (flag exists; help text is empty, so implementation must capture actual stdout/URL/code rather than invent extra flags)
- `codex login status` — auth health without a model call
- `codex logout` — clear client-managed credentials
- `codex doctor` — install/auth/runtime health
- `codex exec` — non-interactive run
  - prompt from argument or stdin
  - `--output-schema <FILE>` structured JSON
  - `--json` JSONL events
  - `--ephemeral` no session files
  - `--skip-git-repo-check`
  - `-C/--cd` working root
  - `-s/--sandbox read-only`
  - `-m/--model`

Explicitly rejected Codex login modes for subscription:

- `codex login --with-api-key` (PAYG API key)
- `codex login --with-access-token` (raw token paste into stdin)

Codex limitation that the design must not hide: `codex exec` is an agent CLI. Help does not expose a “disable all tools” flag. The adapter must therefore pin sandbox `read-only`, never pass `--dangerously-bypass-approvals-and-sandbox`, use an empty isolated working directory, `--ephemeral`, and `--output-schema`. If implementation cannot prove tool-use is contained, Codex stays gated.

### Grok Subscription — client exists locally, not on Oracle

Windows: `C:\Users\hyj53\.grok\bin\grok.exe`.
Oracle: `GROK_ABSENT` (`command -v grok` empty).

Official CLI surface:

- `grok login --device-auth` (`--device-code` alias) — headless/remote
- `grok login --oauth` — interactive/browser welcome path; not the Oracle default
- `grok logout`
- `grok doctor` — terminal/health, no model listed as required
- `grok models` — catalog listing
- Headless completion: `grok -p/--single`, `--json-schema`, `--output-format json|plain`
- `--sandbox`, `--permission-mode`, `--tools`, `--max-turns`, `--disable-web-search`

Grok adapter is **gated** until a project-scoped Grok CLI is installed for `amazon-research` on Oracle and the same unattended/structured/timeout checks pass there. The UI may show the type as “coming after worker install”, not as a fake HTTP xAI key.

### Custom OpenAI-Compatible API

Reuse `openai_http`. No new execution family.

## 4. Proposed architecture

Two execution families, three UI types:

```text
UI type                      kind                    adapter     billing
OpenAI Codex Subscription    subscription_command    codex       subscription
Grok Subscription            subscription_command    grok        subscription
OpenAI-Compatible API        openai_http             (none)      free|subscription|payg
```

`command` remains the test-only family (`fake-command`). It stays disabled in production.

Worker adapters:

- `openai_http` — existing HTTP client, SSRF/URL pin, byte caps, Test Connection probe
- `subscription_command/codex` — allowlisted `codex` argv builder on top of existing `spawn({ shell: false })`
- `subscription_command/grok` — allowlisted `grok` argv builder, same spawn path, Oracle-gated

Auth material stays in the CLI’s own home (`CODEX_HOME` / Grok home) owned by `amazon-research`, mode `0700`/`0600`. It is not copied into `provider_secrets` unless a later contract requires it. `provider_secrets` remains for HTTP API keys only.

## 5. Alternatives and recommendation

### Approach A — extend existing `command`

Keep `kind='command'`. Add production allowlisted profiles `codex` and `grok` next to `fake-command`.

Pros: smallest schema change; Plan 02 already described command profiles; spawn/security path is written.

Cons: production subscription auth lifecycle is unlike fake-command; Settings UI already exposes a generic `commandProfileId` that must never accept user executables; easy to confuse “command provider” with arbitrary shell.

### Approach B — add `subscription_command` + `adapter`

Add kind `subscription_command` with `config.adapter ∈ {codex, grok}`. Keep `command` for tests.

Pros: UI types map 1:1; auth states do not overload HTTP/command; production allowlist cannot accidentally enable `fake-command`; CHECK constraint makes illegal kinds unrepresentable.

Cons: migration 019 must widen `kind` CHECK and Zod `ProviderKindSchema`; catalog/router/settings RPCs need one more branch.

### Recommendation: Approach B

Use B. Reuse the existing command **executor** (spawn, bounds, timeout) as a library behind subscription adapters. Do not reuse the production-disabled `fake-command` profile as the product type.

Rejected: introducing a third HTTP family that posts Codex/Grok cookies to undocumented endpoints.

Rejected: storing ChatGPT or xAI refresh tokens in `provider_secrets` and minting requests in-process.

## 6. Provider types

### OpenAI Codex Subscription

- Display: OpenAI Codex Subscription
- Auth: operator completes `codex login --device-auth` for the worker user
- Execution: `codex exec` with fixed argv (section 8)
- Billing: `subscription` only
- Roles: default `niche_normalization`; other roles remain schema-compatible but off unless enabled

### Grok Subscription

- Display: Grok Subscription
- Auth: operator completes `grok login --device-auth` for the worker user
- Execution: `grok -p` + `--json-schema` + `--output-format json` with fixed argv
- Billing: `subscription` only
- Availability: gated on Oracle CLI install + probe PASS

### OpenAI-Compatible API

- Display: OpenAI-Compatible API
- Auth: API key in `provider_secrets`
- Execution: existing `openai_http`
- Billing: operator-selected `free` | `subscription` | `payg`
- PAYG rows are never auto-selected while `allowPaidFallback=false`

## 7. Data model

Prefer extending existing tables. No parallel provider system.

Migration **019+** only. Do not rewrite 001–018.

Minimal 019:

1. Drop/replace `ai_providers.kind` CHECK to `('openai_http', 'command', 'subscription_command')`.
2. No new table required for adapter: store `config.adapter` as `'codex' | 'grok'` when kind is `subscription_command`.
3. Zod: extend `ProviderKindSchema`; add `SubscriptionAdapterSchema`.
4. Optional later: `ai_providers.auth_status` text if overlaying on `config` becomes ambiguous. First implementation may keep auth status in `config.authStatus` plus last probe blob already used by Settings CAS.

`ai_models` continue to be provider-owned (`unique (provider_id, model_id)`). Model IDs are not interchangeable across adapters.

`provider_secrets` unchanged; subscription_command rows have no secret row.

`save_ai_provider_settings` CAS/revision/probe-ownership RPCs stay the write path. They must reject:

- `subscription_command` with an API key
- `openai_http` with an adapter
- `command` in production
- user-supplied executable/args
- `billing_type=payg` on subscription_command

Existing zero-row production catalog remains valid. Any future `openai_http` row remains valid.

## 8. Auth lifecycle

Do not overload HTTP “Test Connection” as subscription login.

States (dashboard, not credentials):

| State | Meaning |
| --- | --- |
| Not configured | Type chosen but worker adapter/CLI missing or provider disabled |
| Authorization required | CLI present, `login status` unauthenticated |
| Ready | CLI present, login valid, last probe available, enabled |
| Expired | CLI reports unauthenticated after a previous Ready |
| Needs Attention | Probe/auth/install failed with an actionable reason |
| Disabled | Operator disabled the row |

HTTP providers keep current probe semantics (`available` / fingerprint / settings revision). They do not use Authorization required / Expired unless an HTTP 401 is mapped to Needs Attention without implying a subscription login.

Worker health updates status through the existing executionProbe / settings-revision CAS. Stale probes must not resurrect a Ready state after revision change (already Plan 02 invariant).

## 9. Oracle / headless authorization

Oracle is headless and shared. Authorization is initiated by the operator, not by ChatGPT/Grok chat and not by pasting keys into the dashboard.

### Codex (proven binary on host)

1. Dashboard action “Authorize Codex” enqueues `TEST_AI_PROVIDER_CONNECTION` / a dedicated `AUTHORIZE_SUBSCRIPTION_PROVIDER` job (implementation choice; one job type is enough if payload includes `phase: start|status`).
2. Worker, as `amazon-research`, runs allowlisted `codex login --device-auth` with `CODEX_HOME=/opt/amazon-research/.codex` (or `$HOME/.codex` for that user).
3. Worker captures device URL/code from stdout (redact anything that looks like a token). Dashboard shows the URL/code only.
4. Operator completes login in their own browser.
5. Worker poll `codex login status` until Ready or timeout → Needs Attention.
6. Auth files remain on disk, `chown amazon-research`, `chmod 0600`. Not inserted into Postgres.

Do not copy `/home/ubuntu/.codex` into the service user.

Re-auth: same flow. Logout: allowlisted `codex logout` from dashboard confirmation.

### Grok (not on Oracle yet)

Same device-code shape (`grok login --device-auth`) **after** a project-scoped install under the service user (for example `/opt/amazon-research/bin/grok`, not a Hermes-global binary). Until then the Grok card is Not configured / gated.

`--oauth` welcome-screen login is not the Oracle path.

### Shared-host rules

- Do not replace Hermes Node
- Do not change timezone
- Do not touch Discord units
- Install CLIs only for `amazon-research` where possible
- Rollback = disable provider row + keep previous CLI binary

## 10. Execution security

Subscription execution must not become arbitrary command execution.

Allowlist (code, not database):

| Adapter | Executable source | Argv |
| --- | --- | --- |
| codex | resolved once from worker config (`/usr/bin/codex` or `PATH` lookup recorded at probe) | `exec`, `--ephemeral`, `--skip-git-repo-check`, `--sandbox`, `read-only`, `--output-schema`, `<schemaPath>`, `--json`, `-C`, `<isolatedDir>`, `-m`, `<allowlistedModel>` ; prompt via stdin |
| grok | resolved the same way | `-p` prompt-from-stdin or `--prompt-file`, `--output-format`, `json`, `--json-schema`, `<schema>`, `--disable-web-search`, `--max-turns`, `1`, `--sandbox` value from profile, `-m`, `<allowlistedModel>` |

Invariants (reuse `CommandProvider`):

- `shell: false`
- no user executable, no user args, no interpolation, no chaining
- env allowlist only (`HOME`/`CODEX_HOME`/`GROK_*` as required by the pinned profile)
- 2 MiB combined output cap (keep current)
- timeout + SIGTERM process group
- isolated working directory for Codex (empty, not the app repo)
- never `--dangerously-bypass-approvals-and-sandbox`
- never `--with-api-key` / `--with-access-token` on the exec path
- concurrency: keep current AI concurrency 2–3
- version recorded at probe; mismatch → Needs Attention
- stderr redacted with existing `redactSecrets`

If a future CLI flag is required, it is added to the allowlisted profile in code review, not taken from Settings.

## 11. Routing

Extend `routeAiRequest`; do not replace it.

Inputs already present: enabled, roles, health.available, capabilities, billingType, priority/rolePriority, allowPaidFallback.

Additions:

- Treat Expired / Authorization required / Needs Attention as `health.available=false`
- User priority remains `ai_providers.priority` (lower number = higher priority, already used)
- Example desired order: Codex 10, Grok 20, Custom HTTP 30 — operator-set
- Subscription-to-subscription fallback is allowed when both are enabled, healthy, role-compatible, and non-PAYG
- PAYG HTTP is never an automatic fallback
- If every eligible provider is unavailable: `WAITING_FOR_AI_CAPACITY` (existing defer). Candidate stays in Waiting for AI Capacity / Needs Attention per current normalize job, not a silent skip to JS

Audit: persist provider_id, model_id, role, cost_class=`subscription`|`free`|`payg`, adapter name, not argv, not env, not tokens.

## 12. Role assignment

YAGNI.

UI: checkboxes from existing `AiRoleSchema`. MVP default for new subscription providers: `niche_normalization` only.

Do not invent agent-role graphs.

## 13. Model discovery

| Family | Discovery |
| --- | --- |
| openai_http | existing `/models` discovery when enabled; manual modelId otherwise |
| Codex | operator-selected model from an allowlist seeded by `codex` documented models / last successful `-m`; do not assume OpenAI API model IDs |
| Grok | `grok models` after CLI exists; store under that provider_id only |

`assertPersistableModelId` remains. Model rows record `provider_id` ownership. Disabling a provider disables routing to its models.

## 14. Billing / accounting

`cost_class` on `ai_analyses` / `ai_usage` already distinguishes free / subscription / payg.

Subscription executions record:

- request count (row exists)
- model, provider, role
- latency (started_at/completed_at)
- success/failure
- token counts only if the client JSON reports them reliably

Do not invent USD for subscription rows. Dashboard copy must not imply subscription request count is extra dollar spend.

PAYG HTTP keeps existing authoritative paid usage accounting.

## 15. Dashboard UX

Settings page `/[locale]/settings/ai` becomes a list of provider cards plus Add Provider.

Card fields: name, type, auth method, billing, status, model, roles, priority, last probe, actions (edit, authorize, test, disable).

Add Provider radio:

- OpenAI Codex Subscription → no API key fields; Authorize button; billing locked subscription
- Grok Subscription → same; gated banner if CLI missing
- OpenAI-Compatible API → name, baseUrl, apiKey (write-only), model/discovery, billing, roles, priority

Never return stored API keys. Never return Codex/Grok auth files.

Status examples:

- OpenAI Codex / Subscription / Ready
- Grok / Subscription / Re-authentication required
- Custom / OpenAI-compatible / Ready

Korean/English copy via existing dictionaries; do not auto-translate model IDs.

## 16. Probes

| Type | Lightest supported probe | Consumes subscription quota? |
| --- | --- | --- |
| openai_http | existing executionProbe | HTTP only; current Test Connection |
| Codex | `codex login status` then `codex doctor` | should not call `exec` |
| Grok | `grok doctor`; `grok models` only if doctor cannot prove auth | `models` may hit network; disclose in UI if used |

Probes use the same allowlisted spawn path. They must not use PAYG HTTP as a substitute health check for subscription adapters.

If Codex/Grok later require a tiny `exec`/`-p` to prove structured output, that is an explicit paid/subscription use and must be labeled on the Test Connection button. Prefer status/doctor first.

## 17. Error / fallback UX

- Codex auth expired → Expired / Needs Attention; skip in router; do not switch to PAYG HTTP
- Grok CLI missing → Not configured; skip
- Grok unavailable after install → next enabled healthy non-PAYG provider
- All providers unavailable → durable defer, Needs Attention, no uncontrolled paid fallback
- HTTP 401 on custom provider → Needs Attention on that card only

## 18. Shared-host constraints

Worker user `amazon-research`, tree `/opt/amazon-research/current`, env file `/etc/amazon-research/worker.env` (names only in docs).

CLI install location: `/usr/bin/codex` already present; Grok if added should be `/opt/amazon-research/bin/grok` plus PATH for that user only.

Auth dirs: `/opt/amazon-research/.codex` and `/opt/amazon-research/.grok` (or `$HOME` for the service user). Permissions `0700`/`0600`.

Do not alter Hermes bundled Node (v22.22.2) or system Node 24 used by the worker.

## 19. Migrations

Start at `202608280019_*` (next after current 018). Widen kind CHECK + no backfill required (0 provider rows).

Do not rewrite 001–018. `save_ai_provider_settings` functions that mention kind must accept the new value in the same 019 migration if they validate kind in SQL.

## 20. Deployment

Worker-only for adapters, CLI, auth home. Web Settings UI requires a Vercel preview deploy when the form changes.

Do not deploy this design now.

Rollback: disable provider rows; revert web/worker to previous HEAD; leave CLI binaries in place.

## 21. Test strategy

- Schema: kind CHECK accepts `subscription_command`, rejects unknown kind and payg+subscription_command
- Router: two subscription providers fallback; PAYG skipped; expired health skipped
- Argv builder unit tests: exact argv, no shell, no user executable
- Command spawn tests already cover timeout/output/shell metacharacters — reuse
- Settings API: subscription create without secret; HTTP create without adapter; secret never echoed
- Integration: fake subscription CLI fixture (like `fake-ai-command.mjs`) for local; Oracle live probe is a later acceptance gate, not this spec commit
- E2E: Add Provider radios render; Codex flow has no apiKey field

## 22. Live acceptance strategy (after implementation)

Do not hack the current Plan 04 candidate forward.

After implementation:

1. Authorize one subscription provider (Codex, since Oracle already has the binary)
2. Assign `niche_normalization`
3. Research Now enqueues `NORMALIZE_OPPORTUNITIES` for `cccdb1c3-20eb-52ae-bd4f-5c8c0fd63454` (wiring already at `98cf5b1`)
4. Then frozen Task 10 Step 2 `api_fetched` crash/resume

Grok is optional for that gate.

## 23. Rollback

Disable/delete provider rows via Settings. Revert 019+ and worker/web if shipped. Auth files can remain on disk; they are not app source of truth.

## 24. Relationship to Plan 04 blocker

Pipeline wiring PASS at `98cf5b1`. Live Task 10 is blocked on a usable non-PAYG provider. This design is the correct unblocking path. It is not a substitute for the 03:00 America/Chicago timer evidence.

## 25. Security review (spec)

| Risk | Mitigation |
| --- | --- |
| Arbitrary command execution | Allowlisted argv/executable in code; Settings cannot set them |
| PAYG fallback | Router skip + billing lock on subscription kinds |
| Secret leakage | No subscription tokens in DB/UI/logs; HTTP keys stay encrypted; redactSecrets |
| Cookie scraping | Forbidden |
| Codex agent tool use | read-only sandbox, empty workdir, no bypass flags; gate if uncontained |
| Shared host auth mix-up | amazon-research CODEX_HOME, not ubuntu |
| Grok invented on Oracle | Explicitly gated |

## 26. Self-review notes

- No unimplemented “TBD” left as work instructions; Grok Oracle absence is a hard gate, not a placeholder
- Codex `--device-auth` help text is empty; implementation must observe real CLI output
- `codex exec` tool-disable flag is not documented; containment strategy is sandbox + isolation + gate
- Existing `command` kind is not deleted
- Migration number is 019+, not a rewrite of 018
