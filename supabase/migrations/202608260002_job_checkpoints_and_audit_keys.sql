alter table public.decision_history
  add column idempotency_key text unique;

alter table public.score_history
  add column idempotency_key text unique;

alter table public.audit_events
  add column import_run_id uuid references public.import_runs(id) on delete cascade,
  add column idempotency_key text unique;
create index audit_events_import_run_idx
  on public.audit_events(import_run_id, created_at desc);

create or replace function public.checkpoint_job(
  job_id uuid,
  worker_id text,
  checkpoint jsonb,
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

  update public.jobs as j
  set checkpoint = coalesce($3, '{}'::jsonb),
      leased_until = now() + make_interval(secs => lease_seconds),
      updated_at = now()
  where j.id = $1
    and j.status = 'running'
    and j.leased_by = $2;

  return found;
end;
$$;

revoke all on function public.checkpoint_job(uuid, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.checkpoint_job(uuid, text, jsonb, integer)
  to service_role;
