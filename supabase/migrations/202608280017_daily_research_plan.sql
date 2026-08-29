create or replace function public.publish_daily_research_plan(
  run_id uuid,
  plan_candidate_ids jsonb,
  plan_checkpoint jsonb,
  plan_started_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(plan_candidate_ids) is distinct from 'array' then
    raise exception 'selected_candidate_ids must be a JSON array';
  end if;
  if jsonb_typeof(plan_checkpoint) is distinct from 'object' then
    raise exception 'checkpoint must be a JSON object';
  end if;

  update public.research_runs as r
  set status = 'fanout',
      selected_candidate_ids = plan_candidate_ids,
      checkpoint = plan_checkpoint,
      started_at = coalesce(r.started_at, plan_started_at),
      updated_at = now()
  where r.id = run_id
    and r.status in ('queued', 'planning', 'fanout')
    and r.selected_candidate_ids = '[]'::jsonb
    and r.checkpoint = '{}'::jsonb;

  return found;
end;
$$;

revoke all on function public.publish_daily_research_plan(uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.publish_daily_research_plan(uuid, jsonb, jsonb, timestamptz)
  to service_role;
