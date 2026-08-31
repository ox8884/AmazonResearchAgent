# Subscription provider sandbox deployment

## Safety boundary

This runbook installs and verifies repository-owned Task-5 artifacts on Ubuntu 24.04. It does not authorize Codex/Grok, call a live provider, enable an adapter, apply migration 022, or mutate production by itself. Local fixture output is never Oracle evidence. Stop on every mismatch; do not repair ownership, digest, membership, capability, or lifecycle drift silently.

## Immutable inputs

The checked-in `ops/subscription-providers/endpoint-bindings.json` is deterministic local-fixture authority only. It cannot establish Oracle acceptance. Production schema version 3 requires canonical adapter-specific resolver/provider/auth hostnames; exact hostname-to-canonical-prefix bindings; reviewed one-to-one adapter username/numeric-UID pairs; canonical resolution timestamps and bounded TTLs; canonical review/expiry timestamps; the fixed network-security reviewer identity and schema version; exact release commit/runtime profile; an installed-artifact path/mode/digest manifest; and one digest over the canonical complete authority. The repository intentionally publishes no approved production hostname or numeric-UID binding map. Therefore every production authority currently fails closed.

A future separately reviewed release must add exact hostname-to-prefix and username-to-UID bindings and publish the complete authority atomically at `/etc/amazon-research/subscription/endpoint-bindings.json`: create a private root-owned sibling on the same filesystem, write and fsync it, validate canonical semantics/digest/freshness/release/profile, then rename it into the fixed root-owned `0444` regular-file path. DNS answer, TTL, numeric identity, reviewer/version, release/profile, installed byte, or rendered-policy drift invalidates approval. A self-consistent digest or root authorship is never approval.
## Oracle host install — explicit approval required

Do not run this section: production endpoint authority is intentionally unpublished and Oracle approval remains blocked. After a separate review publishes exact production authority and explicit host-change approval is granted, provision `amazon-research`, `ara-codex`, `ara-grok`, their exact primary groups, and exact IPC memberships through the separately governed host-identity process. `install-auth-homes.sh` deliberately never calls `groupadd`, `useradd`, or `usermod`; NSS and supplementary-membership mutations cannot truthfully be rolled back. It fails before filesystem mutation unless every identity, primary group, supplementary group, shell, and membership already matches.

The systemd installer first obtains the fixed transaction lock through `scripts/subscription-install-lock.mjs`, which creates/opens without following symlinks or truncating an existing object, binds validation to the held descriptor, requires exact root ownership and `0600` in production, and passes the same descriptor through the complete transaction. Nonblocking contention fails before target preflight. The installer then completes source, authority, target-parent, tool, syntax, and digest preflight. Every absent destination is staged in its final parent, written/fsynced, metadata/digest checked, and hard-linked atomically into an absent target. Rollback removes only invocation-created state in reverse order and never overwrites pre-existing drift. It does not load nftables or start an adapter.

The commands below remain blocked documentation, not an executable packet:

```bash
sudo bash ops/subscription-providers/install-auth-homes.sh install
sudo bash ops/subscription-providers/install-systemd-sandbox.sh install
sudo bash ops/subscription-providers/install-auth-homes.sh verify
sudo bash ops/subscription-providers/install-systemd-sandbox.sh verify
sudo bash ops/subscription-providers/verify-runtime-profile.sh verify codex
sudo bash ops/subscription-providers/verify-runtime-profile.sh verify grok
```

`verify-runtime-profile.sh verify` reads only fixed installed unit/helper/supervisor/GC/polkit/authority/nft paths, rejects missing/non-regular/symlinked or byte-drifted artifacts, compares installed nft bytes to the authority-rendered policy, checks the installed table through the fixed `nft list table inet amazon_research_subscription` plan, and requires the canonical production authority's reviewed adapter username/numeric UID to equal two identical bounded NSS records before it can emit `oracleHostVerified:true`. Repository or staging bytes and fixture UIDs cannot establish Oracle acceptance. With the current empty production authority, that output is unreachable.

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

All three units must be inactive and every `MainPID=0`. Record and settle running job/analysis leases. Higher-level rows may queue, but no process may transform them until Phase B starts. These columns exist before migration 022:

```sql
select id, type, status, leased_by, leased_until, attempts
from public.jobs
where status = 'running' and type = 'NORMALIZE_OPPORTUNITIES'
order by id;

select id, status, leased_by, leased_until, attempts
from public.ai_analyses
where status = 'pending'
  and leased_until is not null
  and leased_until > clock_timestamp()
order by id;
```

### 4. Pre-migration defect queries

Record `legacy_keys`; migration 022 rewrites that exact set. Run each query separately and require every defect count to be zero. These predicates mirror migration 022 and reference only pre-022 state:

```sql
select count(*) as legacy_keys
from public.jobs
where type = 'NORMALIZE_OPPORTUNITIES'
  and idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

select count(*) as legacy_canonical_collisions
from public.jobs legacy
join public.jobs canonical
  on canonical.idempotency_key = legacy.idempotency_key || ':0'
where legacy.type = 'NORMALIZE_OPPORTUNITIES'
  and legacy.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

select count(*) as malformed_normalization_keys
from public.jobs
where type = 'NORMALIZE_OPPORTUNITIES'
  and idempotency_key like 'normalize:%'
  and idempotency_key !~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[0-9]+)?$';

select count(*) as malformed_legacy_payloads
from public.jobs j
left join public.candidates c on c.id::text = split_part(j.idempotency_key, ':', 2)
where j.type = 'NORMALIZE_OPPORTUNITIES'
  and j.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (jsonb_typeof(j.payload) <> 'object'
       or jsonb_typeof(j.payload->'candidateIds') <> 'array'
       or jsonb_array_length(j.payload->'candidateIds') <> 1
       or j.payload->'candidateIds'->>0 is distinct from split_part(j.idempotency_key, ':', 2)
       or j.payload ? 'normalizationGeneration'
       or j.payload->>'locale' not in ('ko', 'en')
       or j.payload - array['candidateIds', 'locale', 'promptVersion'] <> '{}'::jsonb
       or c.id is null or c.normalization_generation <> 0);

select count(*) as malformed_generation_zero_payloads
from public.jobs j
left join public.candidates c on c.id::text = split_part(j.idempotency_key, ':', 2)
where j.type = 'NORMALIZE_OPPORTUNITIES'
  and j.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:0$'
  and (jsonb_typeof(j.payload->'candidateIds') <> 'array'
       or jsonb_array_length(j.payload->'candidateIds') <> 1
       or j.payload->'candidateIds'->>0 is distinct from split_part(j.idempotency_key, ':', 2)
       or jsonb_typeof(j.payload->'normalizationGeneration') <> 'number'
       or j.payload->>'normalizationGeneration' is distinct from '0'
       or j.payload->>'locale' not in ('ko', 'en')
       or c.id is null or c.normalization_generation <> 0);

select count(*) as active_lease_defects
from (
  select id from public.jobs
  where type = 'NORMALIZE_OPPORTUNITIES' and status = 'running'
    and (leased_by is null or leased_until is null or leased_until <= clock_timestamp() or attempts < 1)
  union all
  select id from public.ai_analyses
  where status = 'pending' and leased_until > clock_timestamp()
    and (leased_by is null or attempts < 1)
) defects;

select count(*) as legacy_capability_rows
from public.normalization_writer_capability
where singleton is true and mode = 'legacy';
```

Require `legacy_capability_rows = 1`; all defect/collision counts must be `0`. `legacy_keys` is an inventory count, not a defect count.

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

These queries require migration 022 and must not be run against pre-022 schema:

```sql
select count(*) as legacy_keys
from public.jobs
where type = 'NORMALIZE_OPPORTUNITIES'
  and idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

select count(*) as legacy_canonical_collisions
from public.jobs legacy
join public.jobs canonical on canonical.idempotency_key = legacy.idempotency_key || ':0'
where legacy.type = 'NORMALIZE_OPPORTUNITIES'
  and legacy.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

select count(*) as malformed_canonical
from public.jobs j
left join public.candidates c on c.id::text = split_part(j.idempotency_key, ':', 2)
where j.type = 'NORMALIZE_OPPORTUNITIES'
  and (j.idempotency_key !~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$'
       or jsonb_typeof(j.payload->'candidateIds') <> 'array'
       or jsonb_array_length(j.payload->'candidateIds') <> 1
       or j.payload->'candidateIds'->>0 is distinct from split_part(j.idempotency_key, ':', 2)
       or jsonb_typeof(j.payload->'normalizationGeneration') <> 'number'
       or j.payload->>'normalizationGeneration' is distinct from split_part(j.idempotency_key, ':', 3)
       or c.id is null
       or (j.payload->>'normalizationGeneration')::bigint <> c.normalization_generation);

select count(*) as running_lease_defects
from public.jobs
where type = 'NORMALIZE_OPPORTUNITIES' and status = 'running'
  and (leased_by is null or leased_until is null or leased_until <= clock_timestamp() or attempts < 1);

select count(*) as active_analysis_lease_defects
from public.ai_analyses
where status = 'pending' and leased_until > clock_timestamp()
  and (leased_by is null or attempts < 1);

select count(*) as canonical_capability_rows
from public.normalization_writer_capability
where singleton is true and mode = 'canonical' and migration_identity = '202608290022';

select public.read_normalization_writer_capability() as capability;
```

Require all defect/legacy/collision counts `0`, `canonical_capability_rows = 1`, and capability exactly `{"mode":"canonical","migration_identity":"202608290022"}`. With a real disposable candidate UUID substituted for `:'candidate_id'`, call `public.enqueue_initial_candidate_normalization(:'candidate_id'::uuid, 'en', 'legacy')` while the exclusive lock is held in session A; session B must block, then fail `normalization_writer_mode_rejected` after session A commits. It must create no normalization job for that candidate.

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
