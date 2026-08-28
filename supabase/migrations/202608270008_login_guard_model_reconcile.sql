alter table public.ai_models
  add column if not exists origin text not null default 'manual';

alter table public.ai_models
  drop constraint if exists ai_models_origin_check;

alter table public.ai_models
  add constraint ai_models_origin_check
  check (origin in ('manual', 'discovered'));

alter table public.ai_models
  drop constraint if exists ai_models_model_id_shape;

alter table public.ai_models
  add constraint ai_models_model_id_shape
  check (
    char_length(model_id) between 1 and 200
    and model_id !~ '[[:cntrl:]]'
  );

create table if not exists public.admin_login_guard (
  bucket text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  scrypt_inflight boolean not null default false
);

alter table public.admin_login_guard enable row level security;
revoke all on public.admin_login_guard from public, anon, authenticated;
grant all on public.admin_login_guard to service_role;

insert into public.admin_login_guard (bucket, window_started_at, attempts, scrypt_inflight)
values ('admin-login', now(), 0, false)
on conflict (bucket) do nothing;

create or replace function public.consume_admin_login_attempt(
  max_attempts integer,
  window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.admin_login_guard%rowtype;
begin
  insert into public.admin_login_guard (bucket)
  values ('admin-login')
  on conflict (bucket) do nothing;

  select * into current_row
  from public.admin_login_guard
  where bucket = 'admin-login'
  for update;

  if current_row.window_started_at <= now() - make_interval(secs => window_seconds) then
    update public.admin_login_guard
    set window_started_at = now(), attempts = 1
    where bucket = 'admin-login';
    return true;
  end if;

  if current_row.attempts >= max_attempts then
    return false;
  end if;

  update public.admin_login_guard
  set attempts = attempts + 1
  where bucket = 'admin-login';
  return true;
end;
$$;

create or replace function public.acquire_admin_login_scrypt()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admin_login_guard
  set scrypt_inflight = true
  where bucket = 'admin-login' and scrypt_inflight = false;
  return found;
end;
$$;

create or replace function public.release_admin_login_scrypt()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admin_login_guard
  set scrypt_inflight = false
  where bucket = 'admin-login' and scrypt_inflight = true;
  return found;
end;
$$;

revoke all on function public.consume_admin_login_attempt(integer, integer) from public, anon, authenticated;
revoke all on function public.acquire_admin_login_scrypt() from public, anon, authenticated;
revoke all on function public.release_admin_login_scrypt() from public, anon, authenticated;
grant execute on function public.consume_admin_login_attempt(integer, integer) to service_role;
grant execute on function public.acquire_admin_login_scrypt() to service_role;
grant execute on function public.release_admin_login_scrypt() to service_role;

drop function if exists public.save_ai_provider_settings(jsonb, jsonb, jsonb);

create or replace function public.save_ai_provider_settings(
  provider_row jsonb,
  secret_row jsonb,
  models jsonb,
  reconcile_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.ai_providers%rowtype;
  model_item jsonb;
  accepted_ids text[] := array[]::text[];
begin
  if provider_row is null or provider_row->>'id' is null or provider_row->>'name' is null then
    raise exception 'provider_row is required';
  end if;
  if reconcile_mode is null or reconcile_mode not in ('none', 'manual', 'discovery') then
    raise exception 'reconcile_mode is invalid';
  end if;

  insert into public.ai_providers (
    id,
    name,
    kind,
    billing_type,
    enabled,
    priority,
    config
  ) values (
    provider_row->>'id',
    provider_row->>'name',
    provider_row->>'kind',
    provider_row->>'billing_type',
    coalesce((provider_row->>'enabled')::boolean, true),
    coalesce((provider_row->>'priority')::integer, 100),
    coalesce(provider_row->'config', '{}'::jsonb)
  )
  on conflict (id) do update
  set name = excluded.name,
      kind = excluded.kind,
      billing_type = excluded.billing_type,
      enabled = excluded.enabled,
      priority = excluded.priority,
      config = excluded.config
  returning * into saved;

  if secret_row is not null then
    insert into public.provider_secrets (
      provider_id,
      ciphertext,
      iv,
      auth_tag,
      last4
    ) values (
      saved.id,
      secret_row->>'ciphertext',
      secret_row->>'iv',
      secret_row->>'auth_tag',
      secret_row->>'last4'
    )
    on conflict (provider_id) do update
    set ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        last4 = excluded.last4;
  end if;

  if reconcile_mode <> 'none' and models is not null then
    for model_item in select value from jsonb_array_elements(models)
    loop
      if coalesce(model_item->>'model_id', '') = '' then
        raise exception 'model_id is required';
      end if;
      accepted_ids := array_append(accepted_ids, model_item->>'model_id');
      insert into public.ai_models (
        provider_id,
        model_id,
        display_name,
        capabilities,
        billing_type,
        quality_rank,
        enabled,
        priority,
        origin
      ) values (
        saved.id,
        model_item->>'model_id',
        coalesce(model_item->>'display_name', model_item->>'model_id'),
        coalesce(model_item->'capabilities', '[]'::jsonb),
        coalesce(model_item->>'billing_type', saved.billing_type),
        coalesce((model_item->>'quality_rank')::integer, 100),
        coalesce((model_item->>'enabled')::boolean, true),
        coalesce((model_item->>'priority')::integer, 100),
        coalesce(model_item->>'origin', case when reconcile_mode = 'discovery' then 'discovered' else 'manual' end)
      )
      on conflict (provider_id, model_id) do update
      set display_name = excluded.display_name,
          capabilities = excluded.capabilities,
          billing_type = excluded.billing_type,
          quality_rank = excluded.quality_rank,
          enabled = excluded.enabled,
          priority = excluded.priority,
          origin = excluded.origin;
    end loop;

    if reconcile_mode = 'manual' then
      update public.ai_models
      set enabled = false
      where provider_id = saved.id
        and origin = 'manual'
        and not (model_id = any (accepted_ids));
    elsif reconcile_mode = 'discovery' then
      update public.ai_models
      set enabled = false
      where provider_id = saved.id
        and not (model_id = any (accepted_ids));
    end if;
  end if;

  return jsonb_build_object(
    'id', saved.id,
    'name', saved.name,
    'kind', saved.kind,
    'billing_type', saved.billing_type,
    'enabled', saved.enabled,
    'priority', saved.priority,
    'config', saved.config,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.save_ai_provider_settings(jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_ai_provider_settings(jsonb, jsonb, jsonb, text) to service_role;

create or replace function public.record_failed_ai_usage(
  analysis_id uuid,
  worker_id text,
  analysis_usage jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_usage (
    analysis_id,
    provider_id,
    model_id,
    role,
    input_hash,
    usage,
    cost_class,
    started_at,
    completed_at
  )
  select
    analyses.id,
    analyses.provider_id,
    analyses.model_id,
    analyses.role,
    analyses.input_hash,
    coalesce($3, '{}'::jsonb),
    analyses.cost_class,
    analyses.started_at,
    now()
  from public.ai_analyses as analyses
  where analyses.id = $1
    and analyses.leased_by = $2
  on conflict on constraint ai_usage_analysis_id_key do update
  set usage = excluded.usage,
      completed_at = excluded.completed_at;
  return found;
end;
$$;

revoke all on function public.record_failed_ai_usage(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_failed_ai_usage(uuid, text, jsonb) to service_role;
