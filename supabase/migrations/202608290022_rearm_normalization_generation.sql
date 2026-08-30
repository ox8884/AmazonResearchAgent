alter table public.normalization_writer_capability
  add column migration_identity text;

select pg_advisory_xact_lock(7241304022);

do $$
declare
  capability_count integer;
  capability_mode text;
  invalid_job_ids text;
begin
  select mode into capability_mode
  from public.normalization_writer_capability
  for update;
  select count(*) into capability_count
  from public.normalization_writer_capability;
  if capability_count <> 1 or capability_mode <> 'legacy' then
    raise exception 'normalization_cutover_capability_rejected';
  end if;

  perform 1
  from public.jobs j
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.idempotency_key like 'normalize:%'
  for update;

  perform 1
  from public.candidates c
  where exists (
    select 1 from public.jobs j
    where j.type = 'NORMALIZE_OPPORTUNITIES'
      and j.idempotency_key like 'normalize:' || c.id::text || '%'
  )
  for update;

  select string_agg(id::text, ',' order by id)
  into invalid_job_ids
  from public.jobs j
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.idempotency_key like 'normalize:%'
    and j.idempotency_key !~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[0-9]+)?$';
  if invalid_job_ids is not null then
    raise exception 'normalization_cutover_malformed:%', invalid_job_ids;
  end if;

  select string_agg(j.id::text, ',' order by j.id)
  into invalid_job_ids
  from public.jobs j
  left join public.candidates c
    on c.id::text = split_part(j.idempotency_key, ':', 2)
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      jsonb_typeof(j.payload) <> 'object'
      or jsonb_typeof(j.payload->'candidateIds') <> 'array'
      or jsonb_array_length(j.payload->'candidateIds') <> 1
      or j.payload->'candidateIds'->>0 is distinct from split_part(j.idempotency_key, ':', 2)
      or j.payload ? 'normalizationGeneration'
      or j.payload->>'locale' not in ('ko', 'en')
      or j.payload - array['candidateIds', 'locale', 'promptVersion'] <> '{}'::jsonb
      or (
        j.payload ? 'promptVersion'
        and (
          jsonb_typeof(j.payload->'promptVersion') is distinct from 'string'
          or length(btrim(j.payload->>'promptVersion')) = 0
        )
      )
      or c.id is null
      or c.normalization_generation <> 0
    );
  if invalid_job_ids is not null then
    raise exception 'normalization_cutover_legacy_payload_rejected:%', invalid_job_ids;
  end if;

  select string_agg(j.id::text, ',' order by j.id)
  into invalid_job_ids
  from public.jobs j
  left join public.candidates c
    on c.id::text = split_part(j.idempotency_key, ':', 2)
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$'
    and (
      jsonb_typeof(j.payload) <> 'object'
      or jsonb_typeof(j.payload->'candidateIds') <> 'array'
      or jsonb_array_length(j.payload->'candidateIds') <> 1
      or j.payload->'candidateIds'->>0 is distinct from split_part(j.idempotency_key, ':', 2)
      or jsonb_typeof(j.payload->'normalizationGeneration') <> 'number'
      or j.payload->>'normalizationGeneration' is distinct from split_part(j.idempotency_key, ':', 3)
      or split_part(j.idempotency_key, ':', 3) <> '0'
      or j.payload->>'normalizationGeneration' <> '0'
      or c.normalization_generation <> 0
      or j.payload->>'locale' not in ('ko', 'en')
      or j.payload - array[
        'candidateIds', 'locale', 'normalizationGeneration', 'promptVersion'
      ] <> '{}'::jsonb
      or (
        j.payload ? 'promptVersion'
        and (
          jsonb_typeof(j.payload->'promptVersion') is distinct from 'string'
          or length(btrim(j.payload->>'promptVersion')) = 0
        )
      )
      or c.id is null
    );
  if invalid_job_ids is not null then
    raise exception 'normalization_cutover_canonical_payload_rejected:%', invalid_job_ids;
  end if;

  select string_agg(legacy.id::text, ',' order by legacy.id)
  into invalid_job_ids
  from public.jobs legacy
  where legacy.type = 'NORMALIZE_OPPORTUNITIES'
    and legacy.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.jobs canonical
      where canonical.idempotency_key = legacy.idempotency_key || ':0'
    );
  if invalid_job_ids is not null then
    raise exception 'normalization_cutover_collision:%', invalid_job_ids;
  end if;

  update public.jobs j
  set idempotency_key = j.idempotency_key || ':0',
      payload = j.payload || jsonb_build_object('normalizationGeneration', 0)
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.idempotency_key ~ '^normalize:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  perform set_config('app.normalization_writer_migration', 'on', true);
  update public.normalization_writer_capability
  set mode = 'canonical',
      migration_identity = '202608290022',
      updated_at = clock_timestamp();
end;
$$;

drop function public.read_normalization_writer_capability();
create function public.read_normalization_writer_capability()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_count integer;
  selected_mode text;
  selected_migration_identity text;
begin
  select count(*), min(mode), min(migration_identity)
  into row_count, selected_mode, selected_migration_identity
  from public.normalization_writer_capability;
  if row_count <> 1
     or selected_mode <> 'canonical'
     or selected_migration_identity <> '202608290022' then
    raise exception 'normalization_writer_capability_invalid';
  end if;
  return jsonb_build_object(
    'mode', selected_mode,
    'migration_identity', selected_migration_identity
  );
end;
$$;
revoke all on function public.read_normalization_writer_capability()
  from public, anon, authenticated;
grant execute on function public.read_normalization_writer_capability()
  to service_role;

create function public.rearm_candidate_normalization(
  candidate_id uuid,
  expected_candidate_state text,
  expected_normalization_generation bigint,
  locale text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  candidate_row public.candidates%rowtype;
  existing_job public.jobs%rowtype;
  inserted_job public.jobs%rowtype;
  next_generation bigint;
  next_key text;
  next_payload jsonb;
  provider_available boolean;
begin
  if expected_candidate_state <> 'Waiting for AI Capacity'
     or expected_normalization_generation < 0
     or locale not in ('ko', 'en') then
    raise exception 'normalization_rearm_input_rejected';
  end if;

  select * into candidate_row
  from public.candidates c
  where c.id = candidate_id
  for update;
  if candidate_row.id is null then
    raise exception 'normalization_rearm_candidate_rejected';
  end if;

  next_generation := expected_normalization_generation + 1;
  next_key := format('normalize:%s:%s', candidate_id, next_generation);
  select * into existing_job
  from public.jobs j
  where j.idempotency_key = next_key
  for update;
  if candidate_row.state = expected_candidate_state
     and candidate_row.normalization_generation = next_generation
     and existing_job.id is not null then
    if existing_job.type <> 'NORMALIZE_OPPORTUNITIES'
       or existing_job.payload <> jsonb_build_object(
         'candidateIds', jsonb_build_array(candidate_id),
         'locale', locale,
         'normalizationGeneration', next_generation
       ) then
      raise exception 'normalization_rearm_job_conflict';
    end if;
    return jsonb_build_object(
      'job_id', existing_job.id,
      'idempotency_key', existing_job.idempotency_key,
      'normalization_generation', next_generation
    );
  end if;

  if candidate_row.state <> expected_candidate_state
     or candidate_row.normalization_generation <> expected_normalization_generation
     or not candidate_row.eligible_for_ai_normalization then
    raise exception 'normalization_rearm_candidate_rejected';
  end if;

  perform 1
  from public.jobs j
  where j.type = 'NORMALIZE_OPPORTUNITIES'
    and j.status in ('queued', 'running')
    and jsonb_typeof(j.payload->'candidateIds') = 'array'
    and jsonb_array_length(j.payload->'candidateIds') = 1
    and j.payload->'candidateIds'->>0 = candidate_id::text
    and coalesce((j.payload->>'normalizationGeneration')::bigint, 0)
      = expected_normalization_generation
  for update;
  if found then
    raise exception 'normalization_rearm_active_job';
  end if;

  perform 1
  from public.ai_analyses a
  where a.role = 'niche_normalization'
    and a.input_payload->>'candidateId' = candidate_id::text
    and coalesce((a.input_payload->>'normalizationGeneration')::bigint, 0)
      = expected_normalization_generation
  for update;
  if exists (
    select 1 from public.ai_analyses a
    where a.role = 'niche_normalization'
      and a.input_payload->>'candidateId' = candidate_id::text
      and coalesce((a.input_payload->>'normalizationGeneration')::bigint, 0)
        = expected_normalization_generation
      and a.status = 'pending'
      and a.leased_until is not null
      and a.leased_until > clock_timestamp()
  ) then
    raise exception 'normalization_rearm_active_analysis';
  end if;

  perform 1 from public.ai_provider_runtime_state r for update;
  select exists (
    select 1
    from public.ai_providers p
    join public.ai_models m on m.provider_id = p.id
    join public.ai_provider_runtime_state r on r.provider_id = p.id
    where p.billing_type <> 'payg'
      and m.billing_type <> 'payg'
      and public.is_ai_provider_routable(
        p.id, m.model_id, p.settings_revision,
        r.auth_generation, r.execution_fingerprint
      )
  ) into provider_available;
  if not provider_available then
    raise exception 'normalization_rearm_provider_unavailable';
  end if;

  next_payload := jsonb_build_object(
    'candidateIds', jsonb_build_array(candidate_id),
    'locale', locale,
    'normalizationGeneration', next_generation
  );
  insert into public.jobs (type, payload, status, idempotency_key)
  values ('NORMALIZE_OPPORTUNITIES', next_payload, 'queued', next_key)
  returning * into inserted_job;

  update public.candidates c
  set normalization_generation = next_generation
  where c.id = candidate_id
    and c.state = expected_candidate_state
    and c.normalization_generation = expected_normalization_generation;
  if not found then
    raise exception 'normalization_rearm_candidate_cas_conflict';
  end if;

  return jsonb_build_object(
    'job_id', inserted_job.id,
    'idempotency_key', inserted_job.idempotency_key,
    'normalization_generation', next_generation
  );
end;
$$;
grant create on schema public to ara_provider_authority;

alter function public.rearm_candidate_normalization(uuid, text, bigint, text)
  owner to ara_provider_authority;
revoke create on schema public from ara_provider_authority;
revoke all on function public.rearm_candidate_normalization(uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.rearm_candidate_normalization(uuid, text, bigint, text)
  to service_role;
