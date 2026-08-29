create or replace function public.advance_daily_research_checkpoint(
  run_id uuid,
  next_status text,
  next_checkpoint jsonb,
  next_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current public.research_runs%rowtype;
  current_phase text;
  next_phase text;
  current_count integer;
  next_count integer;
begin
  if jsonb_typeof(next_checkpoint) is distinct from 'object' then
    raise exception 'checkpoint must be a JSON object';
  end if;

  select * into current
  from public.research_runs as runs
  where runs.id = run_id
  for update;
  if current.id is null then
    return false;
  end if;

  current_phase := current.checkpoint->>'phase';
  next_phase := next_checkpoint->>'phase';
  current_count := coalesce(
    jsonb_array_length(current.checkpoint->'enqueuedCandidateIds'),
    0
  );
  next_count := coalesce(
    jsonb_array_length(next_checkpoint->'enqueuedCandidateIds'),
    0
  );

  if current.status = 'completed' or current_phase = 'fanout_complete' then
    return next_status = 'completed'
      and next_phase = 'fanout_complete'
      and next_count >= current_count;
  end if;

  if next_count < current_count or next_status not in ('fanout', 'completed') then
    return false;
  end if;

  update public.research_runs as runs
  set status = next_status,
      checkpoint = next_checkpoint,
      completed_at = case
        when next_status = 'completed' then coalesce(runs.completed_at, next_completed_at)
        else runs.completed_at
      end,
      updated_at = now()
  where runs.id = run_id;

  return found;
end;
$$;

revoke all on function public.advance_daily_research_checkpoint(uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.advance_daily_research_checkpoint(uuid, text, jsonb, timestamptz)
  to service_role;
