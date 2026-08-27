create or replace function public.renew_ai_analysis_lease(
  analysis_id uuid,
  worker_id text,
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

  update public.ai_analyses
  set leased_until = now() + make_interval(secs => $3)
  where id = $1
    and status = 'pending'
    and leased_by = $2
    and leased_until is not null
    and leased_until > now();

  return found;
end;
$$;

revoke all on function public.renew_ai_analysis_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.renew_ai_analysis_lease(uuid, text, integer) to service_role;
