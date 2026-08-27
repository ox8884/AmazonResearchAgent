create table public.ai_providers (
  id text primary key,
  name text not null unique,
  kind text not null check (kind in ('openai_http', 'command')),
  billing_type text not null check (billing_type in ('free', 'subscription', 'payg')),
  enabled boolean not null default false,
  priority integer not null default 100 check (priority >= 0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers(id) on delete cascade,
  model_id text not null,
  display_name text not null,
  capabilities jsonb not null default '[]'::jsonb,
  billing_type text not null check (billing_type in ('free', 'subscription', 'payg')),
  quality_rank integer not null default 100 check (quality_rank >= 0),
  enabled boolean not null default true,
  priority integer not null default 100 check (priority >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_id)
);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.ai_providers(id) on delete restrict,
  model_id text not null,
  role text not null check (role in (
    'bulk_classification',
    'niche_normalization',
    'deep_market_analysis',
    'strong_cross_validation',
    'review_mining',
    'supplier_negotiation',
    'daily_digest'
  )),
  locale text not null check (locale in ('ko', 'en')),
  entity_type text not null,
  entity_id uuid not null,
  input_hash text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output jsonb not null,
  usage jsonb not null default '{}'::jsonb,
  cost_class text not null check (cost_class in ('free', 'subscription', 'payg')),
  prompt_version text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (role, input_hash)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null unique references public.ai_analyses(id) on delete cascade,
  provider_id text not null references public.ai_providers(id) on delete restrict,
  model_id text not null,
  role text not null,
  input_hash text not null,
  usage jsonb not null default '{}'::jsonb,
  cost_class text not null check (cost_class in ('free', 'subscription', 'payg')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.provider_secrets (
  provider_id text primary key references public.ai_providers(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  last4 text not null check (length(last4) between 0 and 4),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

alter table public.niche_clusters
  add column canonical_english text,
  add column catalog_phrases jsonb not null default '[]'::jsonb,
  add column aliases jsonb not null default '[]'::jsonb;

alter table public.niche_clusters
  add constraint niche_clusters_canonical_name_key unique (canonical_name);

create index ai_analyses_entity_idx
  on public.ai_analyses(entity_type, entity_id, created_at desc);
create index ai_analyses_input_hash_idx
  on public.ai_analyses(input_hash);
create index ai_usage_provider_time_idx
  on public.ai_usage(provider_id, created_at desc);

create trigger ai_providers_set_updated_at
before update on public.ai_providers
for each row execute function public.set_updated_at();

create trigger ai_models_set_updated_at
before update on public.ai_models
for each row execute function public.set_updated_at();

alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.ai_usage enable row level security;
alter table public.provider_secrets enable row level security;

revoke all on public.ai_providers from public, anon, authenticated;
revoke all on public.ai_models from public, anon, authenticated;
revoke all on public.ai_analyses from public, anon, authenticated;
revoke all on public.ai_usage from public, anon, authenticated;
revoke all on public.provider_secrets from public, anon, authenticated;

grant all on public.ai_providers to service_role;
grant all on public.ai_models to service_role;
grant all on public.ai_analyses to service_role;
grant all on public.ai_usage to service_role;
grant all on public.provider_secrets to service_role;
