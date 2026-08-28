alter table public.api_call_claims
  add column if not exists usage_persisted boolean not null default false;

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
  cache_fresh boolean;
begin
  if request_cache_key is null or claim_owner is null or lease_seconds is null or lease_seconds < 1 then
    return query select 'blocked_policy'::text, request_cache_key;
    return;
  end if;

  select * into existing
  from public.api_call_claims as claims
  where claims.cache_key = request_cache_key
  for update;

  cache_fresh := exists (
    select 1
    from public.api_cache as cached
    where cached.cache_key = request_cache_key
      and cached.expires_at > now()
  );

  if cache_fresh
     and not (
       existing.cache_key is not null
       and existing.completed_at is null
       and existing.staged_response is not null
     ) then
    return query select 'cache_hit'::text, request_cache_key;
    return;
  end if;

  if existing.cache_key is not null
     and existing.completed_at is null
     and existing.claimed_until > now()
     and existing.owner is distinct from claim_owner then
    return query select 'in_flight'::text, request_cache_key;
    return;
  end if;

  new_generation := existing.cache_key is null or existing.completed_at is not null;

  insert into public.api_call_claims (
    cache_key, owner, claimed_until, reserved, budget_date, completed_at, staged_response, usage_persisted
  )
  values (
    request_cache_key,
    claim_owner,
    now() + make_interval(secs => lease_seconds),
    case when new_generation then false else coalesce(existing.reserved, false) end,
    case when new_generation then null else existing.budget_date end,
    null,
    case when new_generation then null else existing.staged_response end,
    case when new_generation then false else coalesce(existing.usage_persisted, false) end
  )
  on conflict on constraint api_call_claims_pkey do update
  set owner = excluded.owner,
      claimed_until = excluded.claimed_until,
      completed_at = null,
      reserved = excluded.reserved,
      budget_date = excluded.budget_date,
      staged_response = excluded.staged_response,
      usage_persisted = excluded.usage_persisted
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

create or replace function public.record_api_usage_for_claim(
  request_cache_key text,
  claim_owner text,
  usage_endpoint text,
  usage_purpose text,
  usage_http_status integer,
  usage_call_count integer,
  usage_retry_count integer,
  usage_cached boolean,
  usage_success boolean,
  usage_candidate_id uuid,
  usage_budget_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claim public.api_call_claims%rowtype;
begin
  select * into claim
  from public.api_call_claims as claims
  where claims.cache_key = request_cache_key
  for update;

  if claim.cache_key is null
     or claim.owner is distinct from claim_owner
     or claim.completed_at is not null
     or claim.claimed_until <= now() then
    return false;
  end if;

  if claim.usage_persisted then
    return true;
  end if;

  insert into public.api_usage (
    endpoint,
    cache_key,
    purpose,
    http_status,
    call_count,
    retry_count,
    cached,
    success,
    candidate_id,
    budget_date
  )
  values (
    usage_endpoint,
    request_cache_key,
    usage_purpose,
    usage_http_status,
    usage_call_count,
    usage_retry_count,
    usage_cached,
    usage_success,
    usage_candidate_id,
    usage_budget_date
  );

  update public.api_call_claims as claims
  set usage_persisted = true
  where claims.cache_key = request_cache_key
    and claims.owner = claim_owner
    and claims.completed_at is null;

  return true;
end;
$$;

revoke all on function public.claim_api_call(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_api_call(text, text, integer) to service_role;
revoke all on function public.record_api_usage_for_claim(text, text, text, text, integer, integer, integer, boolean, boolean, uuid, date)
  from public, anon, authenticated;
grant execute on function public.record_api_usage_for_claim(text, text, text, text, integer, integer, integer, boolean, boolean, uuid, date)
  to service_role;
