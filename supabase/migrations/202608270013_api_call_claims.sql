create table if not exists public.api_call_claims (
  cache_key text primary key,
  owner text not null,
  claimed_until timestamptz not null,
  reserved boolean not null default false,
  budget_date date,
  completed_at timestamptz,
  staged_response jsonb
);

revoke all on table public.api_call_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.api_call_claims to service_role;

create or replace function public.claim_api_call(
  request_cache_key text,
  claim_owner text,
  lease_seconds integer
)
returns table (
  decision_kind text,
  claimed_cache_key text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.api_call_claims%rowtype;
  written public.api_call_claims%rowtype;
begin
  if request_cache_key is null or claim_owner is null or lease_seconds is null or lease_seconds < 1 then
    return query select 'blocked_policy'::text, request_cache_key;
    return;
  end if;

  if exists (
    select 1
    from public.api_cache as cached
    where cached.cache_key = request_cache_key
      and cached.expires_at > now()
  ) then
    return query select 'cache_hit'::text, request_cache_key;
    return;
  end if;

  select * into existing
  from public.api_call_claims as claims
  where claims.cache_key = request_cache_key
  for update;

  if existing.cache_key is not null
     and existing.completed_at is null
     and existing.claimed_until > now()
     and existing.owner is distinct from claim_owner then
    return query select 'in_flight'::text, request_cache_key;
    return;
  end if;

  insert into public.api_call_claims (
    cache_key, owner, claimed_until, reserved, budget_date, completed_at, staged_response
  )
  values (
    request_cache_key,
    claim_owner,
    now() + make_interval(secs => lease_seconds),
    coalesce(existing.reserved, false),
    existing.budget_date,
    null,
    existing.staged_response
  )
  on conflict on constraint api_call_claims_pkey do update
  set owner = excluded.owner,
      claimed_until = excluded.claimed_until,
      completed_at = null
  where public.api_call_claims.owner = claim_owner
     or public.api_call_claims.claimed_until <= now()
     or public.api_call_claims.completed_at is not null
  returning * into written;

  if written.cache_key is null then
    return query select 'in_flight'::text, request_cache_key;
    return;
  end if;

  return query select 'claimed'::text, request_cache_key;
end;
$$;

create or replace function public.complete_api_call_claim(
  request_cache_key text,
  claim_owner text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.api_call_claims as claims
  set completed_at = now(),
      claimed_until = now()
  where claims.cache_key = request_cache_key
    and claims.owner = claim_owner;
  return found;
end;
$$;

create or replace function public.mark_api_call_reserved(
  request_cache_key text,
  request_budget_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.api_call_claims as claims
  set reserved = true,
      budget_date = request_budget_date
  where claims.cache_key = request_cache_key;
  return found;
end;
$$;

create or replace function public.stage_api_call_response(
  request_cache_key text,
  claim_owner text,
  response jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.api_call_claims as claims
  set staged_response = response
  where claims.cache_key = request_cache_key
    and claims.owner = claim_owner
    and claims.completed_at is null;
  return found;
end;
$$;

revoke all on function public.claim_api_call(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_api_call(text, text, integer) to service_role;
revoke all on function public.complete_api_call_claim(text, text) from public, anon, authenticated;
grant execute on function public.complete_api_call_claim(text, text) to service_role;
revoke all on function public.mark_api_call_reserved(text, date) from public, anon, authenticated;
grant execute on function public.mark_api_call_reserved(text, date) to service_role;
revoke all on function public.stage_api_call_response(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.stage_api_call_response(text, text, jsonb) to service_role;
