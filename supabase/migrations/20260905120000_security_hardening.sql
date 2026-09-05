create or replace function public.consume_admin_login_attempt(
  client_identity_hash text,
  per_client_max_attempts integer,
  global_max_attempts integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  client_bucket text;
  client_row public.admin_login_guard%rowtype;
  client_window_expired boolean;
begin
  if client_identity_hash is null or client_identity_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if per_client_max_attempts is null or per_client_max_attempts < 1 or per_client_max_attempts > 1000 then
    return false;
  end if;
  if global_max_attempts is null or global_max_attempts < per_client_max_attempts or global_max_attempts > 10000 then
    return false;
  end if;
  if window_seconds is null or window_seconds < 1 or window_seconds > 3600 then
    return false;
  end if;

  client_bucket := 'admin-login:client:' || client_identity_hash;

  insert into public.admin_login_guard (bucket)
  values (client_bucket)
  on conflict (bucket) do nothing;

  select * into client_row
  from public.admin_login_guard
  where bucket = client_bucket
  for update;

  client_window_expired := client_row.window_started_at <= now() - make_interval(secs => window_seconds);
  if not client_window_expired and client_row.attempts >= per_client_max_attempts then
    return false;
  end if;

  update public.admin_login_guard
  set
    window_started_at = case when client_window_expired then now() else window_started_at end,
    attempts = case when client_window_expired then 1 else attempts + 1 end
  where bucket = client_bucket;

  return true;
end;
$$;

create or replace function public.consume_admin_action_attempt(
  action_name text,
  subject_hash text,
  max_attempts integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  action_bucket text;
  action_row public.admin_login_guard%rowtype;
  window_expired boolean;
begin
  if action_name is null or action_name !~ '^[a-z][a-z0-9_]{0,31}$' then
    return false;
  end if;
  if subject_hash is null or subject_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if max_attempts is null or max_attempts < 1 or max_attempts > 1000 then
    return false;
  end if;
  if window_seconds is null or window_seconds < 1 or window_seconds > 3600 then
    return false;
  end if;

  action_bucket := 'admin-action:' || action_name || ':' || subject_hash;

  insert into public.admin_login_guard (bucket)
  values (action_bucket)
  on conflict (bucket) do nothing;

  select * into action_row
  from public.admin_login_guard
  where bucket = action_bucket
  for update;

  window_expired := action_row.window_started_at <= now() - make_interval(secs => window_seconds);
  if not window_expired and action_row.attempts >= max_attempts then
    return false;
  end if;

  update public.admin_login_guard
  set
    window_started_at = case when window_expired then now() else window_started_at end,
    attempts = case when window_expired then 1 else attempts + 1 end
  where bucket = action_bucket;

  return true;
end;
$$;

revoke all on function public.consume_admin_action_attempt(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_admin_action_attempt(text, text, integer, integer)
  to service_role;

revoke all on public.import_runs from public;
revoke all on public.raw_opportunity_keywords from public;
revoke all on public.niche_clusters from public;
revoke all on public.niche_cluster_keywords from public;
revoke all on public.candidates from public;
revoke all on public.decision_history from public;
revoke all on public.score_history from public;
revoke all on public.audit_events from public;
revoke all on public.jobs from public;
revoke all on public.app_settings from public;
revoke all on public.research_runs from public;
revoke all on public.scheduled_run_locks from public;
revoke all on public.notifications from public;
