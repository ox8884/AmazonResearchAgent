# Subscription provider sandbox deployment

## Safety boundary

This runbook installs and verifies repository-owned Task-5 artifacts on Ubuntu 24.04. It does not authorize Codex/Grok, call a live provider, enable an adapter, apply migration 022, or mutate production by itself. Local fixture output is never Oracle evidence. Stop on every mismatch; do not repair ownership, digest, membership, capability, or lifecycle drift silently.

## Immutable inputs

Record the release SHA and artifact digests before copying anything:

```bash
set -euo pipefail
cd /opt/amazon-research/releases/RELEASE_SHA
git rev-parse HEAD
sha256sum \
  ops/subscription-providers/{subscription-supervisor.mjs,manage-invocation.sh} \
  ops/systemd/amazon-research-{codex,grok}@.service \
  ops/systemd/amazon-research-subscription-gc.{service,timer} \
  ops/polkit/50-amazon-research-subscription.rules \
  ops/nftables/amazon-research-subscription.nft
bash ops/subscription-providers/install-systemd-sandbox.sh dry-run
bash ops/subscription-providers/install-auth-homes.sh dry-run
bash ops/subscription-providers/verify-runtime-profile.sh dry-run codex
bash ops/subscription-providers/verify-runtime-profile.sh dry-run grok
```

The fixed lifecycle is `systemctl start --no-block amazon-research-{codex,grok}@UUID.service`; root `ExecStartPre` creates and validates the UUID directory and waits at most five seconds for atomic `request.tmp` → `request.json`; MAIN validates the sealed request, emits `READY=1`, runs only the fixed fixture/client, atomically publishes result, stays active while the worker reads it, and exits only after explicit stop/cgroup termination/`ExecStopPost` cleanup. `STATUS=` never substitutes for READY.

## Oracle host install — explicit approval required

Run only after reviewing exact release SHA/digests and granting explicit host-change approval:

```bash
set -euo pipefail
cd /opt/amazon-research/releases/RELEASE_SHA
sudo bash ops/subscription-providers/install-auth-homes.sh install
sudo bash ops/subscription-providers/install-systemd-sandbox.sh install
sudo systemctl enable --now amazon-research-subscription-gc.timer
sudo bash ops/subscription-providers/install-auth-homes.sh verify
sudo bash ops/subscription-providers/install-systemd-sandbox.sh verify
sudo bash ops/subscription-providers/verify-runtime-profile.sh verify codex
sudo bash ops/subscription-providers/verify-runtime-profile.sh verify grok
```

Changes: system users `ara-codex`/`ara-grok`; groups `ara-codex-ipc`/`ara-grok-ipc`; worker membership in both; separate `0700` auth homes; root/group `0750` runtime parents; two fixed template units; GC service/timer; one UUID-only polkit rule; one UID/resolver/provider-prefix nftables ruleset. The installer reloads systemd but does not start an adapter unit or load/activate provider credentials.

Before loading nftables, populate only approved resolver addresses and provider/auth endpoint prefixes through the separately reviewed host configuration. `nft --check` is syntax proof, not endpoint approval. Empty/wrong/drifting bindings fail acceptance.

## Disabled host acceptance evidence

Use a fixture adapter only. Never import human/Hermes credentials and never call Codex/Grok. Capture bounded JSON and these commands:

```bash
systemctl --version
stat -fc %T /sys/fs/cgroup
getent passwd amazon-research ara-codex ara-grok
id amazon-research; id ara-codex; id ara-grok
stat -c '%U:%G:%a:%n' \
  /var/lib/amazon-research/subscription/{codex,grok} \
  /run/amazon-research/subscription/{codex,grok}
systemctl cat amazon-research-codex@.service amazon-research-grok@.service
systemctl show amazon-research-subscription-gc.timer --property=ActiveState,SubState
sudo nft list table inet amazon_research_subscription
pkaction --action-id org.freedesktop.systemd1.manage-units
```

The host fixture must prove every S0–S5 transition and all cancellation/start/request/READY failures, exact file owner/group/mode/type/size/digest, cross-adapter denial, environment/journal secrecy, filesystem/exec/network denial, and liveness-aware GC. Evidence is invalid if the unit is not the recorded digest, READY is absent, state is ambiguous, or cleanup precedes result ingestion.

## Phase A → full writer fence → Phase B

### 1. Phase A

Apply migrations 019–021 only. Deploy the recorded Phase-A SHA and record:

```bash
pnpm --filter @ara/worker writer:identity
sudo systemctl restart amazon-research-worker.service
sudo systemctl status --no-pager amazon-research-worker.service
```

Expected identity is the recorded Phase-A SHA with mode `legacy`. Verify existing HTTP behavior and prove initial normalization enqueue calls the shared-lock RPC with `legacy`; no direct job insert is accepted.

```sql
begin;
select pg_advisory_xact_lock_shared(7241304022);
select public.read_normalization_writer_capability() as capability; -- exactly legacy
rollback;
```

Install and verify the disabled sandbox. Adapter activation/current-generation Ready belongs to Tasks 15–17; Task 14 records only disabled fixture acceptance.

### 2. Prepare Phase B without starting it

Build/deploy the recorded Phase-B artifact to an inactive release path. Run `pnpm --filter @ara/worker writer:identity`; require exact recorded Phase-B SHA and `canonical`. Do not move `current` or start it.

### 3. Enter the full writer fence

```bash
sudo systemctl disable --now amazon-research-daily.timer
sudo systemctl stop amazon-research-daily.service amazon-research-worker.service
systemctl show amazon-research-daily.timer amazon-research-daily.service amazon-research-worker.service \
  --property=Id,ActiveState,SubState,MainPID
pgrep -af '(@ara/worker|enqueue:daily)' && exit 1 || true
```

All three units must be inactive and every `MainPID=0`. Record and settle running job/analysis leases. Higher-level rows may queue, but no process may transform them until Phase B starts.

```sql
select id, job_type, status, locked_by, locked_at, lease_expires_at, attempts
from public.jobs
where status = 'running' and job_type = 'normalize_opportunity'
order by id;

select id, status, worker_id, lease_expires_at, attempts
from public.ai_analyses
where status = 'running'
order by id;
```

### 4. Pre-migration defect queries

Record `legacy_keys`; migration 022 rewrites that exact set. Require collision, malformed-key, malformed-payload, and generation-mismatch counts to be zero before applying it:

```sql
select count(*) as legacy_keys
from public.jobs
where idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

select count(*) as legacy_canonical_collisions
from public.jobs legacy
join public.jobs canonical
  on canonical.idempotency_key = legacy.idempotency_key || ':0'
where legacy.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

select count(*) as malformed_normalization_keys
from public.jobs
where job_type = 'normalize_opportunity'
  and idempotency_key !~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:[0-9]+)?$';

select count(*) as malformed_payloads
from public.jobs
where job_type = 'normalize_opportunity'
  and (jsonb_typeof(payload) <> 'object'
       or coalesce(payload->>'candidateId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

select count(*) as generation_mismatches
from public.jobs j
join public.candidates c on c.id = (j.payload->>'candidateId')::uuid
where j.job_type = 'normalize_opportunity'
  and j.idempotency_key ~ ':([0-9]+)$'
  and (j.payload->>'normalizationGeneration')::integer <> c.normalization_generation;
```

### 5. Apply migration 022 under the exclusive lock

The migration itself begins with the exclusive lock. Keep Phase A stopped:

```sql
begin;
select pg_advisory_xact_lock(7241304022);
\i supabase/migrations/202608290022_rearm_normalization_generation.sql
commit;
```

To prove shared/exclusive serialization in a disposable transaction, session A holds `pg_advisory_xact_lock_shared(7241304022)`; session B must return `false` from `pg_try_advisory_xact_lock(7241304022)` until A rolls back. Never leave either transaction open.

### 6. Post-migration gates

```sql
select count(*) as legacy_keys
from public.jobs
where idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

select count(*) as legacy_canonical_collisions
from public.jobs legacy
join public.jobs canonical
  on canonical.idempotency_key = legacy.idempotency_key || ':0'
where legacy.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

select count(*) as malformed_canonical
from public.jobs
where job_type = 'normalize_opportunity'
  and (idempotency_key !~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]+$'
       or jsonb_typeof(payload->'normalizationGeneration') <> 'number');

select count(*) as payload_candidate_generation_mismatch
from public.jobs j
left join public.candidates c on c.id = (j.payload->>'candidateId')::uuid
where j.job_type = 'normalize_opportunity'
  and (c.id is null or (j.payload->>'normalizationGeneration')::integer <> c.normalization_generation);

select count(*) as running_lease_defects
from public.jobs
where job_type = 'normalize_opportunity' and status = 'running'
  and (locked_by is null or lease_expires_at is null or attempts < 1);

select count(*) as canonical_capability_rows
from public.normalization_writer_capability
where singleton is true and mode = 'canonical' and migration_identity = '202608290022';

select public.read_normalization_writer_capability() as capability;
```

Require all defect/legacy/collision counts `0` and `canonical_capability_rows = 1`. While holding the exclusive lock in session A, a session B call to `enqueue_initial_candidate_normalization(..., 'legacy')` must block and then fail `normalization_writer_mode_rejected`; it must create no row.

### 7. Start Phase B

Only after exact Phase-B identity, canonical startup guard, canonical-only enqueue, and all SQL gates pass:

```bash
sudo ln -sfn /opt/amazon-research/releases/PHASE_B_SHA /opt/amazon-research/current
sudo systemctl start amazon-research-worker.service
sudo -u amazon-research -H sh -lc 'cd /opt/amazon-research/current && pnpm --filter @ara/worker writer:identity'
sudo systemctl enable --now amazon-research-daily.timer
```

Record both SHAs, migration identity, command outputs, sanitized fixture evidence, operator, and timestamps.

## Rollback

First disable/fence subscription providers, stop/kill exact adapter UUID cgroups, settle attempts, and preserve immutable attempt events, staged winner, and domain-finalization ledger. Increment auth generation only when auth state changes. Choose either credential preservation or the client's supported revoke flow; never delete or copy credentials silently.

Before migration 022: stop Phase A normally and restore only a tested compatible Phase-A release.

After migration 022: never restart Phase A and never rename data back. Stop Phase B and deploy only a tested canonical-compatible artifact derived from Phase B. Reverse rewrite or capability flip requires a separately reviewed forward migration under the same full writer fence.

Host artifact rollback is reversible only while no adapter unit is active: disable GC timer, stop/kill exact adapter units, verify cgroups empty and paths terminal/empty/absent, restore the previously recorded root-owned artifact set, reload systemd/nftables/polkit, then re-run every verification gate. User/group/auth-home removal is destructive and is not part of routine rollback.
