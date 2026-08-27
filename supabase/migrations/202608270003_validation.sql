create table public.product_families (
  id uuid primary key default gen_random_uuid(),
  niche_cluster_id uuid references public.niche_clusters(id) on delete set null,
  parent_key text not null,
  observed_monthly_units numeric,
  observed_monthly_revenue numeric,
  variant_count integer not null default 1 check (variant_count >= 0),
  quality_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (niche_cluster_id, parent_key)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid not null references public.product_families(id) on delete cascade,
  niche_cluster_id uuid references public.niche_clusters(id) on delete set null,
  asin text not null,
  parent_asin text,
  title text,
  brand text,
  price numeric,
  reviews integer,
  rating numeric,
  seller_type text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_family_id, asin)
);

create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  niche_cluster_id uuid references public.niche_clusters(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,
  observed_sample_sales numeric not null default 0,
  estimated_market_sales numeric,
  sample_product_family_count integer not null default 0 check (sample_product_family_count >= 0),
  source_endpoint_set jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now(),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.api_cache (
  cache_key text primary key,
  endpoint text not null,
  response jsonb not null,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.api_budget_daily (
  budget_date date primary key,
  daily_limit integer not null check (daily_limit >= 0),
  reserved_limit integer not null check (reserved_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  reserved_used_count integer not null default 0 check (reserved_used_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reserved_limit <= daily_limit),
  check (used_count <= daily_limit)
);

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  cache_key text not null,
  purpose text not null check (purpose in (
    'normal_validation',
    'manual_research',
    'strong_revalidation'
  )),
  http_status integer,
  call_count integer not null default 1 check (call_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  cached boolean not null default false,
  success boolean,
  error_code text,
  candidate_id uuid references public.candidates(id) on delete set null,
  niche_cluster_id uuid references public.niche_clusters(id) on delete set null,
  budget_date date not null default (timezone('America/Chicago', now()))::date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  code text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create table public.candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index product_families_cluster_idx on public.product_families(niche_cluster_id);
create index products_asin_idx on public.products(asin);
create index market_snapshots_cluster_idx on public.market_snapshots(niche_cluster_id, captured_at desc);
create index api_usage_budget_idx on public.api_usage(budget_date, endpoint);
create index api_usage_candidate_idx on public.api_usage(candidate_id);
create index api_cache_expires_idx on public.api_cache(expires_at);

create trigger product_families_set_updated_at
before update on public.product_families
for each row execute function public.set_updated_at();

create trigger api_budget_daily_set_updated_at
before update on public.api_budget_daily
for each row execute function public.set_updated_at();

alter table public.product_families enable row level security;
alter table public.products enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.api_cache enable row level security;
alter table public.api_budget_daily enable row level security;
alter table public.api_usage enable row level security;
alter table public.risks enable row level security;
alter table public.candidate_evidence enable row level security;

revoke all on public.product_families from public, anon, authenticated;
revoke all on public.products from public, anon, authenticated;
revoke all on public.market_snapshots from public, anon, authenticated;
revoke all on public.api_cache from public, anon, authenticated;
revoke all on public.api_budget_daily from public, anon, authenticated;
revoke all on public.api_usage from public, anon, authenticated;
revoke all on public.risks from public, anon, authenticated;
revoke all on public.candidate_evidence from public, anon, authenticated;

grant all on public.product_families to service_role;
grant all on public.products to service_role;
grant all on public.market_snapshots to service_role;
grant all on public.api_cache to service_role;
grant all on public.api_budget_daily to service_role;
grant all on public.api_usage to service_role;
grant all on public.risks to service_role;
grant all on public.candidate_evidence to service_role;
