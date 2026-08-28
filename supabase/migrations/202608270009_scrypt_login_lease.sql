alter table public.admin_login_guard
  add column if not exists scrypt_owner text;

alter table public.admin_login_guard
  add column if not exists scrypt_leased_until timestamptz;

drop function if exists public.acquire_admin_login_scrypt();
drop function if exists public.release_admin_login_scrypt();

create or replace function public.acquire_admin_login_scrypt(
  lock_owner text,
  lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if lock_owner is null or length(trim(lock_owner)) = 0 then
    return false;
  end if;
  if lease_seconds is null or lease_seconds < 1 or lease_seconds > 60 then
    return false;
  end if;

  insert into public.admin_login_guard (bucket)
  values ('admin-login')
  on conflict (bucket) do nothing;

  update public.admin_login_guard
  set
    scrypt_owner = trim(lock_owner),
    scrypt_leased_until = now() + make_interval(secs => lease_seconds),
    scrypt_inflight = true
  where bucket = 'admin-login'
    and (
      scrypt_inflight = false
      or scrypt_leased_until is null
      or scrypt_leased_until <= now()
    );

  return found;
end;
$$;

create or replace function public.release_admin_login_scrypt(lock_owner text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if lock_owner is null or length(trim(lock_owner)) = 0 then
    return false;
  end if;

  update public.admin_login_guard
  set
    scrypt_owner = null,
    scrypt_leased_until = null,
    scrypt_inflight = false
  where bucket = 'admin-login'
    and scrypt_owner = trim(lock_owner);

  return found;
end;
$$;

revoke all on function public.acquire_admin_login_scrypt(text, integer)
  from public, anon, authenticated;
revoke all on function public.release_admin_login_scrypt(text)
  from public, anon, authenticated;
grant execute on function public.acquire_admin_login_scrypt(text, integer)
  to service_role;
grant execute on function public.release_admin_login_scrypt(text)
  to service_role;
