create or replace function public.save_ai_provider_settings(
  provider_row jsonb,
  secret_row jsonb,
  model_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.ai_providers%rowtype;
begin
  if provider_row is null or provider_row->>'id' is null or provider_row->>'name' is null then
    raise exception 'provider_row is required';
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

  if model_row is not null then
    insert into public.ai_models (
      provider_id,
      model_id,
      display_name,
      capabilities,
      billing_type,
      quality_rank,
      enabled,
      priority
    ) values (
      saved.id,
      model_row->>'model_id',
      coalesce(model_row->>'display_name', model_row->>'model_id'),
      coalesce(model_row->'capabilities', '[]'::jsonb),
      model_row->>'billing_type',
      coalesce((model_row->>'quality_rank')::integer, 100),
      coalesce((model_row->>'enabled')::boolean, true),
      coalesce((model_row->>'priority')::integer, 100)
    )
    on conflict (provider_id, model_id) do update
    set display_name = excluded.display_name,
        capabilities = excluded.capabilities,
        billing_type = excluded.billing_type,
        quality_rank = excluded.quality_rank,
        enabled = excluded.enabled,
        priority = excluded.priority;
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

revoke all on function public.save_ai_provider_settings(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_ai_provider_settings(jsonb, jsonb, jsonb) to service_role;
