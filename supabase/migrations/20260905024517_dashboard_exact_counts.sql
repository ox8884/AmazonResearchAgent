create function public.get_dashboard_counts(entity text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if entity = 'jobs' then
    return (
      select coalesce(jsonb_object_agg(counts.status, counts.total), '{}'::jsonb)
      from (select status, count(*) as total from public.jobs group by status) counts
    );
  elsif entity = 'candidates' then
    return (
      select coalesce(jsonb_object_agg(counts.state, counts.total), '{}'::jsonb)
      from (select state, count(*) as total from public.candidates group by state) counts
    );
  end if;
  raise exception 'Unsupported dashboard count entity' using errcode = '22023';
end;
$$;

revoke all on function public.get_dashboard_counts(text) from public, anon, authenticated;
grant execute on function public.get_dashboard_counts(text) to service_role;
