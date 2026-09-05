create function public.consume_admin_login_attempt(
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
  global_row public.admin_login_guard%rowtype;
  global_window_expired boolean;
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

  insert into public.admin_login_guard (bucket)
  values ('admin-login:global')
  on conflict (bucket) do nothing;

  select * into global_row
  from public.admin_login_guard
  where bucket = 'admin-login:global'
  for update;

  global_window_expired := global_row.window_started_at <= now() - make_interval(secs => window_seconds);
  if not global_window_expired and global_row.attempts >= global_max_attempts then
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

  update public.admin_login_guard
  set
    window_started_at = case when global_window_expired then now() else window_started_at end,
    attempts = case when global_window_expired then 1 else attempts + 1 end
  where bucket = 'admin-login:global';

  return true;
end;
$$;

revoke all on function public.consume_admin_login_attempt(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_admin_login_attempt(text, integer, integer, integer)
  to service_role;
