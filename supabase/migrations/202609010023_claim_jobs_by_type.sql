create function public.claim_jobs_by_type(
  worker_id text,
  requested_type text,
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
  if requested_type is null or btrim(requested_type) = '' then
    raise exception 'requested_type must not be empty';
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
    where j.type = requested_type
      and j.attempts < j.max_attempts
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

revoke all on function public.claim_jobs_by_type(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_jobs_by_type(text, text, integer, integer)
  to service_role;
