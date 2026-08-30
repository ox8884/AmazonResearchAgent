alter table public.ai_provider_runtime_state
  add column security_profile_digest text;
alter table public.ai_provider_containment_attestations
  add column security_profile_digest text;
do $$
declare
  legacy_constraint text;
begin
  select constraint_row.conname into legacy_constraint
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as relation_row
    on relation_row.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace as namespace_row
    on namespace_row.oid = relation_row.relnamespace
  where namespace_row.nspname = 'public'
    and relation_row.relname = 'ai_provider_containment_attestations'
    and constraint_row.contype = 'u'
    and (
      select array_agg(attribute_row.attname order by key_column.ordinality)
      from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_catalog.pg_attribute as attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_column.attnum
    ) = array['provider_id', 'execution_fingerprint', 'containment_digest']::name[]
  limit 1;
  if legacy_constraint is null then
    raise exception 'legacy containment attestation constraint missing';
  end if;
  execute format(
    'alter table public.ai_provider_containment_attestations drop constraint %I',
    legacy_constraint
  );
end;
$$;
alter table public.ai_provider_containment_attestations
  add constraint ai_provider_containment_attestation_binding_key
  unique (
    provider_id,
    execution_fingerprint,
    security_profile_digest,
    containment_digest
  );

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
  if provider_row.kind = 'subscription_command'
     and new.enabled
     and current_user <> 'ara_provider_authority' then
    raise exception 'subscription_model_requires_capability';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_subscription_provider_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'subscription_command'
     and new.enabled
     and (tg_op = 'INSERT' or not old.enabled)
     and current_user <> 'ara_provider_authority' then
    raise exception 'subscription_provider_requires_activation';
  end if;
  return new;
end;
$$;

create trigger ai_providers_subscription_activation
before insert or update of enabled on public.ai_providers
for each row execute function public.enforce_subscription_provider_activation();

create or replace function public.enqueue_ai_provider_probe_locked(
  provider_row public.ai_providers,
  runtime_row public.ai_provider_runtime_state
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  active_job public.jobs%rowtype;
  next_generation bigint;
  inserted_job public.jobs%rowtype;
  probe_key text;
begin
  if not provider_row.enabled then
    raise exception 'provider_probe_requires_enabled_provider';
  end if;
  if runtime_row.retry_not_before is not null and runtime_row.retry_not_before > clock_timestamp() then
    raise exception 'provider_probe_retry_not_elapsed';
  end if;

  if runtime_row.current_probe_job_id is not null then
    select * into active_job from public.jobs
    where id = runtime_row.current_probe_job_id
      and status in ('queued', 'running');
    if active_job.id is not null then
      return jsonb_build_object(
        'job_id', active_job.id,
        'probe_generation', runtime_row.probe_generation
      );
    end if;
  end if;

  next_generation := runtime_row.probe_generation + 1;
  probe_key := concat(
    'provider-probe:', provider_row.id, ':', provider_row.settings_revision, ':',
    runtime_row.auth_generation, ':', runtime_row.execution_fingerprint, ':', next_generation
  );
  insert into public.jobs (type, payload, status, priority, idempotency_key)
  values (
    'PROBE_AI_PROVIDER_READINESS',
    jsonb_build_object(
      'providerId', provider_row.id,
      'settingsRevision', provider_row.settings_revision,
      'authGeneration', runtime_row.auth_generation,
      'executionFingerprint', runtime_row.execution_fingerprint,
      'probeGeneration', next_generation
    ),
    'queued', 10, probe_key
  )
  returning * into inserted_job;

  update public.ai_provider_runtime_state
  set probe_generation = next_generation,
      current_probe_job_id = inserted_job.id,
      current_probe_requested_at = clock_timestamp(),
      retry_not_before = null,
      available = false
  where provider_id = provider_row.id;

  return jsonb_build_object(
    'job_id', inserted_job.id,
    'probe_generation', next_generation
  );
end;
$$;

create or replace function public.request_ai_provider_probe(
  provider_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
begin
  select * into provider_row from public.ai_providers p where p.id = provider_id for update;
  select * into runtime_row from public.ai_provider_runtime_state r where r.provider_id = request_ai_provider_probe.provider_id for update;
  if provider_row.id is null or runtime_row.provider_id is null
     or provider_row.kind <> 'subscription_command'
     or provider_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.auth_generation is distinct from expected_auth_generation
     or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint then
    raise exception 'provider_runtime_cas_conflict';
  end if;
  return public.enqueue_ai_provider_probe_locked(provider_row, runtime_row);
end;
$$;

create or replace function public.commit_ai_provider_acceptance_probe(
  provider_id text,
  model_id text,
  adapter text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text,
  security_profile_version text,
  security_profile_digest text,
  readiness_policy_version text,
  terms_digest text,
  credential_source_digest text,
  binary_identity_digest text,
  capability_digest text,
  framing_digest text,
  bounded_behavior_digest text,
  containment_digest text,
  evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
  capability_id uuid;
  containment_id uuid;
begin
  select * into provider_row
  from public.ai_providers p
  where p.id = commit_ai_provider_acceptance_probe.provider_id
  for update;
  if provider_row.id is null or provider_row.kind <> 'subscription_command'
     or provider_row.enabled or provider_row.adapter is distinct from adapter
     or provider_row.settings_revision is distinct from expected_settings_revision
     or terms_digest is null or btrim(terms_digest) = ''
     or security_profile_digest is null or security_profile_digest !~ '^[0-9a-f]{64}$'
     or evidence is null or jsonb_typeof(evidence) <> 'object' then
    raise exception 'provider_acceptance_rejected';
  end if;
  perform 1 from public.ai_models m
  where m.provider_id = commit_ai_provider_acceptance_probe.provider_id
    and m.model_id = commit_ai_provider_acceptance_probe.model_id
    and not m.enabled and m.billing_type = 'subscription'
  for update;
  if not found then raise exception 'provider_acceptance_model_rejected'; end if;

  select * into runtime_row from public.ai_provider_runtime_state r
  where r.provider_id = commit_ai_provider_acceptance_probe.provider_id for update;
  if runtime_row.provider_id is not null
     and runtime_row.auth_generation is distinct from expected_auth_generation then
    raise exception 'provider_runtime_cas_conflict';
  end if;

  insert into public.ai_provider_capability_attestations (
    provider_id, adapter, model_id, role, settings_revision, auth_generation,
    execution_fingerprint, capability_digest, framing_digest,
    bounded_behavior_digest, evidence
  ) values (
    commit_ai_provider_acceptance_probe.provider_id,
    commit_ai_provider_acceptance_probe.adapter,
    commit_ai_provider_acceptance_probe.model_id,
    'niche_normalization', expected_settings_revision, expected_auth_generation,
    expected_execution_fingerprint, commit_ai_provider_acceptance_probe.capability_digest,
    framing_digest, bounded_behavior_digest, evidence
  ) on conflict do nothing
  returning id into capability_id;
  if capability_id is null then
    select c.id into capability_id
    from public.ai_provider_capability_attestations c
    where c.provider_id = commit_ai_provider_acceptance_probe.provider_id
      and c.model_id = commit_ai_provider_acceptance_probe.model_id
      and c.execution_fingerprint = expected_execution_fingerprint
      and c.capability_digest = commit_ai_provider_acceptance_probe.capability_digest;
  end if;

  insert into public.ai_provider_containment_attestations (
    provider_id, adapter, settings_revision, auth_generation, execution_fingerprint,
    security_profile_version, security_profile_digest, containment_digest, evidence
  ) values (
    commit_ai_provider_acceptance_probe.provider_id,
    commit_ai_provider_acceptance_probe.adapter,
    expected_settings_revision, expected_auth_generation, expected_execution_fingerprint,
    commit_ai_provider_acceptance_probe.security_profile_version,
    commit_ai_provider_acceptance_probe.security_profile_digest,
    commit_ai_provider_acceptance_probe.containment_digest, evidence
  ) on conflict do nothing
  returning id into containment_id;
  if containment_id is null then
    select c.id into containment_id
    from public.ai_provider_containment_attestations c
    where c.provider_id = commit_ai_provider_acceptance_probe.provider_id
      and c.execution_fingerprint = expected_execution_fingerprint
      and c.security_profile_digest = commit_ai_provider_acceptance_probe.security_profile_digest
      and c.containment_digest = commit_ai_provider_acceptance_probe.containment_digest;
  end if;

  insert into public.ai_provider_runtime_state (
    provider_id, state, available, reason, settings_revision, execution_fingerprint,
    auth_generation, security_profile_version, security_profile_digest,
    readiness_policy_version, credential_source_digest, binary_identity_digest,
    capability_attestation_id, containment_attestation_id, terms_digest
  ) values (
    commit_ai_provider_acceptance_probe.provider_id,
    'authorization_required', false, 'acceptance_recorded',
    expected_settings_revision, expected_execution_fingerprint, expected_auth_generation,
    commit_ai_provider_acceptance_probe.security_profile_version,
    commit_ai_provider_acceptance_probe.security_profile_digest,
    commit_ai_provider_acceptance_probe.readiness_policy_version,
    commit_ai_provider_acceptance_probe.credential_source_digest,
    commit_ai_provider_acceptance_probe.binary_identity_digest,
    capability_id, containment_id, commit_ai_provider_acceptance_probe.terms_digest
  ) on conflict on constraint ai_provider_runtime_state_pkey do update set
    state = 'authorization_required', available = false, reason = 'acceptance_recorded',
    checked_at = null, ready_valid_until = null, retry_not_before = null,
    settings_revision = excluded.settings_revision,
    execution_fingerprint = excluded.execution_fingerprint,
    security_profile_version = excluded.security_profile_version,
    security_profile_digest = excluded.security_profile_digest,
    readiness_policy_version = excluded.readiness_policy_version,
    credential_source_digest = excluded.credential_source_digest,
    binary_identity_digest = excluded.binary_identity_digest,
    capability_attestation_id = excluded.capability_attestation_id,
    containment_attestation_id = excluded.containment_attestation_id,
    terms_digest = excluded.terms_digest;

  return jsonb_build_object(
    'capability_attestation_id', capability_id,
    'containment_attestation_id', containment_id
  );
end;
$$;

create or replace function public.activate_subscription_provider(
  provider_id text,
  model_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text,
  terms_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
  capability_row public.ai_provider_capability_attestations%rowtype;
  containment_row public.ai_provider_containment_attestations%rowtype;
begin
  select * into provider_row from public.ai_providers p where p.id = provider_id for update;
  select * into runtime_row from public.ai_provider_runtime_state r where r.provider_id = activate_subscription_provider.provider_id for update;
  if provider_row.id is null or runtime_row.provider_id is null
     or provider_row.kind <> 'subscription_command' or provider_row.enabled
     or provider_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.auth_generation is distinct from expected_auth_generation
     or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint
     or runtime_row.terms_digest is distinct from terms_digest
     or runtime_row.security_profile_digest is null
     or runtime_row.credential_source_digest is null
     or runtime_row.binary_identity_digest is null then
    raise exception 'provider_activation_rejected';
  end if;
  select * into capability_row from public.ai_provider_capability_attestations c
  where c.id = runtime_row.capability_attestation_id
    and c.provider_id = activate_subscription_provider.provider_id
    and c.model_id = activate_subscription_provider.model_id
    and c.settings_revision = expected_settings_revision
    and c.auth_generation = expected_auth_generation
    and c.execution_fingerprint = expected_execution_fingerprint;
  select * into containment_row from public.ai_provider_containment_attestations c
  where c.id = runtime_row.containment_attestation_id
    and c.provider_id = activate_subscription_provider.provider_id
    and c.settings_revision = expected_settings_revision
    and c.auth_generation = expected_auth_generation
    and c.execution_fingerprint = expected_execution_fingerprint
    and c.security_profile_version = runtime_row.security_profile_version
    and c.security_profile_digest = runtime_row.security_profile_digest;
  if capability_row.id is null or containment_row.id is null then
    raise exception 'provider_activation_evidence_stale';
  end if;

  update public.ai_providers set enabled = true where id = provider_id;
  update public.ai_models set enabled = (ai_models.model_id = activate_subscription_provider.model_id)
  where ai_models.provider_id = activate_subscription_provider.provider_id;
  update public.ai_provider_runtime_state
  set state = 'authorization_required', available = false, reason = 'activation_probe_required',
      checked_at = null, ready_valid_until = null, retry_not_before = null,
      current_probe_job_id = null, current_probe_requested_at = null
  where ai_provider_runtime_state.provider_id = activate_subscription_provider.provider_id
  returning * into runtime_row;
  select * into provider_row from public.ai_providers p where p.id = provider_id;
  return public.enqueue_ai_provider_probe_locked(provider_row, runtime_row);
end;
$$;

create or replace function public.deactivate_subscription_provider(provider_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  runtime_row public.ai_provider_runtime_state%rowtype;
begin
  perform 1 from public.ai_providers p where p.id = provider_id and p.kind = 'subscription_command' for update;
  if not found then raise exception 'subscription_provider_not_found'; end if;
  update public.ai_providers set enabled = false where id = provider_id;
  update public.ai_models set enabled = false where ai_models.provider_id = deactivate_subscription_provider.provider_id;
  update public.ai_provider_runtime_state
  set state = 'authorization_required', available = false, reason = 'provider_disabled',
      checked_at = null, ready_valid_until = null, retry_not_before = null,
      probe_generation = probe_generation + 1,
      current_probe_job_id = null, current_probe_requested_at = null
  where ai_provider_runtime_state.provider_id = deactivate_subscription_provider.provider_id
  returning * into runtime_row;
  return to_jsonb(runtime_row);
end;
$$;

create or replace function public.commit_ai_provider_probe(
  provider_id text,
  model_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text,
  expected_probe_generation bigint,
  terms_digest text,
  security_profile_digest text,
  credential_source_digest text,
  binary_identity_digest text,
  capability_digest text,
  framing_digest text,
  bounded_behavior_digest text,
  containment_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
  capability_row public.ai_provider_capability_attestations%rowtype;
  containment_row public.ai_provider_containment_attestations%rowtype;
  checked timestamptz := clock_timestamp();
begin
  select * into provider_row from public.ai_providers p where p.id = provider_id for update;
  select * into runtime_row from public.ai_provider_runtime_state r where r.provider_id = commit_ai_provider_probe.provider_id for update;
  if provider_row.id is null or runtime_row.provider_id is null
     or not provider_row.enabled or provider_row.kind <> 'subscription_command'
     or provider_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.auth_generation is distinct from expected_auth_generation
     or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint
     or runtime_row.probe_generation is distinct from expected_probe_generation
     or runtime_row.capability_attestation_id is null
     or runtime_row.containment_attestation_id is null
     or not exists (
       select 1 from public.ai_models m
       where m.provider_id = commit_ai_provider_probe.provider_id
         and m.model_id = commit_ai_provider_probe.model_id
         and m.enabled and m.billing_type = 'subscription'
     ) then
    raise exception 'provider_probe_cas_conflict';
  end if;

  select * into capability_row
  from public.ai_provider_capability_attestations c
  where c.id = runtime_row.capability_attestation_id;
  select * into containment_row
  from public.ai_provider_containment_attestations c
  where c.id = runtime_row.containment_attestation_id;
  if runtime_row.terms_digest is distinct from terms_digest
     or runtime_row.security_profile_digest is distinct from security_profile_digest
     or runtime_row.credential_source_digest is distinct from credential_source_digest
     or runtime_row.binary_identity_digest is distinct from binary_identity_digest
     or capability_row.id is null
     or capability_row.provider_id is distinct from commit_ai_provider_probe.provider_id
     or capability_row.model_id is distinct from commit_ai_provider_probe.model_id
     or capability_row.settings_revision is distinct from expected_settings_revision
     or capability_row.auth_generation is distinct from expected_auth_generation
     or capability_row.execution_fingerprint is distinct from expected_execution_fingerprint
     or capability_row.capability_digest is distinct from capability_digest
     or capability_row.framing_digest is distinct from framing_digest
     or capability_row.bounded_behavior_digest is distinct from bounded_behavior_digest
     or containment_row.id is null
     or containment_row.provider_id is distinct from commit_ai_provider_probe.provider_id
     or containment_row.settings_revision is distinct from expected_settings_revision
     or containment_row.auth_generation is distinct from expected_auth_generation
     or containment_row.execution_fingerprint is distinct from expected_execution_fingerprint
     or containment_row.security_profile_version is distinct from runtime_row.security_profile_version
     or containment_row.security_profile_digest is distinct from security_profile_digest
     or containment_row.containment_digest is distinct from containment_digest then
    raise exception 'provider_probe_evidence_mismatch';
  end if;

  update public.ai_provider_runtime_state
  set state = 'ready', available = true, reason = null,
      checked_at = checked, ready_valid_until = checked + interval '10 minutes',
      retry_not_before = null, transient_failure_count = 0,
      current_probe_job_id = null, current_probe_requested_at = null
  where ai_provider_runtime_state.provider_id = commit_ai_provider_probe.provider_id
  returning * into runtime_row;
  return to_jsonb(runtime_row);
end;
$$;

create or replace function public.is_ai_provider_routable(
  provider_id text,
  model_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ai_providers p
    join public.ai_models m on m.provider_id = p.id and m.model_id = is_ai_provider_routable.model_id
    join public.ai_provider_runtime_state r on r.provider_id = p.id
    join public.ai_provider_capability_attestations c on c.id = r.capability_attestation_id
    join public.ai_provider_containment_attestations x on x.id = r.containment_attestation_id
    where p.id = is_ai_provider_routable.provider_id
      and p.enabled and m.enabled and p.kind = 'subscription_command'
      and p.settings_revision = expected_settings_revision
      and r.settings_revision = expected_settings_revision
      and r.auth_generation = expected_auth_generation
      and r.execution_fingerprint = expected_execution_fingerprint
      and r.state = 'ready' and r.available
      and r.ready_valid_until is not null and clock_timestamp() < r.ready_valid_until
      and r.retry_not_before is null and r.terms_digest is not null
      and c.provider_id = p.id and c.model_id = m.model_id
      and c.settings_revision = r.settings_revision
      and c.auth_generation = r.auth_generation
      and c.execution_fingerprint = r.execution_fingerprint
      and x.provider_id = p.id and x.settings_revision = r.settings_revision
      and x.auth_generation = r.auth_generation
      and x.execution_fingerprint = r.execution_fingerprint
      and x.security_profile_version = r.security_profile_version
      and r.security_profile_digest is not null
      and x.security_profile_digest = r.security_profile_digest
  );
$$;

create or replace function public.apply_ai_provider_runtime_failure(
  attempt_id uuid,
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer,
  failure_class text,
  retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  start_row public.provider_attempt_events%rowtype;
  outcome_row public.provider_attempt_events%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
  job_row public.jobs%rowtype;
  analysis_row public.ai_analyses%rowtype;
  delay_seconds integer;
  mutable boolean := true;
  fallback boolean := false;
  replay boolean := false;
begin
  select * into job_row from public.jobs j where j.id = job_id for update;
  if job_row.id is null
     or job_row.status <> 'running'
     or job_row.leased_by is distinct from job_lease_owner
     or job_row.attempts is distinct from job_lease_epoch
     or job_row.leased_until is null
     or job_row.leased_until <= clock_timestamp() then
    raise exception 'job_lease_rejected';
  end if;
  select * into analysis_row from public.ai_analyses a where a.id = analysis_id for update;
  if analysis_row.id is null
     or analysis_row.status <> 'pending'
     or analysis_row.leased_by is distinct from analysis_lease_owner
     or analysis_row.attempts is distinct from analysis_lease_epoch
     or analysis_row.leased_until is null
     or analysis_row.leased_until <= clock_timestamp() then
    raise exception 'analysis_lease_rejected';
  end if;
  select * into start_row from public.provider_attempt_events e
  where e.attempt_id = apply_ai_provider_runtime_failure.attempt_id
    and e.event_type = 'attempt_started' for update;
  select * into outcome_row from public.provider_attempt_events e
  where e.attempt_id = apply_ai_provider_runtime_failure.attempt_id
    and e.event_type in ('attempt_failed', 'attempt_cancelled') for update;
  if start_row.event_id is null or outcome_row.event_id is null
     or start_row.logical_analysis_id <> analysis_id
     or start_row.job_id <> job_id
     or start_row.job_lease_owner <> job_lease_owner
     or start_row.job_lease_epoch <> job_lease_epoch
     or start_row.analysis_lease_owner <> analysis_lease_owner
     or start_row.analysis_lease_epoch <> analysis_lease_epoch
     or outcome_row.result_class is distinct from failure_class then
    raise exception 'provider_runtime_attempt_rejected';
  end if;
  select * into runtime_row from public.ai_provider_runtime_state r
  where r.provider_id = start_row.provider_id for update;
  if runtime_row.provider_id is null
     or runtime_row.settings_revision is distinct from start_row.settings_revision
     or runtime_row.auth_generation is distinct from start_row.auth_generation
     or runtime_row.execution_fingerprint is distinct from start_row.execution_fingerprint
     or runtime_row.probe_generation is distinct from start_row.probe_generation
     or not exists (
       select 1 from public.ai_providers p
       where p.id = start_row.provider_id
         and p.settings_revision = start_row.settings_revision
     ) then
    raise exception 'provider_runtime_cas_conflict';
  end if;
  case failure_class
    when 'auth_expired' then
      update public.ai_provider_runtime_state set state='expired', available=false,
        reason='auth_expired', checked_at=null, ready_valid_until=null, retry_not_before=null
      where provider_id = start_row.provider_id;
      fallback := true;
    when 'credential_source_mismatch' then
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='credential_source_mismatch', checked_at=null, ready_valid_until=null,
        retry_not_before=null, credential_source_digest=null
      where provider_id = start_row.provider_id;
    when 'binary_identity_mismatch' then
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='binary_identity_mismatch', checked_at=null, ready_valid_until=null,
        retry_not_before=null, binary_identity_digest=null
      where provider_id = start_row.provider_id;
    when 'profile_mismatch' then
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='profile_mismatch', checked_at=null, ready_valid_until=null,
        retry_not_before=null, containment_attestation_id=null
      where provider_id = start_row.provider_id;
    when 'containment_failure' then
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='containment_failure', checked_at=null, ready_valid_until=null,
        retry_not_before=null, containment_attestation_id=null
      where provider_id = start_row.provider_id;
    when 'capability_failure' then
      update public.ai_models set enabled=false
      where provider_id = start_row.provider_id and model_id = start_row.model_id;
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='capability_failure', checked_at=null, ready_valid_until=null,
        retry_not_before=null, capability_attestation_id=null
      where provider_id = start_row.provider_id;
    when 'capacity_exhausted', 'rate_limited' then
      delay_seconds := least(900, greatest(60, coalesce(retry_after_seconds, 300)));
      update public.ai_provider_runtime_state set state='ready', available=false,
        reason='temporary_capacity', retry_not_before=clock_timestamp()+make_interval(secs=>delay_seconds)
      where provider_id = start_row.provider_id;
      fallback := true;
    when 'transient_network', 'client_transient', 'timeout' then
      delay_seconds := case least(runtime_row.transient_failure_count + 1, 4)
        when 1 then 30 when 2 then 60 when 3 then 120 else 300 end;
      update public.ai_provider_runtime_state set state='ready', available=false,
        reason='transient_client_failure', retry_not_before=clock_timestamp()+make_interval(secs=>delay_seconds),
        transient_failure_count=least(transient_failure_count+1,4)
      where provider_id = start_row.provider_id;
      fallback := true;
    when 'unsafe_unknown' then
      update public.ai_provider_runtime_state set state='needs_attention', available=false,
        reason='unsafe_unknown', checked_at=null, ready_valid_until=null, retry_not_before=null
      where provider_id = start_row.provider_id;
    when 'cancelled_by_caller', 'cancelled_by_job_lease_loss', 'cancelled_by_shutdown',
         'schema_invalid_output', 'business_validation_failure' then
      mutable := false;
    else
      raise exception 'unknown_subscription_failure_class';
  end case;
  return jsonb_build_object('mutated', mutable, 'allow_fallback', fallback, 'allow_replay', replay);
end;
$$;

create or replace function public.fence_ai_provider_auth(
  provider_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare runtime_row public.ai_provider_runtime_state%rowtype;
begin
  select * into runtime_row from public.ai_provider_runtime_state r
  where r.provider_id = fence_ai_provider_auth.provider_id for update;
  if runtime_row.provider_id is null
     or runtime_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.auth_generation is distinct from expected_auth_generation
     or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint then
    raise exception 'provider_runtime_cas_conflict';
  end if;
  update public.ai_provider_runtime_state
  set state='authorization_required', available=false, reason='authorization_required',
      checked_at=null, ready_valid_until=null, retry_not_before=null,
      auth_generation=auth_generation+1, probe_generation=probe_generation+1,
      current_probe_job_id=null, current_probe_requested_at=null,
      credential_source_digest=null, capability_attestation_id=null,
      containment_attestation_id=null
  where ai_provider_runtime_state.provider_id = fence_ai_provider_auth.provider_id
  returning * into runtime_row;
  return to_jsonb(runtime_row);
end;
$$;

create or replace function public.expire_ai_provider_ready_lease(
  provider_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
begin
  select * into provider_row from public.ai_providers p where p.id=provider_id for update;
  select * into runtime_row from public.ai_provider_runtime_state r
  where r.provider_id=expire_ai_provider_ready_lease.provider_id for update;
  if provider_row.id is null or runtime_row.provider_id is null
     or provider_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.settings_revision is distinct from expected_settings_revision
     or runtime_row.auth_generation is distinct from expected_auth_generation
     or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint then
    raise exception 'provider_runtime_cas_conflict';
  end if;
  if runtime_row.ready_valid_until is null or clock_timestamp() < runtime_row.ready_valid_until then
    return null;
  end if;
  update public.ai_provider_runtime_state
  set available = false, reason = 'readiness_stale'
  where ai_provider_runtime_state.provider_id = expire_ai_provider_ready_lease.provider_id
  returning * into runtime_row;
  return public.enqueue_ai_provider_probe_locked(provider_row, runtime_row);
end;
$$;

create or replace function public.record_ai_provider_execution_probe(
  provider_id text,
  expected_fingerprint text,
  probe jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if provider_id is null or expected_fingerprint is null or probe is null then
    return false;
  end if;
  update public.ai_providers
  set config = jsonb_set(
    jsonb_set(coalesce(config, '{}'::jsonb), '{executionIdentity}',
      to_jsonb(expected_fingerprint), true),
    '{executionProbe}', probe, true
  )
  where id = record_ai_provider_execution_probe.provider_id
    and kind = 'openai_http'
    and coalesce(config->>'executionIdentity', expected_fingerprint) = expected_fingerprint;
  return found;
end;
$$;

alter function public.enqueue_ai_provider_probe_locked(public.ai_providers, public.ai_provider_runtime_state) owner to ara_provider_authority;
alter function public.request_ai_provider_probe(text, integer, bigint, text) owner to ara_provider_authority;
alter function public.commit_ai_provider_acceptance_probe(text, text, text, integer, bigint, text, text, text, text, text, text, text, text, text, text, text, jsonb) owner to ara_provider_authority;
alter function public.activate_subscription_provider(text, text, integer, bigint, text, text) owner to ara_provider_authority;
alter function public.deactivate_subscription_provider(text) owner to ara_provider_authority;
alter function public.commit_ai_provider_probe(text, text, integer, bigint, text, bigint, text, text, text, text, text, text, text, text) owner to ara_provider_authority;
alter function public.is_ai_provider_routable(text, text, integer, bigint, text) owner to ara_provider_authority;
alter function public.apply_ai_provider_runtime_failure(uuid, uuid, text, integer, uuid, text, integer, text, integer) owner to ara_provider_authority;
alter function public.fence_ai_provider_auth(text, integer, bigint, text) owner to ara_provider_authority;
alter function public.expire_ai_provider_ready_lease(text, integer, bigint, text) owner to ara_provider_authority;

revoke all on function public.enqueue_ai_provider_probe_locked(public.ai_providers, public.ai_provider_runtime_state) from public, anon, authenticated;
revoke all on function public.request_ai_provider_probe(text, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.commit_ai_provider_acceptance_probe(text, text, text, integer, bigint, text, text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.activate_subscription_provider(text, text, integer, bigint, text, text) from public, anon, authenticated;
revoke all on function public.deactivate_subscription_provider(text) from public, anon, authenticated;
revoke all on function public.commit_ai_provider_probe(text, text, integer, bigint, text, bigint, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.is_ai_provider_routable(text, text, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.apply_ai_provider_runtime_failure(uuid, uuid, text, integer, uuid, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.fence_ai_provider_auth(text, integer, bigint, text) from public, anon, authenticated;
revoke all on function public.expire_ai_provider_ready_lease(text, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.request_ai_provider_probe(text, integer, bigint, text) to service_role;
grant execute on function public.commit_ai_provider_acceptance_probe(text, text, text, integer, bigint, text, text, text, text, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.activate_subscription_provider(text, text, integer, bigint, text, text) to service_role;
grant execute on function public.deactivate_subscription_provider(text) to service_role;
grant execute on function public.commit_ai_provider_probe(text, text, integer, bigint, text, bigint, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.is_ai_provider_routable(text, text, integer, bigint, text) to service_role;
grant execute on function public.apply_ai_provider_runtime_failure(uuid, uuid, text, integer, uuid, text, integer, text, integer) to service_role;
grant execute on function public.fence_ai_provider_auth(text, integer, bigint, text) to service_role;
grant execute on function public.expire_ai_provider_ready_lease(text, integer, bigint, text) to service_role;
