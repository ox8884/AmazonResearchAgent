alter table public.ai_analyses
  add column status text not null default 'completed'
    check (status in ('pending', 'completed', 'failed')),
  add column leased_by text,
  add column leased_until timestamptz,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_error text,
  add column available_at timestamptz not null default now(),
  alter column output drop not null,
  alter column completed_at drop not null;

create table public.ai_analysis_entities (
  analysis_id uuid not null references public.ai_analyses(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (analysis_id, entity_type, entity_id)
);

alter table public.ai_analysis_entities enable row level security;
revoke all on public.ai_analysis_entities from public, anon, authenticated;
grant all on public.ai_analysis_entities to service_role;

create index ai_analyses_claim_idx
  on public.ai_analyses(status, available_at, leased_until)
  where status in ('pending', 'failed');
create index ai_analysis_entities_entity_idx
  on public.ai_analysis_entities(entity_type, entity_id);

alter table public.niche_clusters add column canonical_key text;
update public.niche_clusters
set canonical_key = lower(regexp_replace(trim(canonical_name), '[^[:alnum:]]+', ' ', 'g'));
alter table public.niche_clusters alter column canonical_key set not null;
alter table public.niche_clusters drop constraint niche_clusters_canonical_name_key;
alter table public.niche_clusters add constraint niche_clusters_canonical_key_key unique (canonical_key);

create or replace function public.jsonb_text_array_union(left_value jsonb, right_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  from (
    select distinct value
    from jsonb_array_elements_text(coalesce(left_value, '[]'::jsonb)) as left_items(value)
    union
    select distinct value
    from jsonb_array_elements_text(coalesce(right_value, '[]'::jsonb)) as right_items(value)
  ) values_union;
$$;

create or replace function public.upsert_niche_cluster(
  canonical_key text,
  canonical_name text,
  canonical_english text,
  aliases jsonb,
  catalog_phrases jsonb,
  cluster_state text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cluster_id uuid;
begin
  insert into public.niche_clusters (
    canonical_key,
    canonical_name,
    canonical_english,
    aliases,
    catalog_phrases,
    state
  ) values (
    $1,
    $2,
    $3,
    coalesce($4, '[]'::jsonb),
    coalesce($5, '[]'::jsonb),
    $6
  )
  on conflict on constraint niche_clusters_canonical_key_key do update
  set canonical_name = excluded.canonical_name,
      canonical_english = coalesce(excluded.canonical_english, niche_clusters.canonical_english),
      aliases = public.jsonb_text_array_union(niche_clusters.aliases, excluded.aliases),
      catalog_phrases = public.jsonb_text_array_union(
        niche_clusters.catalog_phrases,
        excluded.catalog_phrases
      ),
      state = excluded.state,
      updated_at = now()
  returning id into cluster_id;

  return cluster_id;
end;
$$;

create or replace function public.claim_ai_analysis(
  analysis_role text,
  analysis_input_hash text,
  worker_id text,
  lease_seconds integer,
  provider_id text,
  model_id text,
  analysis_locale text,
  prompt_version text,
  input_payload jsonb
)
returns table (analysis_id uuid, claim_status text, output jsonb, usage jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.ai_analyses%rowtype;
begin
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;

  insert into public.ai_analyses (
    provider_id,
    model_id,
    role,
    locale,
    entity_type,
    entity_id,
    input_hash,
    input_payload,
    output,
    usage,
    cost_class,
    prompt_version,
    status,
    started_at,
    completed_at,
    available_at
  ) values (
    $5,
    $6,
    $1,
    $7,
    'analysis_claim',
    gen_random_uuid(),
    $2,
    coalesce($9, '{}'::jsonb),
    null,
    '{}'::jsonb,
    'subscription',
    $8,
    'pending',
    now(),
    null,
    now()
  ) on conflict (role, input_hash) do nothing;

  select * into current_row
  from public.ai_analyses
  where role = $1 and input_hash = $2
  for update;

  if current_row.status = 'completed' then
    return query select current_row.id, 'completed'::text, current_row.output, current_row.usage;
    return;
  end if;

  if current_row.status = 'pending'
     and current_row.leased_until is not null
     and current_row.leased_until > now()
     and current_row.leased_by is distinct from $3 then
    return query select current_row.id, 'busy'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if current_row.available_at > now()
     and current_row.leased_by is distinct from $3 then
    return query select current_row.id, 'busy'::text, null::jsonb, null::jsonb;
    return;
  end if;

  update public.ai_analyses
  set status = 'pending',
      provider_id = $5,
      model_id = $6,
      locale = $7,
      input_payload = coalesce($9, '{}'::jsonb),
      prompt_version = $8,
      leased_by = $3,
      leased_until = now() + make_interval(secs => $4),
      attempts = attempts + 1,
      last_error = null,
      started_at = now()
  where id = current_row.id;

  return query select current_row.id, 'claimed'::text, null::jsonb, null::jsonb;
end;
$$;

create or replace function public.complete_ai_analysis(
  analysis_id uuid,
  worker_id text,
  analysis_output jsonb,
  analysis_usage jsonb,
  cost_class text,
  completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  completed boolean;
begin
  update public.ai_analyses
  set status = 'completed',
      output = $3,
      usage = coalesce($4, '{}'::jsonb),
      cost_class = $5,
      completed_at = $6,
      leased_by = null,
      leased_until = null,
      last_error = null
  where id = $1 and status = 'pending' and leased_by = $2;
  completed := found;

  if completed then
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
      analyses.usage,
      analyses.cost_class,
      analyses.started_at,
      analyses.completed_at
    from public.ai_analyses as analyses
    where analyses.id = $1
    on conflict on constraint ai_usage_analysis_id_key do update
    set usage = excluded.usage,
        completed_at = excluded.completed_at,
        cost_class = excluded.cost_class;
  end if;
  return completed;
end;
$$;

create or replace function public.fail_ai_analysis(
  analysis_id uuid,
  worker_id text,
  error_code text,
  retry_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_analyses
  set status = 'failed',
      last_error = left($3, 200),
      available_at = $4,
      leased_by = null,
      leased_until = null
  where id = $1 and status = 'pending' and leased_by = $2;
  return found;
end;
$$;

create or replace function public.provider_secret_rotation_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ciphertext is distinct from old.ciphertext
     or new.iv is distinct from old.iv
     or new.auth_tag is distinct from old.auth_tag then
    new.rotated_at = now();
  end if;
  return new;
end;
$$;

create trigger provider_secrets_set_rotated_at
before update on public.provider_secrets
for each row execute function public.provider_secret_rotation_timestamp();

revoke all on function public.claim_ai_analysis(text, text, text, integer, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_ai_analysis(uuid, text, jsonb, jsonb, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_ai_analysis(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.claim_ai_analysis(text, text, text, integer, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.complete_ai_analysis(uuid, text, jsonb, jsonb, text, timestamptz)
  to service_role;
grant execute on function public.fail_ai_analysis(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.upsert_niche_cluster(text, text, text, jsonb, jsonb, text)
  to service_role;
