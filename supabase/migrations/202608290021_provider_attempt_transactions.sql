drop function if exists public.heartbeat_job(uuid, text, integer);
drop function if exists public.checkpoint_job(uuid, text, jsonb, integer);
drop function if exists public.complete_job(uuid, text, jsonb);
drop function if exists public.fail_job(uuid, text, text, timestamptz, jsonb);

create or replace function public.claim_jobs(
  worker_id text,
  job_limit integer,
  lease_seconds integer
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id must not be empty';
  end if;
  if job_limit < 1 or job_limit > 100 then
    raise exception 'job_limit must be between 1 and 100';
  end if;
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;

  return query
  with eligible as (
    select j.id
    from public.jobs j
    where j.attempts < j.max_attempts
      and (
        (j.status = 'queued' and j.available_at <= clock_timestamp())
        or (j.status = 'running' and j.leased_until < clock_timestamp())
      )
    order by j.priority, j.available_at, j.created_at
    for update skip locked
    limit job_limit
  )
  update public.jobs j
  set status = 'running',
      leased_by = worker_id,
      leased_until = clock_timestamp() + make_interval(secs => lease_seconds),
      attempts = j.attempts + 1,
      updated_at = clock_timestamp()
  from eligible
  where j.id = eligible.id
  returning j.*;
end;
$$;

create function public.heartbeat_job(
  job_id uuid,
  worker_id text,
  job_lease_epoch integer,
  lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if job_lease_epoch < 1 then
    raise exception 'job_lease_epoch must be positive';
  end if;
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;
  update public.jobs j
  set leased_until = clock_timestamp() + make_interval(secs => lease_seconds),
      updated_at = clock_timestamp()
  where j.id = heartbeat_job.job_id
    and j.status = 'running'
    and j.leased_by = heartbeat_job.worker_id
    and j.attempts = heartbeat_job.job_lease_epoch
    and j.leased_until > clock_timestamp();
  return found;
end;
$$;

create function public.checkpoint_job(
  job_id uuid,
  worker_id text,
  job_lease_epoch integer,
  checkpoint jsonb,
  lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if job_lease_epoch < 1 then
    raise exception 'job_lease_epoch must be positive';
  end if;
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;
  update public.jobs j
  set checkpoint = coalesce(checkpoint_job.checkpoint, '{}'::jsonb),
      leased_until = clock_timestamp() + make_interval(secs => lease_seconds),
      updated_at = clock_timestamp()
  where j.id = checkpoint_job.job_id
    and j.status = 'running'
    and j.leased_by = checkpoint_job.worker_id
    and j.attempts = checkpoint_job.job_lease_epoch
    and j.leased_until > clock_timestamp();
  return found;
end;
$$;

create function public.complete_job(
  job_id uuid,
  worker_id text,
  job_lease_epoch integer,
  checkpoint jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs j
  set status = 'completed',
      checkpoint = coalesce(complete_job.checkpoint, '{}'::jsonb),
      leased_until = null,
      leased_by = null,
      last_error = null,
      updated_at = clock_timestamp()
  where j.id = complete_job.job_id
    and j.status = 'running'
    and j.leased_by = complete_job.worker_id
    and j.attempts = complete_job.job_lease_epoch
    and j.leased_until > clock_timestamp();
  return found;
end;
$$;

create function public.fail_job(
  job_id uuid,
  worker_id text,
  job_lease_epoch integer,
  error_text text,
  retry_at timestamptz,
  checkpoint jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs j
  set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
      available_at = case
        when j.attempts >= j.max_attempts then j.available_at
        else coalesce(fail_job.retry_at, clock_timestamp())
      end,
      leased_until = null,
      leased_by = null,
      last_error = left(coalesce(fail_job.error_text, 'Unknown worker error'), 8000),
      checkpoint = coalesce(fail_job.checkpoint, j.checkpoint),
      updated_at = clock_timestamp()
  where j.id = fail_job.job_id
    and j.status = 'running'
    and j.leased_by = fail_job.worker_id
    and j.attempts = fail_job.job_lease_epoch
    and j.leased_until > clock_timestamp();
  return found;
end;
$$;

drop function if exists public.claim_ai_analysis(text, text, text, integer, text, text, text, text, jsonb);
drop function if exists public.renew_ai_analysis_lease(uuid, text, integer);
drop function if exists public.complete_ai_analysis(uuid, text, jsonb, jsonb, text, timestamptz);
drop function if exists public.fail_ai_analysis(uuid, text, text, timestamptz);
drop function if exists public.record_failed_ai_usage(uuid, text, jsonb);

create function public.claim_ai_analysis(
  analysis_role text,
  analysis_input_hash text,
  worker_id text,
  lease_seconds integer,
  provider_id text,
  model_id text,
  analysis_locale text,
  prompt_version text,
  input_payload jsonb
)
returns table (
  analysis_id uuid,
  claim_status text,
  output jsonb,
  usage jsonb,
  analysis_lease_epoch integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  current_row public.ai_analyses%rowtype;
  next_epoch integer;
begin
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id must not be empty';
  end if;
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;

  insert into public.ai_analyses (
    provider_id, model_id, role, locale, entity_type, entity_id,
    input_hash, input_payload, output, usage, cost_class, prompt_version,
    status, started_at, completed_at, available_at
  ) values (
    claim_ai_analysis.provider_id, claim_ai_analysis.model_id,
    analysis_role, analysis_locale, 'analysis_claim', gen_random_uuid(),
    analysis_input_hash, coalesce(input_payload, '{}'::jsonb), null, '{}'::jsonb,
    'subscription', prompt_version, 'pending', clock_timestamp(), null,
    clock_timestamp()
  ) on conflict (role, input_hash) do nothing;

  select * into current_row
  from public.ai_analyses a
  where a.role = analysis_role and a.input_hash = analysis_input_hash
  for update;

  if current_row.status = 'completed' then
    return query select current_row.id, 'completed'::text,
      current_row.output, current_row.usage, null::integer;
    return;
  end if;
  if current_row.leased_until is not null
     and current_row.leased_until > clock_timestamp() then
    return query select current_row.id, 'busy'::text,
      null::jsonb, null::jsonb, null::integer;
    return;
  end if;
  if current_row.available_at > clock_timestamp() then
    return query select current_row.id, 'busy'::text,
      null::jsonb, null::jsonb, null::integer;
    return;
  end if;

  next_epoch := current_row.attempts + 1;
  update public.ai_analyses a
  set status = 'pending',
      provider_id = claim_ai_analysis.provider_id,
      model_id = claim_ai_analysis.model_id,
      locale = analysis_locale,
      input_payload = coalesce(claim_ai_analysis.input_payload, '{}'::jsonb),
      prompt_version = claim_ai_analysis.prompt_version,
      leased_by = worker_id,
      leased_until = clock_timestamp() + make_interval(secs => lease_seconds),
      attempts = next_epoch,
      last_error = null,
      started_at = clock_timestamp()
  where a.id = current_row.id;

  return query select current_row.id, 'claimed'::text,
    null::jsonb, null::jsonb, next_epoch;
end;
$$;

create function public.renew_ai_analysis_lease(
  analysis_id uuid,
  worker_id text,
  analysis_lease_epoch integer,
  lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;
  update public.ai_analyses a
  set leased_until = clock_timestamp() + make_interval(secs => lease_seconds)
  where a.id = renew_ai_analysis_lease.analysis_id
    and a.status = 'pending'
    and a.leased_by = renew_ai_analysis_lease.worker_id
    and a.attempts = renew_ai_analysis_lease.analysis_lease_epoch
    and a.leased_until > clock_timestamp();
  return found;
end;
$$;

create function public.complete_ai_analysis(
  analysis_id uuid,
  worker_id text,
  analysis_lease_epoch integer,
  analysis_output jsonb,
  analysis_usage jsonb,
  cost_class text,
  completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_analyses a
  set status = 'completed',
      output = complete_ai_analysis.analysis_output,
      usage = coalesce(complete_ai_analysis.analysis_usage, '{}'::jsonb),
      cost_class = complete_ai_analysis.cost_class,
      completed_at = coalesce(complete_ai_analysis.completed_at, clock_timestamp()),
      last_error = null
  where a.id = complete_ai_analysis.analysis_id
    and a.status = 'pending'
    and a.leased_by = complete_ai_analysis.worker_id
    and a.attempts = complete_ai_analysis.analysis_lease_epoch
    and a.leased_until > clock_timestamp();
  if found then
    insert into public.ai_usage (
      analysis_id, provider_id, model_id, role, input_hash,
      usage, cost_class, started_at, completed_at
    )
    select a.id, a.provider_id, a.model_id, a.role, a.input_hash,
      a.usage, a.cost_class, a.started_at, a.completed_at
    from public.ai_analyses a where a.id = complete_ai_analysis.analysis_id
    on conflict on constraint ai_usage_analysis_id_key do nothing;
    return true;
  end if;
  return false;
end;
$$;

create function public.fail_ai_analysis(
  analysis_id uuid,
  worker_id text,
  analysis_lease_epoch integer,
  error_code text,
  retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_analyses a
  set status = 'failed',
      last_error = left(fail_ai_analysis.error_code, 200),
      available_at = fail_ai_analysis.retry_at,
      leased_by = null,
      leased_until = null
  where a.id = fail_ai_analysis.analysis_id
    and a.status = 'pending'
    and a.leased_by = fail_ai_analysis.worker_id
    and a.attempts = fail_ai_analysis.analysis_lease_epoch
    and a.leased_until > clock_timestamp();
  return found;
end;
$$;

create function public.record_failed_ai_usage(
  analysis_id uuid,
  worker_id text,
  analysis_lease_epoch integer,
  analysis_usage jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_usage (
    analysis_id, provider_id, model_id, role, input_hash,
    usage, cost_class, started_at, completed_at
  )
  select a.id, a.provider_id, a.model_id, a.role, a.input_hash,
    coalesce(record_failed_ai_usage.analysis_usage, '{}'::jsonb),
    a.cost_class, a.started_at, clock_timestamp()
  from public.ai_analyses a
  where a.id = record_failed_ai_usage.analysis_id
    and a.status = 'pending'
    and a.leased_by = record_failed_ai_usage.worker_id
    and a.attempts = record_failed_ai_usage.analysis_lease_epoch
    and a.leased_until > clock_timestamp()
  on conflict on constraint ai_usage_analysis_id_key do nothing;
  return found;
end;
$$;

alter table public.ai_analyses
  add column winning_attempt_id uuid,
  add column output_sha256 text,
  add constraint ai_analyses_attempt_finalization_check check (
    (winning_attempt_id is null and output_sha256 is null)
    or (winning_attempt_id is not null and output_sha256 ~ '^[a-f0-9]{64}$')
  );

create or replace function public.protect_ai_analysis_pending_winner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'ara_provider_authority' then
    return new;
  end if;
  if new.pending_winner_attempt_id is distinct from old.pending_winner_attempt_id
     or new.pending_output is distinct from old.pending_output
     or new.pending_usage is distinct from old.pending_usage then
    raise exception 'ai_analysis_pending_winner_protected';
  end if;
  return new;
end;
$$;

create function public.protect_ai_analysis_attempt_finalization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'ara_provider_authority' then
    return new;
  end if;
  if new.winning_attempt_id is distinct from old.winning_attempt_id
     or new.output_sha256 is distinct from old.output_sha256 then
    raise exception 'ai_analysis_attempt_finalization_protected';
  end if;
  return new;
end;
$$;

create trigger ai_analyses_attempt_finalization_protected
before update of winning_attempt_id, output_sha256 on public.ai_analyses
for each row execute function public.protect_ai_analysis_attempt_finalization();

create function public.assert_normalization_output(value jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  key_count integer;
begin
  if jsonb_typeof(value) <> 'object' then
    raise exception 'normalization_output_invalid';
  end if;
  select count(*) into key_count from jsonb_object_keys(value);
  if key_count <> 9
     or not value ?& array[
       'classification', 'canonicalNiche', 'canonicalEnglish', 'catalogPhrases',
       'aliases', 'productFit', 'riskFlags', 'confidence', 'reason'
     ]
     or jsonb_typeof(value->'classification') is distinct from 'string'
     or value->>'classification' not in (
       'product_niche', 'brand_ip', 'broad_query',
       'typo_variant', 'irrelevant', 'ambiguous'
     )
     or jsonb_typeof(value->'productFit') is distinct from 'string'
     or value->>'productFit' not in ('strong', 'possible', 'poor')
     or jsonb_typeof(value->'catalogPhrases') is distinct from 'array'
     or jsonb_array_length(value->'catalogPhrases') > 8
     or exists (
       select 1 from jsonb_array_elements(value->'catalogPhrases') item
       where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
     )
     or jsonb_typeof(value->'aliases') is distinct from 'array'
     or jsonb_array_length(value->'aliases') > 20
     or exists (
       select 1 from jsonb_array_elements(value->'aliases') item
       where jsonb_typeof(item) <> 'string' or btrim(item #>> '{}') = ''
     )
     or jsonb_typeof(value->'riskFlags') is distinct from 'array'
     or exists (
       select 1 from jsonb_array_elements(value->'riskFlags') item
       where jsonb_typeof(item) is distinct from 'string'
          or item #>> '{}' not in (
            'food_contact', 'electric', 'battery', 'fragile', 'liquid',
            'heavy', 'ip', 'seasonal', 'certification'
          )
     )
     or jsonb_typeof(value->'confidence') is distinct from 'number'
     or (value->>'confidence')::numeric < 0
     or (value->>'confidence')::numeric > 1
     or jsonb_typeof(value->'reason') is distinct from 'string'
     or btrim(value->>'reason') = ''
     or length(btrim(value->>'reason')) > 800
     or jsonb_typeof(value->'canonicalNiche') not in ('null', 'string')
     or (
       jsonb_typeof(value->'canonicalNiche') = 'string'
       and btrim(value->>'canonicalNiche') = ''
     )
     or jsonb_typeof(value->'canonicalEnglish') not in ('null', 'string')
     or (
       jsonb_typeof(value->'canonicalEnglish') = 'string'
       and btrim(value->>'canonicalEnglish') = ''
     ) then
    raise exception 'normalization_output_invalid';
  end if;
end;
$$;

create function public.assert_ai_usage(value jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  key_count integer;
  key text;
  token_value numeric;
begin
  if jsonb_typeof(value) <> 'object' then
    raise exception 'ai_usage_invalid';
  end if;
  select count(*) into key_count from jsonb_object_keys(value);
  if key_count <> 4
     or not value ?& array['inputTokens', 'outputTokens', 'totalTokens', 'requestCount']
     or jsonb_typeof(value->'requestCount') <> 'number'
     or (value->>'requestCount')::numeric < 1
     or (value->>'requestCount')::numeric <> trunc((value->>'requestCount')::numeric) then
    raise exception 'ai_usage_invalid';
  end if;
  foreach key in array array['inputTokens', 'outputTokens', 'totalTokens'] loop
    if jsonb_typeof(value->key) = 'null' then
      continue;
    end if;
    if jsonb_typeof(value->key) <> 'number' then
      raise exception 'ai_usage_invalid';
    end if;
    token_value := (value->>key)::numeric;
    if token_value < 0 or token_value <> trunc(token_value) then
      raise exception 'ai_usage_invalid';
    end if;
  end loop;
end;
$$;

create function public.assert_current_job_lease(
  job_id uuid,
  lease_owner text,
  lease_epoch integer
)
returns public.jobs
language plpgsql
set search_path = public
as $$
declare
  result public.jobs%rowtype;
begin
  select * into result from public.jobs j where j.id = job_id for update;
  if result.id is null
     or result.status <> 'running'
     or result.leased_by is distinct from lease_owner
     or result.attempts is distinct from lease_epoch
     or result.leased_until is null
     or result.leased_until <= clock_timestamp() then
    raise exception 'job_lease_rejected';
  end if;
  return result;
end;
$$;

create function public.assert_current_analysis_lease(
  analysis_id uuid,
  lease_owner text,
  lease_epoch integer,
  allowed_status text
)
returns public.ai_analyses
language plpgsql
set search_path = public
as $$
declare
  result public.ai_analyses%rowtype;
begin
  select * into result from public.ai_analyses a where a.id = analysis_id for update;
  if result.id is null
     or result.status <> allowed_status
     or result.leased_by is distinct from lease_owner
     or result.attempts is distinct from lease_epoch
     or result.leased_until is null
     or result.leased_until <= clock_timestamp() then
    raise exception 'analysis_lease_rejected';
  end if;
  return result;
end;
$$;

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
  fallback_parent_attempt_id uuid default null
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
     or model_row.billing_type <> provider_row.billing_type
     or provider_row.billing_type = 'payg' then
    raise exception 'provider_attempt_provider_rejected';
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
    elsif parent_row.event_type <> 'attempt_failed'
       or parent_row.result_class not in (
         'auth_expired', 'capacity_exhausted', 'rate_limited',
         'transient_network', 'client_transient', 'timeout'
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

create function public.append_ai_provider_attempt_outcome(
  attempt_id uuid,
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer,
  event_type text,
  consumption_status text,
  result_class text,
  proof_category text default null,
  latency_ms integer default null,
  input_tokens bigint default null,
  output_tokens bigint default null,
  provider_request_count integer default null,
  safe_metadata jsonb default '{}'::jsonb,
  output jsonb default null,
  usage jsonb default null
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
  start_row public.provider_attempt_events%rowtype;
  existing_row public.provider_attempt_events%rowtype;
  finished timestamptz := clock_timestamp();
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  analysis_row := public.assert_current_analysis_lease(
    analysis_id, analysis_lease_owner, analysis_lease_epoch, 'pending'
  );
  select * into start_row from public.provider_attempt_events e
  where e.attempt_id = append_ai_provider_attempt_outcome.attempt_id
    and e.event_type = 'attempt_started' for update;
  if start_row.event_id is null
     or start_row.logical_analysis_id <> analysis_id
     or start_row.job_id <> job_id
     or start_row.job_lease_owner <> job_lease_owner
     or start_row.job_lease_epoch <> job_lease_epoch
     or start_row.analysis_lease_owner <> analysis_lease_owner
     or start_row.analysis_lease_epoch <> analysis_lease_epoch then
    raise exception 'provider_attempt_outcome_lease_rejected';
  end if;

  select * into existing_row from public.provider_attempt_events e
  where e.attempt_id = append_ai_provider_attempt_outcome.attempt_id
    and e.event_type <> 'attempt_started';
  if existing_row.event_id is not null then
    if existing_row.event_type is distinct from event_type
       or existing_row.consumption_status is distinct from consumption_status
       or existing_row.result_class is distinct from result_class
       or existing_row.proof_category is distinct from proof_category then
      raise exception 'provider_attempt_outcome_conflict';
    end if;
    return jsonb_build_object('event_type', existing_row.event_type);
  end if;

  if jsonb_typeof(coalesce(safe_metadata, '{}'::jsonb)) <> 'object'
     or coalesce(safe_metadata, '{}'::jsonb)::text ~* '"(prompt|raw_stdout|raw_stderr|auth|env|secret|subscription_usd|output)"[[:space:]]*:' then
    raise exception 'provider_attempt_metadata_rejected';
  end if;
  if not (
    (event_type = 'attempt_succeeded'
      and consumption_status = 'consumed' and result_class = 'success'
      and proof_category is null)
    or (event_type = 'attempt_failed'
      and proof_category is null
      and (
        (consumption_status = 'unknown' and result_class in (
          'auth_expired', 'credential_source_mismatch', 'binary_identity_mismatch',
          'profile_mismatch', 'containment_failure', 'capability_failure',
          'capacity_exhausted', 'rate_limited', 'transient_network',
          'client_transient', 'timeout', 'unsafe_unknown'
        ))
        or (consumption_status = 'consumed' and result_class in (
          'capacity_exhausted', 'rate_limited', 'transient_network',
          'client_transient', 'timeout', 'schema_invalid_output',
          'business_validation_failure'
        ))
      ))
    or (event_type = 'attempt_cancelled'
      and consumption_status = 'unknown'
      and result_class in (
        'cancelled_by_caller', 'cancelled_by_job_lease_loss',
        'cancelled_by_shutdown'
      ) and proof_category is null)
    or (event_type = 'attempt_not_consumed'
      and consumption_status = 'not_consumed'
      and result_class = 'pre_spawn_failure'
      and proof_category in (
        'spawn_rejected_before_child', 'sandbox_not_started',
        'profile_verification_failed_before_spawn',
        'semaphore_cancelled_before_authorization'
      ))
    or (event_type = 'attempt_unknown_after_crash'
      and consumption_status = 'unknown'
      and result_class = 'worker_process_loss'
      and proof_category is null)
  ) then
    raise exception 'provider_attempt_outcome_matrix_rejected';
  end if;
  if event_type = 'attempt_succeeded' then
    if consumption_status <> 'consumed' or result_class <> 'success'
       or proof_category is not null or output is null or usage is null then
      raise exception 'provider_attempt_success_invalid';
    end if;
    perform public.assert_normalization_output(output);
    perform public.assert_ai_usage(usage);
  elsif output is not null or usage is not null then
    raise exception 'provider_attempt_outcome_payload_rejected';
  end if;

  insert into public.provider_attempt_events (
    attempt_id, logical_analysis_id, attempt_sequence, event_type,
    provider_id, model_id, adapter, role, billing_type,
    settings_revision, auth_generation, execution_fingerprint, probe_generation,
    fallback_parent_attempt_id, request_count,
    job_id, job_lease_owner, job_lease_epoch,
    analysis_lease_owner, analysis_lease_epoch,
    consumption_status, result_class, proof_category, latency_ms,
    input_tokens, output_tokens, provider_request_count, safe_metadata,
    finished_at, detected_at
  ) values (
    start_row.attempt_id, start_row.logical_analysis_id,
    start_row.attempt_sequence, event_type,
    start_row.provider_id, start_row.model_id, start_row.adapter,
    start_row.role, start_row.billing_type, start_row.settings_revision,
    start_row.auth_generation, start_row.execution_fingerprint,
    start_row.probe_generation, start_row.fallback_parent_attempt_id,
    start_row.request_count, start_row.job_id, start_row.job_lease_owner,
    start_row.job_lease_epoch, start_row.analysis_lease_owner,
    start_row.analysis_lease_epoch, consumption_status, result_class,
    proof_category, latency_ms, input_tokens, output_tokens,
    provider_request_count, coalesce(safe_metadata, '{}'::jsonb),
    case when event_type = 'attempt_unknown_after_crash' then null else finished end,
    case when event_type = 'attempt_unknown_after_crash' then finished else null end
  );

  if event_type = 'attempt_succeeded' then
    if analysis_row.pending_winner_attempt_id is not null
       and analysis_row.pending_winner_attempt_id <> attempt_id then
      raise exception 'provider_attempt_winner_conflict';
    end if;
    update public.ai_analyses a
    set pending_winner_attempt_id = attempt_id,
        pending_output = output,
        pending_usage = usage
    where a.id = analysis_id;
  end if;
  return jsonb_build_object('event_type', event_type);
end;
$$;

create function public.finalize_ai_analysis_from_attempt(
  attempt_id uuid,
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_variable
declare
  job_row public.jobs%rowtype;
  analysis_row public.ai_analyses%rowtype;
  start_row public.provider_attempt_events%rowtype;
  outcome_row public.provider_attempt_events%rowtype;
  digest text;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  analysis_row := public.assert_current_analysis_lease(
    analysis_id, analysis_lease_owner, analysis_lease_epoch,
    case when exists (
      select 1 from public.ai_analyses a
      where a.id = analysis_id and a.status = 'completed'
    ) then 'completed' else 'pending' end
  );
  if analysis_row.status = 'completed' then
    if analysis_row.winning_attempt_id <> attempt_id then
      raise exception 'analysis_winner_conflict';
    end if;
    return jsonb_build_object(
      'status', analysis_row.status,
      'output_sha256', analysis_row.output_sha256
    );
  end if;

  select * into start_row from public.provider_attempt_events e
  where e.attempt_id = finalize_ai_analysis_from_attempt.attempt_id
    and e.event_type = 'attempt_started';
  select * into outcome_row from public.provider_attempt_events e
  where e.attempt_id = finalize_ai_analysis_from_attempt.attempt_id
    and e.event_type = 'attempt_succeeded';
  if start_row.event_id is null or outcome_row.event_id is null
     or start_row.logical_analysis_id <> analysis_id
     or analysis_row.pending_winner_attempt_id <> attempt_id
     or analysis_row.pending_output is null or analysis_row.pending_usage is null
     or start_row.provider_id <> outcome_row.provider_id
     or start_row.model_id <> outcome_row.model_id then
    raise exception 'analysis_attempt_finalization_rejected';
  end if;
  perform public.assert_normalization_output(analysis_row.pending_output);
  perform public.assert_ai_usage(analysis_row.pending_usage);
  digest := encode(extensions.digest(
    convert_to(analysis_row.pending_output::text, 'UTF8'), 'sha256'
  ), 'hex');

  update public.ai_analyses a
  set provider_id = start_row.provider_id,
      model_id = start_row.model_id,
      cost_class = start_row.billing_type,
      output = analysis_row.pending_output,
      usage = analysis_row.pending_usage,
      status = 'completed',
      completed_at = clock_timestamp(),
      last_error = null,
      winning_attempt_id = attempt_id,
      output_sha256 = digest,
      pending_winner_attempt_id = null,
      pending_output = null,
      pending_usage = null
  where a.id = analysis_id
  returning * into analysis_row;

  insert into public.ai_usage (
    analysis_id, provider_id, model_id, role, input_hash,
    usage, cost_class, started_at, completed_at
  ) values (
    analysis_row.id, analysis_row.provider_id, analysis_row.model_id,
    analysis_row.role, analysis_row.input_hash, analysis_row.usage,
    analysis_row.cost_class, analysis_row.started_at, analysis_row.completed_at
  ) on conflict on constraint ai_usage_analysis_id_key do nothing;

  return jsonb_build_object('status', analysis_row.status, 'output_sha256', digest);
end;
$$;

create table public.normalized_candidate_finalizations (
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  normalization_generation bigint not null check (normalization_generation >= 0),
  analysis_id uuid not null references public.ai_analyses(id) on delete restrict,
  winning_attempt_id uuid not null,
  finalized_output_sha256 text not null check (finalized_output_sha256 ~ '^[a-f0-9]{64}$'),
  target_state text not null check (target_state in ('Reject', 'Needs Review', 'Ready for API Validation')),
  decision_id uuid not null references public.decision_history(id) on delete restrict,
  niche_cluster_id uuid references public.niche_clusters(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (candidate_id, normalization_generation),
  unique (analysis_id, winning_attempt_id)
);

create function public.reject_normalized_candidate_finalization_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'normalized_candidate_finalizations_immutable';
end;
$$;

create trigger normalized_candidate_finalizations_immutable
before update or delete on public.normalized_candidate_finalizations
for each row execute function public.reject_normalized_candidate_finalization_change();

alter table public.normalized_candidate_finalizations enable row level security;
revoke all on public.normalized_candidate_finalizations from public, anon, authenticated;
revoke all on public.normalized_candidate_finalizations from service_role;
grant select on public.normalized_candidate_finalizations to service_role;

create function public.append_candidate_reason(
  existing jsonb,
  reason_code text,
  reason_detail text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  result jsonb := '[]'::jsonb;
  seen text[] := array[]::text[];
  item jsonb;
  item_code text;
begin
  if jsonb_typeof(existing) = 'array' then
    for item in select value from jsonb_array_elements(existing) loop
      if jsonb_typeof(item) = 'object'
         and jsonb_typeof(item->'code') = 'string'
         and jsonb_typeof(item->'detail') = 'string' then
        item_code := item->>'code';
        if not item_code = any(seen) then
          result := result || jsonb_build_array(jsonb_build_object(
            'code', item_code, 'detail', item->>'detail'
          ));
          seen := array_append(seen, item_code);
        end if;
      end if;
    end loop;
  end if;
  if not reason_code = any(seen) then
    result := result || jsonb_build_array(jsonb_build_object(
      'code', reason_code, 'detail', reason_detail
    ));
  end if;
  return result;
end;
$$;

create function public.assert_normalization_job_payload(
  payload jsonb,
  candidate_id uuid,
  normalization_generation bigint
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if jsonb_typeof(payload) <> 'object'
     or jsonb_typeof(payload->'candidateIds') <> 'array'
     or jsonb_array_length(payload->'candidateIds') <> 1
     or payload->'candidateIds'->>0 is distinct from candidate_id::text
     or coalesce((payload->>'normalizationGeneration')::bigint, 0)
        is distinct from normalization_generation then
    raise exception 'normalization_job_payload_rejected';
  end if;
end;
$$;

create function public.finalize_normalized_candidate(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer,
  candidate_id uuid,
  expected_candidate_state text,
  expected_normalization_generation bigint
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
  candidate_row public.candidates%rowtype;
  ledger_row public.normalized_candidate_finalizations%rowtype;
  start_row public.provider_attempt_events%rowtype;
  classification text;
  target_state text;
  reasons jsonb;
  cluster_id uuid;
  decision_id uuid := gen_random_uuid();
  decision_key text;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  analysis_row := public.assert_current_analysis_lease(
    analysis_id, analysis_lease_owner, analysis_lease_epoch, 'completed'
  );
  perform public.assert_normalization_job_payload(
    job_row.payload, candidate_id, expected_normalization_generation
  );
  if jsonb_typeof(analysis_row.input_payload) <> 'object'
     or analysis_row.input_payload->>'candidateId' is distinct from candidate_id::text
     or coalesce((analysis_row.input_payload->>'normalizationGeneration')::bigint, 0)
        is distinct from expected_normalization_generation then
    raise exception 'normalization_logical_execution_rejected';
  end if;
  select * into candidate_row from public.candidates c
  where c.id = candidate_id for update;
  if candidate_row.id is null then
    raise exception 'normalization_candidate_not_found';
  end if;

  select * into ledger_row from public.normalized_candidate_finalizations f
  where f.candidate_id = finalize_normalized_candidate.candidate_id
    and f.normalization_generation = expected_normalization_generation;
  if ledger_row.candidate_id is not null then
    if ledger_row.analysis_id <> analysis_id
       or ledger_row.winning_attempt_id <> analysis_row.winning_attempt_id
       or ledger_row.finalized_output_sha256 <> analysis_row.output_sha256 then
      raise exception 'normalization_finalization_conflict';
    end if;
    return jsonb_build_object(
      'kind', 'already_committed', 'target_state', ledger_row.target_state,
      'decision_id', ledger_row.decision_id,
      'niche_cluster_id', ledger_row.niche_cluster_id
    );
  end if;

  if candidate_row.state <> expected_candidate_state
     or candidate_row.normalization_generation <> expected_normalization_generation
     or not candidate_row.eligible_for_ai_normalization
     or analysis_row.winning_attempt_id is null
     or analysis_row.output_sha256 is null
     or analysis_row.output is null
     or analysis_row.output_sha256 <> encode(extensions.digest(
       convert_to(analysis_row.output::text, 'UTF8'), 'sha256'
     ), 'hex') then
    raise exception 'normalization_finalization_rejected';
  end if;
  select * into start_row from public.provider_attempt_events e
  where e.attempt_id = analysis_row.winning_attempt_id
    and e.event_type = 'attempt_started';
  if start_row.event_id is null
     or start_row.logical_analysis_id <> analysis_id
     or start_row.job_id <> job_id
     or not exists (
       select 1 from public.provider_attempt_events e
       where e.attempt_id = analysis_row.winning_attempt_id
         and e.event_type = 'attempt_succeeded'
     ) then
    raise exception 'normalization_winner_rejected';
  end if;
  perform public.assert_normalization_output(analysis_row.output);
  classification := analysis_row.output->>'classification';
  target_state := case
    when classification in ('brand_ip', 'broad_query', 'irrelevant') then 'Reject'
    when classification = 'ambiguous'
      or (analysis_row.output->>'confidence')::numeric < 0.7
      or jsonb_typeof(analysis_row.output->'canonicalNiche') = 'null'
      then 'Needs Review'
    else 'Ready for API Validation'
  end;
  reasons := public.append_candidate_reason(
    candidate_row.rule_reasons,
    'AI_' || upper(classification),
    analysis_row.output->>'reason'
  );

  if target_state = 'Ready for API Validation' then
    if candidate_row.representative_raw_keyword_id is null then
      raise exception 'normalization_representative_keyword_required';
    end if;
    cluster_id := public.upsert_niche_cluster(
      public.canonical_niche_key(analysis_row.output->>'canonicalNiche'),
      analysis_row.output->>'canonicalNiche',
      analysis_row.output->>'canonicalEnglish',
      analysis_row.output->'aliases',
      analysis_row.output->'catalogPhrases',
      'Ready for API Validation'
    );
    insert into public.niche_cluster_keywords (
      niche_cluster_id, raw_opportunity_keyword_id
    ) values (cluster_id, candidate_row.representative_raw_keyword_id)
    on conflict do nothing;
  end if;

  insert into public.ai_analysis_entities (analysis_id, entity_type, entity_id)
  values (analysis_id, 'candidate', candidate_id)
  on conflict do nothing;

  decision_key := format(
    'ai-normalization:%s:%s:%s', candidate_id, analysis_id, target_state
  );
  insert into public.decision_history (
    id, candidate_id, from_state, to_state, reasons, decided_by, idempotency_key
  ) values (
    decision_id, candidate_id, candidate_row.state, target_state, reasons,
    analysis_row.prompt_version, decision_key
  ) on conflict (idempotency_key) do nothing
  returning id into decision_id;
  if decision_id is null then
    select d.id into decision_id from public.decision_history d
    where d.idempotency_key = decision_key;
  end if;

  update public.candidates c
  set state = target_state,
      niche_cluster_id = cluster_id,
      rule_reasons = reasons
  where c.id = candidate_id
    and c.state = expected_candidate_state
    and c.normalization_generation = expected_normalization_generation;
  if not found then
    raise exception 'normalization_candidate_cas_conflict';
  end if;

  insert into public.normalized_candidate_finalizations (
    candidate_id, normalization_generation, analysis_id, winning_attempt_id,
    finalized_output_sha256, target_state, decision_id, niche_cluster_id
  ) values (
    candidate_id, expected_normalization_generation, analysis_id,
    analysis_row.winning_attempt_id, analysis_row.output_sha256,
    target_state, decision_id, cluster_id
  );
  return jsonb_build_object(
    'kind', 'committed', 'target_state', target_state,
    'decision_id', decision_id, 'niche_cluster_id', cluster_id
  );
end;
$$;

create function public.claim_completed_ai_analysis_finalization(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  new_analysis_lease_owner text,
  lease_seconds integer,
  candidate_id uuid,
  expected_candidate_state text,
  expected_normalization_generation bigint
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
  candidate_row public.candidates%rowtype;
  ledger_row public.normalized_candidate_finalizations%rowtype;
  next_epoch integer;
begin
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  perform public.assert_normalization_job_payload(
    job_row.payload, candidate_id, expected_normalization_generation
  );
  select * into analysis_row from public.ai_analyses a
  where a.id = analysis_id for update;
  select * into candidate_row from public.candidates c
  where c.id = candidate_id for update;
  select * into ledger_row from public.normalized_candidate_finalizations f
  where f.candidate_id = claim_completed_ai_analysis_finalization.candidate_id
    and f.normalization_generation = expected_normalization_generation;
  if ledger_row.candidate_id is not null then
    if analysis_row.id is null
       or ledger_row.analysis_id <> analysis_id
       or ledger_row.winning_attempt_id <> analysis_row.winning_attempt_id
       or ledger_row.finalized_output_sha256 <> analysis_row.output_sha256 then
      raise exception 'normalization_finalization_conflict';
    end if;
    return jsonb_build_object('kind', 'already_committed');
  end if;
  if analysis_row.id is null or analysis_row.status <> 'completed'
     or analysis_row.winning_attempt_id is null or analysis_row.output_sha256 is null
     or analysis_row.leased_until is null
     or analysis_row.leased_until >= clock_timestamp()
     or analysis_row.input_payload->>'candidateId' is distinct from candidate_id::text
     or coalesce((analysis_row.input_payload->>'normalizationGeneration')::bigint, 0)
        is distinct from expected_normalization_generation
     or candidate_row.id is null
     or candidate_row.state <> expected_candidate_state
     or candidate_row.normalization_generation <> expected_normalization_generation then
    raise exception 'completed_analysis_finalization_claim_rejected';
  end if;
  next_epoch := analysis_row.attempts + 1;
  update public.ai_analyses a
  set leased_by = new_analysis_lease_owner,
      leased_until = clock_timestamp() + make_interval(secs => lease_seconds),
      attempts = next_epoch
  where a.id = analysis_id;
  return jsonb_build_object(
    'kind', 'claimed', 'analysis_lease_epoch', next_epoch
  );
end;
$$;

create function public.defer_candidate_normalization(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  candidate_id uuid,
  expected_candidate_state text,
  expected_normalization_generation bigint
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
  candidate_row public.candidates%rowtype;
  reasons jsonb;
  decision_key text;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  perform public.assert_normalization_job_payload(
    job_row.payload, candidate_id, expected_normalization_generation
  );
  select * into analysis_row from public.ai_analyses a
  where a.id = analysis_id for update;
  select * into candidate_row from public.candidates c
  where c.id = candidate_id for update;
  if analysis_row.id is null
     or analysis_row.role <> 'niche_normalization'
     or analysis_row.input_payload->>'candidateId' is distinct from candidate_id::text
     or coalesce((analysis_row.input_payload->>'normalizationGeneration')::bigint, 0)
        is distinct from expected_normalization_generation then
    raise exception 'candidate_defer_rejected';
  end if;
  if candidate_row.state = 'Waiting for AI Capacity' then
    return jsonb_build_object('kind', 'already_deferred', 'target_state', candidate_row.state);
  end if;
  if candidate_row.id is null
     or candidate_row.state <> expected_candidate_state
     or candidate_row.normalization_generation <> expected_normalization_generation
     or exists (
       select 1 from public.normalized_candidate_finalizations f
       where f.candidate_id = defer_candidate_normalization.candidate_id
         and f.normalization_generation = expected_normalization_generation
     )
     or exists (
       select 1 from public.provider_attempt_events e
       where e.logical_analysis_id = analysis_id and e.event_type = 'attempt_succeeded'
     )
     or not exists (
       select 1 from public.provider_attempt_events e
       where e.logical_analysis_id = analysis_id and e.event_type <> 'attempt_started'
     )
     or exists (
       select 1 from public.provider_attempt_events s
       where s.logical_analysis_id = analysis_id and s.event_type = 'attempt_started'
         and not exists (
           select 1 from public.provider_attempt_events o
           where o.attempt_id = s.attempt_id and o.event_type <> 'attempt_started'
         )
     ) then
    raise exception 'candidate_defer_rejected';
  end if;
  reasons := public.append_candidate_reason(
    candidate_row.rule_reasons,
    'AI_PROVIDER_UNAVAILABLE',
    'The configured AI provider is unavailable; retry when capacity returns.'
  );
  decision_key := format(
    'ai-normalization-deferred:%s:%s', candidate_id, expected_normalization_generation
  );
  insert into public.decision_history (
    candidate_id, from_state, to_state, reasons, decided_by, idempotency_key
  ) values (
    candidate_id, candidate_row.state, 'Waiting for AI Capacity', reasons,
    'provider-exhaustion', decision_key
  ) on conflict (idempotency_key) do nothing;
  update public.candidates c
  set state = 'Waiting for AI Capacity', niche_cluster_id = null, rule_reasons = reasons
  where c.id = candidate_id
    and c.state = expected_candidate_state
    and c.normalization_generation = expected_normalization_generation;
  if not found then
    raise exception 'candidate_defer_cas_conflict';
  end if;
  return jsonb_build_object(
    'kind', 'deferred', 'target_state', 'Waiting for AI Capacity'
  );
end;
$$;

create table public.normalization_writer_capability (
  singleton boolean primary key default true check (singleton),
  mode text not null check (mode in ('legacy', 'canonical')),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.normalization_writer_capability (singleton, mode) values (true, 'legacy');

create function public.reject_normalization_writer_capability_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.normalization_writer_migration', true), '') = 'on' then
    return new;
  end if;
  raise exception 'normalization_writer_capability_immutable';
end;
$$;
create trigger normalization_writer_capability_immutable
before update or delete on public.normalization_writer_capability
for each row execute function public.reject_normalization_writer_capability_change();

alter table public.normalization_writer_capability enable row level security;
revoke all on public.normalization_writer_capability from public, anon, authenticated, service_role;

create function public.read_normalization_writer_capability()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_count integer;
  selected_mode text;
begin
  select count(*), min(mode) into row_count, selected_mode
  from public.normalization_writer_capability;
  if row_count <> 1 or selected_mode not in ('legacy', 'canonical') then
    raise exception 'normalization_writer_capability_invalid';
  end if;
  return selected_mode;
end;
$$;

create function public.enqueue_initial_candidate_normalization(
  candidate_id uuid,
  locale text,
  writer_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  capability_mode text;
  candidate_row public.candidates%rowtype;
  job_row public.jobs%rowtype;
  job_key text;
  job_payload jsonb;
begin
  perform pg_advisory_xact_lock_shared(7241304022);
  select mode into capability_mode
  from public.normalization_writer_capability for update;
  if capability_mode is null or capability_mode not in ('legacy', 'canonical')
     or writer_mode is null or writer_mode <> capability_mode then
    raise exception 'normalization_writer_mode_rejected';
  end if;
  if locale not in ('ko', 'en') then
    raise exception 'normalization_locale_rejected';
  end if;
  select * into candidate_row from public.candidates c
  where c.id = candidate_id for update;
  if candidate_row.id is null or candidate_row.state <> 'AI Screening'
     or not candidate_row.eligible_for_ai_normalization then
    raise exception 'initial_normalization_candidate_rejected';
  end if;
  if writer_mode = 'legacy' then
    if candidate_row.normalization_generation <> 0 then
      raise exception 'legacy_normalization_generation_rejected';
    end if;
    job_key := format('normalize:%s', candidate_id);
    job_payload := jsonb_build_object(
      'candidateIds', jsonb_build_array(candidate_id), 'locale', locale
    );
  else
    job_key := format(
      'normalize:%s:%s', candidate_id, candidate_row.normalization_generation
    );
    job_payload := jsonb_build_object(
      'candidateIds', jsonb_build_array(candidate_id), 'locale', locale,
      'normalizationGeneration', candidate_row.normalization_generation
    );
  end if;
  insert into public.jobs (type, payload, status, idempotency_key)
  values ('NORMALIZE_OPPORTUNITIES', job_payload, 'queued', job_key)
  on conflict (idempotency_key) do nothing
  returning * into job_row;
  if job_row.id is null then
    select * into job_row from public.jobs j where j.idempotency_key = job_key;
    if job_row.payload <> job_payload or job_row.type <> 'NORMALIZE_OPPORTUNITIES' then
      raise exception 'normalization_job_conflict';
    end if;
  end if;
  return jsonb_build_object(
    'job_id', job_row.id, 'idempotency_key', job_row.idempotency_key
  );
end;
$$;

create function public.reconcile_ai_provider_attempts(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  analysis_lease_owner text,
  analysis_lease_epoch integer
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
  attempted_provider_ids jsonb;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  analysis_row := public.assert_current_analysis_lease(
    analysis_id, analysis_lease_owner, analysis_lease_epoch, 'pending'
  );
  insert into public.provider_attempt_events (
    attempt_id, logical_analysis_id, attempt_sequence, event_type,
    provider_id, model_id, adapter, role, billing_type,
    settings_revision, auth_generation, execution_fingerprint, probe_generation,
    fallback_parent_attempt_id, request_count,
    job_id, job_lease_owner, job_lease_epoch,
    analysis_lease_owner, analysis_lease_epoch,
    consumption_status, result_class, safe_metadata, detected_at
  )
  select s.attempt_id, s.logical_analysis_id, s.attempt_sequence,
    'attempt_unknown_after_crash', s.provider_id, s.model_id, s.adapter,
    s.role, s.billing_type, s.settings_revision, s.auth_generation,
    s.execution_fingerprint, s.probe_generation, s.fallback_parent_attempt_id,
    s.request_count, s.job_id, s.job_lease_owner, s.job_lease_epoch,
    s.analysis_lease_owner, s.analysis_lease_epoch, 'unknown',
    'worker_process_loss', '{"reason":"worker_process_loss"}'::jsonb,
    clock_timestamp()
  from public.provider_attempt_events s
  where s.logical_analysis_id = reconcile_ai_provider_attempts.analysis_id
    and s.event_type = 'attempt_started'
    and not exists (
      select 1 from public.provider_attempt_events o
      where o.attempt_id = s.attempt_id and o.event_type <> 'attempt_started'
    )
  on conflict do nothing;

  if analysis_row.pending_winner_attempt_id is not null
     or analysis_row.winning_attempt_id is not null then
    return jsonb_build_object(
      'attempted_provider_ids', '[]'::jsonb,
      'pending_winner_attempt_id', analysis_row.pending_winner_attempt_id
    );
  end if;

  select coalesce(jsonb_agg(distinct s.provider_id), '[]'::jsonb)
  into attempted_provider_ids
  from public.provider_attempt_events s
  where s.logical_analysis_id = analysis_id
    and s.event_type = 'attempt_started'
    and not exists (
      select 1 from public.provider_attempt_events o
      where o.attempt_id = s.attempt_id and o.event_type = 'attempt_not_consumed'
    );
  return jsonb_build_object(
    'attempted_provider_ids', attempted_provider_ids,
    'pending_winner_attempt_id', analysis_row.pending_winner_attempt_id
  );
end;
$$;

revoke update on public.ai_analyses from service_role;
grant select, insert, delete on public.ai_analyses to service_role;
grant select, insert, update on public.ai_analysis_entities,
  public.niche_clusters, public.niche_cluster_keywords,
  public.candidates, public.decision_history,
  public.normalized_candidate_finalizations to ara_provider_authority;

alter function public.begin_ai_provider_attempt(uuid, text, integer, uuid, text, integer, text, text, integer, bigint, text, uuid) owner to ara_provider_authority;
alter function public.append_ai_provider_attempt_outcome(uuid, uuid, text, integer, uuid, text, integer, text, text, text, text, integer, bigint, bigint, integer, jsonb, jsonb, jsonb) owner to ara_provider_authority;
alter function public.finalize_ai_analysis_from_attempt(uuid, uuid, text, integer, uuid, text, integer) owner to ara_provider_authority;
alter function public.finalize_normalized_candidate(uuid, text, integer, uuid, text, integer, uuid, text, bigint) owner to ara_provider_authority;
alter function public.claim_completed_ai_analysis_finalization(uuid, text, integer, uuid, text, integer, uuid, text, bigint) owner to ara_provider_authority;
alter function public.defer_candidate_normalization(uuid, text, integer, uuid, uuid, text, bigint) owner to ara_provider_authority;
alter function public.reconcile_ai_provider_attempts(uuid, text, integer, uuid, text, integer) owner to ara_provider_authority;
alter function public.assert_normalization_output(jsonb) owner to ara_provider_authority;
alter function public.assert_ai_usage(jsonb) owner to ara_provider_authority;
alter function public.assert_current_job_lease(uuid, text, integer) owner to ara_provider_authority;
alter function public.assert_current_analysis_lease(uuid, text, integer, text) owner to ara_provider_authority;
alter function public.append_candidate_reason(jsonb, text, text) owner to ara_provider_authority;
alter function public.assert_normalization_job_payload(jsonb, uuid, bigint) owner to ara_provider_authority;
alter function public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text) owner to ara_provider_authority;

revoke all on function public.heartbeat_job(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.checkpoint_job(uuid, text, integer, jsonb, integer) from public, anon, authenticated;
revoke all on function public.complete_job(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, text, integer, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.claim_ai_analysis(text, text, text, integer, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.renew_ai_analysis_lease(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_ai_analysis(uuid, text, integer, jsonb, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_ai_analysis(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_failed_ai_usage(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.begin_ai_provider_attempt(uuid, text, integer, uuid, text, integer, text, text, integer, bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.append_ai_provider_attempt_outcome(uuid, uuid, text, integer, uuid, text, integer, text, text, text, text, integer, bigint, bigint, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_ai_analysis_from_attempt(uuid, uuid, text, integer, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finalize_normalized_candidate(uuid, text, integer, uuid, text, integer, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_completed_ai_analysis_finalization(uuid, text, integer, uuid, text, integer, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.defer_candidate_normalization(uuid, text, integer, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.read_normalization_writer_capability() from public, anon, authenticated;
revoke all on function public.enqueue_initial_candidate_normalization(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reconcile_ai_provider_attempts(uuid, text, integer, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.assert_normalization_output(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.assert_ai_usage(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.assert_current_job_lease(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.assert_current_analysis_lease(uuid, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.append_candidate_reason(jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.assert_normalization_job_payload(jsonb, uuid, bigint) from public, anon, authenticated, service_role;

grant execute on function public.heartbeat_job(uuid, text, integer, integer) to service_role;
grant execute on function public.checkpoint_job(uuid, text, integer, jsonb, integer) to service_role;
grant execute on function public.complete_job(uuid, text, integer, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, integer, text, timestamptz, jsonb) to service_role;
grant execute on function public.claim_ai_analysis(text, text, text, integer, text, text, text, text, jsonb) to service_role;
grant execute on function public.renew_ai_analysis_lease(uuid, text, integer, integer) to service_role;
grant execute on function public.complete_ai_analysis(uuid, text, integer, jsonb, jsonb, text, timestamptz) to service_role;
grant execute on function public.fail_ai_analysis(uuid, text, integer, text, timestamptz) to service_role;
grant execute on function public.record_failed_ai_usage(uuid, text, integer, jsonb) to service_role;
grant execute on function public.begin_ai_provider_attempt(uuid, text, integer, uuid, text, integer, text, text, integer, bigint, text, uuid) to service_role;
grant execute on function public.append_ai_provider_attempt_outcome(uuid, uuid, text, integer, uuid, text, integer, text, text, text, text, integer, bigint, bigint, integer, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.finalize_ai_analysis_from_attempt(uuid, uuid, text, integer, uuid, text, integer) to service_role;
grant execute on function public.finalize_normalized_candidate(uuid, text, integer, uuid, text, integer, uuid, text, bigint) to service_role;
grant execute on function public.claim_completed_ai_analysis_finalization(uuid, text, integer, uuid, text, integer, uuid, text, bigint) to service_role;
grant execute on function public.defer_candidate_normalization(uuid, text, integer, uuid, uuid, text, bigint) to service_role;
grant execute on function public.read_normalization_writer_capability() to service_role;
grant execute on function public.enqueue_initial_candidate_normalization(uuid, text, text) to service_role;
grant execute on function public.reconcile_ai_provider_attempts(uuid, text, integer, uuid, text, integer) to service_role;
revoke all on function public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text) from service_role;

revoke create on schema public from ara_provider_authority;
