create function public.terminalize_expired_exhausted_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  terminalized_count integer;
begin
  with terminalized as (
    update public.jobs j
    set status = 'failed',
        leased_by = null,
        leased_until = null,
        last_error = 'queue_lease_expired_after_final_attempt',
        updated_at = clock_timestamp()
    where j.status = 'running'
      and j.attempts >= j.max_attempts
      and j.leased_until is not null
      and j.leased_until <= clock_timestamp()
    returning j.id, j.type, j.payload
  ), affected_runs as (
    update public.research_runs r
    set status = 'needs_attention',
        error_code = 'queue_lease_expired_after_final_attempt',
        error_message = 'The queue lease expired after the final attempt.',
        updated_at = clock_timestamp()
    from terminalized j
    where j.type = 'DAILY_RESEARCH'
      and r.id::text = j.payload ->> 'researchRunId'
      and r.status in ('queued', 'planning', 'fanout', 'running', 'waiting')
  )
  select count(*)::integer into terminalized_count from terminalized;

  return terminalized_count;
end;
$$;

create function public.enqueue_manual_research(
  logical_date date,
  research_mode text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_run_id uuid;
  created_run_id uuid;
  run_locale text;
begin
  if logical_date is null then
    raise exception 'logical_date is required';
  end if;
  if research_mode is null
     or research_mode not in ('normal', 'override-reserve') then
    raise exception 'research_mode is invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(format('manual:%s:%s', logical_date, research_mode), 0)
  );

  select r.id into active_run_id
  from public.research_runs r
  where r.source = 'manual'
    and r.logical_run_date = logical_date
    and r.mode = research_mode
    and r.status in ('queued', 'planning', 'fanout', 'running', 'waiting')
  order by r.created_at desc
  limit 1;
  if active_run_id is not null then
    return active_run_id;
  end if;

  select coalesce(
    (select s.locale from public.app_settings s where s.id),
    'ko'
  ) into run_locale;

  insert into public.research_runs (
    source, mode, logical_run_date, locale, timezone, idempotency_key
  ) values (
    'manual', research_mode, logical_date, run_locale, 'America/Chicago',
    'research-now:' || gen_random_uuid()::text
  ) returning id into created_run_id;

  insert into public.jobs (type, payload, status, idempotency_key)
  values (
    'DAILY_RESEARCH',
    jsonb_build_object(
      'researchRunId', created_run_id,
      'logicalRunDate', logical_date,
      'locale', run_locale
    ),
    'queued',
    'research-now:' || created_run_id::text
  );

  return created_run_id;
end;
$$;

revoke all on function public.terminalize_expired_exhausted_jobs() from public, anon, authenticated;
revoke all on function public.enqueue_manual_research(date, text) from public, anon, authenticated;
grant execute on function public.terminalize_expired_exhausted_jobs() to service_role;
grant execute on function public.enqueue_manual_research(date, text) to service_role;
