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
  new_generation boolean;
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

  new_generation := existing.cache_key is null or existing.completed_at is not null;

  insert into public.api_call_claims (
    cache_key, owner, claimed_until, reserved, budget_date, completed_at, staged_response
  )
  values (
    request_cache_key,
    claim_owner,
    now() + make_interval(secs => lease_seconds),
    case when new_generation then false else coalesce(existing.reserved, false) end,
    case when new_generation then null else existing.budget_date end,
    null,
    case when new_generation then null else existing.staged_response end
  )
  on conflict on constraint api_call_claims_pkey do update
  set owner = excluded.owner,
      claimed_until = excluded.claimed_until,
      completed_at = null,
      reserved = excluded.reserved,
      budget_date = excluded.budget_date,
      staged_response = excluded.staged_response
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

create or replace function public.authorize_owned_api_call(
  request_cache_key text,
  claim_owner text,
  purpose text,
  estimated_calls integer,
  endpoint text,
  daily_limit integer,
  reserved_limit integer,
  request_budget_date date default (timezone('America/Chicago', now()))::date
)
returns table (
  decision_kind text,
  cache_key text,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim public.api_call_claims%rowtype;
  kind text;
  result_cache text;
  result_remaining integer;
begin
  select * into claim
  from public.api_call_claims as claims
  where claims.cache_key = request_cache_key
  for update;

  if claim.cache_key is null
     or claim.owner is distinct from claim_owner
     or claim.completed_at is not null
     or claim.claimed_until <= now() then
    return query select 'blocked_policy'::text, request_cache_key, null::integer;
    return;
  end if;

  if claim.reserved then
    return query select 'authorized'::text, request_cache_key, null::integer;
    return;
  end if;

  select result.decision_kind, result.cache_key, result.remaining
  into kind, result_cache, result_remaining
  from public.authorize_api_call(
    purpose,
    estimated_calls,
    request_cache_key,
    endpoint,
    daily_limit,
    reserved_limit,
    request_budget_date
  ) as result
  limit 1;

  if kind = 'authorized' then
    update public.api_call_claims as claims
    set reserved = true,
        budget_date = request_budget_date
    where claims.cache_key = request_cache_key
      and claims.owner = claim_owner
      and claims.completed_at is null;
  end if;

  return query select kind, result_cache, result_remaining;
end;
$$;

revoke all on function public.authorize_owned_api_call(text, text, text, integer, text, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.authorize_owned_api_call(text, text, text, integer, text, integer, integer, date)
  to service_role;
