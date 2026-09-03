drop function public.begin_ai_provider_attempt(
  uuid, text, integer, uuid, text, integer, text, text,
  integer, bigint, text, uuid
);

create function public.begin_ai_provider_attempt(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer,
  provider_id text,
  model_id text,
  expected_settings_revision integer,
  expected_auth_generation bigint,
  expected_execution_fingerprint text,
  fallback_parent_attempt_id uuid default null,
  initial_payg_primary_authorized boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  job_row public.jobs%rowtype;
  analysis_row public.ai_analyses%rowtype;
  provider_row public.ai_providers%rowtype;
  runtime_row public.ai_provider_runtime_state%rowtype;
  model_row public.ai_models%rowtype;
  next_sequence bigint;
  created_attempt_id uuid := gen_random_uuid();
  provider_auth_generation bigint;
  provider_probe_generation bigint;
  analysis_candidate_id uuid;
  analysis_generation bigint;
  prior_external_provider_count integer;
  same_provider_start_count integer;
  parent_row public.provider_attempt_events%rowtype;
  parent_start public.provider_attempt_events%rowtype;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  analysis_row := public.assert_current_analysis_lease(
    analysis_id, analysis_lease_owner, analysis_lease_epoch, 'pending'
  );
  if analysis_row.role <> 'niche_normalization' then
    raise exception 'provider_attempt_role_rejected';
  end if;
  if jsonb_typeof(analysis_row.input_payload) <> 'object'
     or jsonb_typeof(analysis_row.input_payload->'candidateId') <> 'string'
     or jsonb_typeof(analysis_row.input_payload->'normalizationGeneration') <> 'number' then
    raise exception 'provider_attempt_logical_execution_rejected';
  end if;
  begin
    analysis_candidate_id := (analysis_row.input_payload->>'candidateId')::uuid;
    analysis_generation := (analysis_row.input_payload->>'normalizationGeneration')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'provider_attempt_logical_execution_rejected';
  end;
  if jsonb_typeof(job_row.payload) <> 'object'
     or jsonb_typeof(job_row.payload->'candidateIds') <> 'array'
     or jsonb_array_length(job_row.payload->'candidateIds') <> 1
     or job_row.payload->'candidateIds'->>0 is distinct from analysis_candidate_id::text
     or coalesce((job_row.payload->>'normalizationGeneration')::bigint, 0)
        is distinct from analysis_generation then
    raise exception 'provider_attempt_logical_execution_rejected';
  end if;
  if analysis_row.pending_winner_attempt_id is not null
     or analysis_row.winning_attempt_id is not null
     or analysis_row.status = 'completed' then
    raise exception 'provider_attempt_winner_exists';
  end if;

  select * into provider_row from public.ai_providers p
  where p.id = provider_id for update;
  select * into model_row from public.ai_models m
  where m.provider_id = provider_id and m.model_id = begin_ai_provider_attempt.model_id;
  if provider_row.id is null or model_row.id is null
     or not provider_row.enabled or not model_row.enabled
     or provider_row.settings_revision is distinct from expected_settings_revision
     or model_row.billing_type <> provider_row.billing_type then
    raise exception 'provider_attempt_provider_rejected';
  end if;

  if provider_row.billing_type = 'payg' then
    if not coalesce(initial_payg_primary_authorized, false)
       or fallback_parent_attempt_id is not null
       or provider_row.kind <> 'openai_http'
       or provider_row.adapter is not null
       or provider_row.config->>'openRouterProvider' is distinct from 'z-ai'
       or coalesce(provider_row.config->>'baseUrl', '')
          !~ '^https://openrouter\.ai(?::443)?(?:/|$)'
       or jsonb_typeof(provider_row.config->'roles') <> 'array'
       or not (provider_row.config->'roles' @> '["niche_normalization"]'::jsonb)
       or jsonb_typeof(provider_row.config->'executionProbe') <> 'object'
       or provider_row.config->'executionProbe'->>'available' is distinct from 'true'
       or provider_row.config->'executionProbe'->>'fingerprint'
          is distinct from expected_execution_fingerprint then
      raise exception 'provider_attempt_payg_primary_rejected';
    end if;
  elsif coalesce(initial_payg_primary_authorized, false) then
    raise exception 'provider_attempt_payg_primary_rejected';
  end if;

  if provider_row.kind = 'subscription_command' then
    select * into runtime_row from public.ai_provider_runtime_state r
    where r.provider_id = begin_ai_provider_attempt.provider_id for update;
    if runtime_row.provider_id is null
       or provider_row.adapter is null
       or runtime_row.settings_revision is distinct from expected_settings_revision
       or runtime_row.auth_generation is distinct from expected_auth_generation
       or runtime_row.execution_fingerprint is distinct from expected_execution_fingerprint
       or runtime_row.state <> 'ready' or not runtime_row.available
       or runtime_row.ready_valid_until is null
       or clock_timestamp() >= runtime_row.ready_valid_until
       or runtime_row.retry_not_before is not null
       or runtime_row.capability_attestation_id is null
       or runtime_row.containment_attestation_id is null
       or runtime_row.terms_digest is null
       or not public.is_ai_provider_routable(
         provider_id, model_id, expected_settings_revision,
         expected_auth_generation, expected_execution_fingerprint
       ) then
      raise exception 'provider_attempt_runtime_rejected';
    end if;
    provider_auth_generation := runtime_row.auth_generation;
    provider_probe_generation := runtime_row.probe_generation;
  elsif provider_row.kind = 'openai_http' then
    if expected_auth_generation <> 0
       or provider_row.adapter is not null
       or provider_row.config->>'executionIdentity' is distinct from expected_execution_fingerprint then
      raise exception 'provider_attempt_http_identity_rejected';
    end if;
    provider_auth_generation := 0;
    provider_probe_generation := null;
  else
    raise exception 'provider_attempt_family_rejected';
  end if;

  if exists (
    select 1 from public.provider_attempt_events s
    where s.logical_analysis_id = analysis_id
      and s.event_type = 'attempt_started'
      and not exists (
        select 1 from public.provider_attempt_events o
        where o.attempt_id = s.attempt_id and o.event_type <> 'attempt_started'
      )
  ) then
    raise exception 'provider_attempt_unresolved_start';
  end if;

  if fallback_parent_attempt_id is null then
    if exists (
      select 1 from public.provider_attempt_events e
      where e.logical_analysis_id = analysis_id and e.event_type = 'attempt_started'
    ) then
      raise exception 'provider_attempt_fallback_parent_rejected';
    end if;
  else
    select * into parent_start from public.provider_attempt_events e
    where e.attempt_id = fallback_parent_attempt_id
      and e.logical_analysis_id = analysis_id
      and e.job_id = job_id
      and e.event_type = 'attempt_started';
    select * into parent_row from public.provider_attempt_events e
    where e.attempt_id = fallback_parent_attempt_id
      and e.logical_analysis_id = analysis_id
      and e.event_type <> 'attempt_started';
    if parent_start.event_id is null or parent_row.event_id is null
       or parent_start.attempt_sequence <> (
         select max(s.attempt_sequence) from public.provider_attempt_events s
         where s.logical_analysis_id = analysis_id and s.event_type = 'attempt_started'
       ) then
      raise exception 'provider_attempt_fallback_parent_rejected';
    end if;
    if parent_start.provider_id = provider_id then
      select count(*)::integer into same_provider_start_count
      from public.provider_attempt_events s
      where s.logical_analysis_id = analysis_id
        and s.event_type = 'attempt_started'
        and s.provider_id = provider_id;
      if parent_row.event_type <> 'attempt_not_consumed'
         or parent_row.result_class <> 'pre_spawn_failure'
         or parent_row.proof_category not in (
           'spawn_rejected_before_child', 'sandbox_not_started',
           'profile_verification_failed_before_spawn',
           'semaphore_cancelled_before_authorization'
         ) then
        raise exception 'provider_attempt_provider_replay_rejected';
      end if;
      if same_provider_start_count >= 2 then
        raise exception 'provider_attempt_provider_replacement_rejected';
      end if;
    elsif not (
      (
        parent_row.event_type = 'attempt_failed'
        and parent_row.result_class in (
          'auth_expired', 'capacity_exhausted', 'rate_limited',
          'transient_network', 'client_transient', 'timeout'
        )
      )
      or (
        parent_row.event_type = 'attempt_unknown_after_crash'
        and parent_row.consumption_status = 'unknown'
        and parent_row.result_class = 'worker_process_loss'
      )
    ) then
      raise exception 'provider_attempt_fallback_parent_rejected';
    end if;
  end if;

  if exists (
    select 1 from public.provider_attempt_events s
    where s.logical_analysis_id = analysis_id
      and s.event_type = 'attempt_started'
      and s.provider_id = provider_id
      and not exists (
        select 1 from public.provider_attempt_events o
        where o.attempt_id = s.attempt_id and o.event_type = 'attempt_not_consumed'
      )
  ) then
    raise exception 'provider_attempt_provider_replay_rejected';
  end if;

  select count(distinct s.provider_id)::integer into prior_external_provider_count
  from public.provider_attempt_events s
  where s.logical_analysis_id = analysis_id
    and s.event_type = 'attempt_started'
    and not exists (
      select 1 from public.provider_attempt_events o
      where o.attempt_id = s.attempt_id and o.event_type = 'attempt_not_consumed'
    );
  if not exists (
    select 1 from public.provider_attempt_events s
    where s.logical_analysis_id = analysis_id
      and s.event_type = 'attempt_started'
      and s.provider_id = provider_id
  ) and prior_external_provider_count >= 3 then
    raise exception 'provider_attempt_provider_limit_rejected';
  end if;

  select coalesce(max(e.attempt_sequence), 0) + 1 into next_sequence
  from public.provider_attempt_events e
  where e.logical_analysis_id = analysis_id and e.event_type = 'attempt_started';

  insert into public.provider_attempt_events (
    attempt_id, logical_analysis_id, attempt_sequence, event_type,
    provider_id, model_id, adapter, role, billing_type,
    settings_revision, auth_generation, execution_fingerprint, probe_generation,
    fallback_parent_attempt_id, request_count,
    job_id, job_lease_owner, job_lease_epoch,
    analysis_lease_owner, analysis_lease_epoch, safe_metadata
  ) values (
    created_attempt_id, analysis_id, next_sequence, 'attempt_started',
    provider_id, model_id, provider_row.adapter, analysis_row.role,
    provider_row.billing_type, expected_settings_revision,
    provider_auth_generation, expected_execution_fingerprint,
    provider_probe_generation, fallback_parent_attempt_id, 1,
    job_id, job_lease_owner, job_lease_epoch,
    analysis_lease_owner, analysis_lease_epoch, '{}'::jsonb
  );

  return jsonb_build_object(
    'attempt_id', created_attempt_id,
    'attempt_sequence', next_sequence,
    'provider_id', provider_id,
    'model_id', model_id,
    'adapter', provider_row.adapter,
    'billing_type', provider_row.billing_type
  );
end;
$$;

grant create on schema public to ara_provider_authority;

alter function public.begin_ai_provider_attempt(
  uuid, text, integer, uuid, text, integer, text, text,
  integer, bigint, text, uuid, boolean
) owner to ara_provider_authority;

revoke create on schema public from ara_provider_authority;

revoke all on function public.begin_ai_provider_attempt(
  uuid, text, integer, uuid, text, integer, text, text,
  integer, bigint, text, uuid, boolean
) from public, anon, authenticated;

grant execute on function public.begin_ai_provider_attempt(
  uuid, text, integer, uuid, text, integer, text, text,
  integer, bigint, text, uuid, boolean
) to service_role;
