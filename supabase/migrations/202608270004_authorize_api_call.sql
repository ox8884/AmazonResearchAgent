drop function if exists public.authorize_api_call(text, integer, text, text, integer, integer, date);

create or replace function public.authorize_api_call(
  purpose text,
  estimated_calls integer,
  request_cache_key text,
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
  budget public.api_budget_daily%rowtype;
  normal_ceiling integer;
  used_before integer;
  requested_limit integer := authorize_api_call.daily_limit;
  requested_reserve integer := authorize_api_call.reserved_limit;
begin
  if estimated_calls is null or estimated_calls < 1 then
    return query select 'blocked_policy'::text, request_cache_key, null::integer;
    return;
  end if;

  if purpose not in ('normal_validation', 'manual_research', 'strong_revalidation') then
    return query select 'blocked_policy'::text, request_cache_key, null::integer;
    return;
  end if;

  if daily_limit < 0 or reserved_limit < 0 or reserved_limit > daily_limit then
    return query select 'blocked_policy'::text, request_cache_key, null::integer;
    return;
  end if;

  if exists (
    select 1
    from public.api_cache
    where api_cache.cache_key = request_cache_key
      and api_cache.expires_at > now()
  ) then
    return query select 'cache_hit'::text, request_cache_key, null::integer;
    return;
  end if;

  insert into public.api_budget_daily (
    budget_date,
    daily_limit,
    reserved_limit,
    used_count,
    reserved_used_count
  )
  values (
    request_budget_date,
    requested_limit,
    requested_reserve,
    0,
    0
  )
  on conflict (budget_date) do nothing;

  select *
  into budget
  from public.api_budget_daily
  where api_budget_daily.budget_date = request_budget_date
  for update;

  if exists (
    select 1
    from public.api_cache
    where api_cache.cache_key = request_cache_key
      and api_cache.expires_at > now()
  ) then
    return query select
      'cache_hit'::text,
      request_cache_key,
      (budget.daily_limit - budget.used_count);
    return;
  end if;

  normal_ceiling := budget.daily_limit - budget.reserved_limit;
  if purpose = 'normal_validation' then
    if budget.used_count + estimated_calls > normal_ceiling then
      return query select
        'budget_exhausted'::text,
        request_cache_key,
        (budget.daily_limit - budget.used_count);
      return;
    end if;
  elsif budget.used_count + estimated_calls > budget.daily_limit then
    return query select
      'budget_exhausted'::text,
      request_cache_key,
      (budget.daily_limit - budget.used_count);
    return;
  end if;

  used_before := budget.used_count;
  update public.api_budget_daily
  set
    used_count = used_count + estimated_calls,
    reserved_used_count = case
      when purpose = 'normal_validation' then reserved_used_count
      else reserved_used_count + greatest(
        0,
        (used_before + estimated_calls) - normal_ceiling
      ) - greatest(0, used_before - normal_ceiling)
    end
  where api_budget_daily.budget_date = request_budget_date
  returning * into budget;

  return query select
    'authorized'::text,
    request_cache_key,
    (budget.daily_limit - budget.used_count);
end;
$$;

revoke all on function public.authorize_api_call(text, integer, text, text, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.authorize_api_call(text, integer, text, text, integer, integer, date)
  to service_role;
