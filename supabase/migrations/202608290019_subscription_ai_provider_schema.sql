do $$
declare
  invalid_ids text;
begin
  select string_agg(id, ',' order by id) into invalid_ids
  from public.ai_providers
  where kind not in ('openai_http', 'command');
  if invalid_ids is not null then
    raise exception 'unsupported_provider_kind:%', invalid_ids;
  end if;

  select string_agg(p.id, ',' order by p.id) into invalid_ids
  from public.ai_providers p
  where exists (
    select 1 from public.ai_models m
    where m.provider_id = p.id and m.billing_type <> p.billing_type
  );
  if invalid_ids is not null then
    raise exception 'provider_model_billing_mismatch:%', invalid_ids;
  end if;

  select string_agg(p.id, ',' order by p.id) into invalid_ids
  from public.ai_providers p
  join public.provider_secrets s on s.provider_id = p.id
  where p.kind <> 'openai_http';
  if invalid_ids is not null then
    raise exception 'forbidden_provider_secret:%', invalid_ids;
  end if;

  select string_agg(id, ',' order by id) into invalid_ids
  from public.ai_providers
  where jsonb_typeof(config) <> 'object'
     or config ?| array[
       'adapter', 'authStatus', 'authHome', 'authGeneration', 'binaryPath',
       'binaryDigest', 'binaryVersion', 'environment', 'executionProfileId',
       'securityProfileVersion', 'readinessPolicyVersion', 'systemdUnitDigest',
       'sandboxPolicyDigest', 'endpointAllowlistDigest', 'containmentAttestation',
       'capabilityAttestation', 'termsDigest'
     ]
     or (kind = 'openai_http' and config ?| array[
       'command', 'commandProfileId', 'executable', 'fixedArgs', 'args'
     ])
     or (kind = 'command' and config ?| array['baseUrl', 'networkScope', 'modelDiscovery', 'manualModelId']);
  if invalid_ids is not null then
    raise exception 'cross_family_provider_config:%', invalid_ids;
  end if;
end;
$$;

alter table public.ai_providers
  add column adapter text;

alter table public.ai_providers
  drop constraint if exists ai_providers_kind_check;
alter table public.ai_providers
  add constraint ai_providers_kind_check
  check (kind in ('openai_http', 'command', 'subscription_command'));
alter table public.ai_providers
  add constraint ai_providers_adapter_check
  check (adapter is null or adapter in ('codex', 'grok'));
alter table public.ai_providers
  add constraint ai_providers_kind_adapter_billing_check
  check (coalesce(
    (kind = 'openai_http' and adapter is null and billing_type in ('free', 'subscription', 'payg'))
    or (kind = 'command' and adapter is null and billing_type in ('free', 'subscription'))
    or (kind = 'subscription_command' and adapter in ('codex', 'grok') and billing_type = 'subscription'),
    false
  ));
alter table public.ai_providers
  add constraint ai_providers_family_config_check
  check (
    jsonb_typeof(config) = 'object'
    and not (config ?| array[
      'adapter', 'authStatus', 'authHome', 'authGeneration', 'binaryPath',
      'binaryDigest', 'binaryVersion', 'environment', 'executionProfileId',
      'securityProfileVersion', 'readinessPolicyVersion', 'systemdUnitDigest',
      'sandboxPolicyDigest', 'endpointAllowlistDigest', 'containmentAttestation',
      'capabilityAttestation', 'termsDigest'
    ])
    and not (kind = 'openai_http' and config ?| array[
      'command', 'commandProfileId', 'executable', 'fixedArgs', 'args'
    ])
    and not (kind in ('command', 'subscription_command') and config ?| array[
      'baseUrl', 'networkScope', 'modelDiscovery', 'manualModelId'
    ])
    and (
      kind <> 'subscription_command'
      or not (config ?| array[
        'command', 'commandProfileId', 'modelId', 'executionIdentity',
        'executionProbe', 'executable', 'fixedArgs', 'args'
      ])
    )
  );

create unique index ai_providers_subscription_adapter_unique
  on public.ai_providers(adapter)
  where kind = 'subscription_command';

create or replace function public.enforce_ai_provider_family_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind is distinct from old.kind or new.adapter is distinct from old.adapter then
    raise exception 'provider_family_immutable';
  end if;
  return new;
end;
$$;

create trigger ai_providers_family_immutable
before update of kind, adapter on public.ai_providers
for each row execute function public.enforce_ai_provider_family_immutability();

create or replace function public.enforce_ai_provider_billing_and_secret()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  provider_row public.ai_providers%rowtype;
begin
  if tg_table_name = 'provider_secrets' then
    select * into provider_row from public.ai_providers where id = new.provider_id;
    if provider_row.id is null or provider_row.kind <> 'openai_http' then
      raise exception 'provider_secret_requires_http_family';
    end if;
    return new;
  end if;

  select * into provider_row from public.ai_providers where id = new.provider_id;
  if provider_row.id is null or provider_row.billing_type <> new.billing_type then
    raise exception 'provider_model_billing_mismatch';
  end if;
  if provider_row.kind = 'subscription_command' and new.enabled then
    raise exception 'subscription_model_requires_capability';
  end if;
  return new;
end;
$$;

create trigger provider_secrets_http_only
before insert or update on public.provider_secrets
for each row execute function public.enforce_ai_provider_billing_and_secret();

create trigger ai_models_provider_consistency
before insert or update of provider_id, billing_type, enabled on public.ai_models
for each row execute function public.enforce_ai_provider_billing_and_secret();

create or replace function public.enforce_ai_provider_update_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.ai_models m
    where m.provider_id = new.id and m.billing_type <> new.billing_type
  ) then
    raise exception 'provider_model_billing_mismatch';
  end if;
  if new.kind = 'subscription_command' and exists (
    select 1 from public.provider_secrets s where s.provider_id = new.id
  ) then
    raise exception 'provider_secret_requires_http_family';
  end if;
  return new;
end;
$$;

create trigger ai_providers_update_consistency
before update of billing_type on public.ai_providers
for each row execute function public.enforce_ai_provider_update_consistency();

alter table public.candidates
  add column normalization_generation bigint not null default 0
  check (normalization_generation >= 0);

create table public.ai_provider_runtime_state (
  provider_id text primary key references public.ai_providers(id) on delete cascade,
  state text not null default 'authorization_required'
    check (state in ('authorization_required', 'ready', 'expired', 'needs_attention')),
  available boolean not null default false,
  reason text,
  checked_at timestamptz,
  ready_valid_until timestamptz,
  retry_not_before timestamptz,
  transient_failure_count integer not null default 0 check (transient_failure_count >= 0),
  settings_revision integer not null check (settings_revision > 0),
  execution_fingerprint text not null,
  auth_generation bigint not null default 0 check (auth_generation >= 0),
  probe_generation bigint not null default 0 check (probe_generation >= 0),
  current_probe_job_id uuid references public.jobs(id) on delete set null,
  current_probe_requested_at timestamptz,
  security_profile_version text not null,
  readiness_policy_version text not null,
  credential_source_digest text,
  binary_identity_digest text,
  capability_attestation_id uuid,
  containment_attestation_id uuid,
  terms_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not available or state = 'ready'),
  check (
    state <> 'ready'
    or (checked_at is not null and ready_valid_until is not null and ready_valid_until > checked_at)
  )
);

create table public.ai_provider_capability_attestations (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers(id) on delete cascade,
  adapter text not null check (adapter in ('codex', 'grok')),
  model_id text not null,
  role text not null check (role = 'niche_normalization'),
  settings_revision integer not null check (settings_revision > 0),
  auth_generation bigint not null check (auth_generation >= 0),
  execution_fingerprint text not null,
  capability_digest text not null,
  framing_digest text not null,
  bounded_behavior_digest text not null,
  checked_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (provider_id, model_id, execution_fingerprint, capability_digest),
  check (jsonb_typeof(evidence) = 'object')
);

create table public.ai_provider_containment_attestations (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers(id) on delete cascade,
  adapter text not null check (adapter in ('codex', 'grok')),
  settings_revision integer not null check (settings_revision > 0),
  auth_generation bigint not null check (auth_generation >= 0),
  execution_fingerprint text not null,
  security_profile_version text not null,
  containment_digest text not null,
  checked_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  unique (provider_id, execution_fingerprint, containment_digest),
  check (jsonb_typeof(evidence) = 'object')
);

alter table public.ai_provider_runtime_state
  add constraint ai_provider_runtime_capability_fkey
  foreign key (capability_attestation_id)
  references public.ai_provider_capability_attestations(id) on delete set null;
alter table public.ai_provider_runtime_state
  add constraint ai_provider_runtime_containment_fkey
  foreign key (containment_attestation_id)
  references public.ai_provider_containment_attestations(id) on delete set null;

create or replace function public.reject_immutable_attestation_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ai_provider_attestation_immutable';
end;
$$;

create trigger ai_provider_capability_attestations_immutable
before update or delete on public.ai_provider_capability_attestations
for each row execute function public.reject_immutable_attestation_change();
create trigger ai_provider_containment_attestations_immutable
before update or delete on public.ai_provider_containment_attestations
for each row execute function public.reject_immutable_attestation_change();

create table public.provider_attempt_events (
  event_id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  logical_analysis_id uuid not null,
  attempt_sequence bigint not null check (attempt_sequence > 0),
  event_type text not null check (event_type in (
    'attempt_started', 'attempt_succeeded', 'attempt_failed', 'attempt_cancelled',
    'attempt_not_consumed', 'attempt_unknown_after_crash'
  )),
  provider_id text not null references public.ai_providers(id) on delete restrict,
  model_id text not null,
  adapter text check (adapter is null or adapter in ('codex', 'grok')),
  role text not null check (role = 'niche_normalization'),
  billing_type text not null check (billing_type in ('free', 'subscription', 'payg')),
  settings_revision integer not null check (settings_revision > 0),
  auth_generation bigint not null check (auth_generation >= 0),
  execution_fingerprint text not null,
  probe_generation bigint check (probe_generation is null or probe_generation >= 0),
  fallback_parent_attempt_id uuid,
  request_count integer not null check (request_count = 1),
  job_id uuid not null,
  job_lease_owner text not null,
  job_lease_epoch integer not null check (job_lease_epoch > 0),
  analysis_lease_owner text not null,
  analysis_lease_epoch integer not null check (analysis_lease_epoch > 0),
  consumption_status text check (consumption_status in ('consumed', 'not_consumed', 'unknown')),
  result_class text,
  proof_category text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  provider_request_count integer check (provider_request_count is null or provider_request_count >= 0),
  safe_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detected_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(safe_metadata) = 'object'),
  check (
    (event_type = 'attempt_started'
      and consumption_status is null and result_class is null
      and proof_category is null and finished_at is null and detected_at is null)
    or (event_type = 'attempt_succeeded'
      and consumption_status = 'consumed' and result_class = 'success'
      and finished_at is not null and detected_at is null)
    or (event_type in ('attempt_failed', 'attempt_cancelled')
      and consumption_status is not null and result_class is not null
      and finished_at is not null and detected_at is null)
    or (event_type = 'attempt_not_consumed'
      and consumption_status = 'not_consumed'
      and result_class = 'pre_spawn_failure'
      and proof_category in (
        'spawn_rejected_before_child', 'sandbox_not_started',
        'profile_verification_failed_before_spawn',
        'semaphore_cancelled_before_authorization'
      ) and finished_at is not null and detected_at is null)
    or (event_type = 'attempt_unknown_after_crash'
      and consumption_status = 'unknown'
      and result_class = 'worker_process_loss'
      and detected_at is not null)
  )
);

create unique index provider_attempt_events_one_start
  on public.provider_attempt_events(attempt_id)
  where event_type = 'attempt_started';
create unique index provider_attempt_events_start_sequence
  on public.provider_attempt_events(logical_analysis_id, attempt_sequence)
  where event_type = 'attempt_started';
create unique index provider_attempt_events_one_outcome
  on public.provider_attempt_events(attempt_id)
  where event_type <> 'attempt_started';
create index provider_attempt_events_analysis_sequence
  on public.provider_attempt_events(logical_analysis_id, attempt_sequence, created_at);

create or replace function public.enforce_provider_attempt_event_chain()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  start_event public.provider_attempt_events%rowtype;
begin
  if new.event_type = 'attempt_started' then
    return new;
  end if;

  select * into start_event
  from public.provider_attempt_events
  where attempt_id = new.attempt_id and event_type = 'attempt_started';
  if start_event.event_id is null then
    raise exception 'provider_attempt_outcome_requires_start';
  end if;
  if new.logical_analysis_id is distinct from start_event.logical_analysis_id
     or new.attempt_sequence is distinct from start_event.attempt_sequence
     or new.provider_id is distinct from start_event.provider_id
     or new.model_id is distinct from start_event.model_id
     or new.adapter is distinct from start_event.adapter
     or new.role is distinct from start_event.role
     or new.billing_type is distinct from start_event.billing_type
     or new.settings_revision is distinct from start_event.settings_revision
     or new.auth_generation is distinct from start_event.auth_generation
     or new.execution_fingerprint is distinct from start_event.execution_fingerprint
     or new.job_id is distinct from start_event.job_id
     or new.job_lease_owner is distinct from start_event.job_lease_owner
     or new.job_lease_epoch is distinct from start_event.job_lease_epoch
     or new.analysis_lease_owner is distinct from start_event.analysis_lease_owner
     or new.analysis_lease_epoch is distinct from start_event.analysis_lease_epoch then
    raise exception 'provider_attempt_outcome_identity_mismatch';
  end if;
  return new;
end;
$$;

create trigger provider_attempt_event_chain
before insert on public.provider_attempt_events
for each row execute function public.enforce_provider_attempt_event_chain();

create or replace function public.reject_provider_attempt_event_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'provider_attempt_events_immutable';
end;
$$;

create trigger provider_attempt_events_immutable
before update or delete on public.provider_attempt_events
for each row execute function public.reject_provider_attempt_event_change();

alter table public.ai_analyses
  add column pending_winner_attempt_id uuid,
  add column pending_output jsonb,
  add column pending_usage jsonb,
  add constraint ai_analyses_pending_winner_complete_check
  check (
    (pending_winner_attempt_id is null and pending_output is null and pending_usage is null)
    or (pending_winner_attempt_id is not null and pending_output is not null and pending_usage is not null)
  );

create or replace function public.protect_ai_analysis_pending_winner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pending_winner_attempt_id is distinct from old.pending_winner_attempt_id
     or new.pending_output is distinct from old.pending_output
     or new.pending_usage is distinct from old.pending_usage then
    raise exception 'ai_analysis_pending_winner_protected';
  end if;
  return new;
end;
$$;

create trigger ai_analyses_pending_winner_protected
before update of pending_winner_attempt_id, pending_output, pending_usage
on public.ai_analyses
for each row execute function public.protect_ai_analysis_pending_winner();

create trigger ai_provider_runtime_state_set_updated_at
before update on public.ai_provider_runtime_state
for each row execute function public.set_updated_at();

alter table public.ai_provider_runtime_state enable row level security;
alter table public.ai_provider_capability_attestations enable row level security;
alter table public.ai_provider_containment_attestations enable row level security;
alter table public.provider_attempt_events enable row level security;

revoke all on public.ai_provider_runtime_state from public, anon, authenticated;
revoke all on public.ai_provider_capability_attestations from public, anon, authenticated;
revoke all on public.ai_provider_containment_attestations from public, anon, authenticated;
revoke all on public.provider_attempt_events from public, anon, authenticated;
grant all on public.ai_provider_runtime_state to service_role;
grant all on public.ai_provider_capability_attestations to service_role;
grant all on public.ai_provider_containment_attestations to service_role;
grant select, insert on public.provider_attempt_events to service_role;
