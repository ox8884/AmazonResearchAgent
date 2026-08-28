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
  if reconcile_mode is null or reconcile_mode not in ('none', 'manual', 'discovery', 'status') then
    raise exception 'reconcile_mode is invalid';
  end if;

  insert into public.ai_providers (
    id, name, kind, billing_type, enabled, priority, config
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
      provider_id, ciphertext, iv, auth_tag, last4
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
      if reconcile_mode = 'status' then
        update public.ai_models
        set
          enabled = coalesce((model_item->>'enabled')::boolean, enabled),
          priority = coalesce((model_item->>'priority')::integer, priority)
        where provider_id = saved.id
          and model_id = model_item->>'model_id';
      else
        insert into public.ai_models (
          provider_id, model_id, display_name, capabilities, billing_type,
          quality_rank, enabled, priority, origin
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
            enabled = case
              when reconcile_mode = 'discovery' then ai_models.enabled
              else excluded.enabled
            end,
            priority = case
              when reconcile_mode = 'discovery' then ai_models.priority
              else excluded.priority
            end,
            origin = case
              when ai_models.origin = 'manual' then 'manual'
              else excluded.origin
            end;
      end if;
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
        and origin = 'discovered'
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
