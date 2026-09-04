create or replace function public.enqueue_initial_candidate_normalization(
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
    if job_row.type <> 'NORMALIZE_OPPORTUNITIES'
       or job_row.payload - 'promptVersion' <> job_payload
       or (
         job_row.payload ? 'promptVersion'
         and (
           jsonb_typeof(job_row.payload->'promptVersion') is distinct from 'string'
           or length(btrim(job_row.payload->>'promptVersion')) = 0
         )
       ) then
      raise exception 'normalization_job_conflict';
    end if;
  end if;
  return jsonb_build_object(
    'job_id', job_row.id, 'idempotency_key', job_row.idempotency_key
  );
end;
$$;
