create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  locale text not null default 'ko' check (locale in ('ko', 'en')),
  source_files jsonb not null default '[]'::jsonb,
  submission_hash text not null,
  file_count integer not null default 0 check (file_count >= 0),
  total_row_count integer not null default 0 check (total_row_count >= 0),
  unique_keyword_count integer not null default 0 check (unique_keyword_count >= 0),
  duplicate_keyword_count integer not null default 0 check (duplicate_keyword_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.raw_opportunity_keywords (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  source_file_name text not null,
  source_hash text not null,
  source_row_number integer not null check (source_row_number > 0),
  row_hash text not null,
  raw_row_text text not null,
  raw_row jsonb not null,
  parsed_row jsonb,
  keyword text not null,
  normalized_exact_keyword text not null,
  is_exact_duplicate boolean not null default false,
  duplicate_of uuid references public.raw_opportunity_keywords(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (import_run_id, source_hash, source_row_number)
);

create table public.niche_clusters (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  state text not null default 'Discovered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.niche_cluster_keywords (
  niche_cluster_id uuid not null references public.niche_clusters(id) on delete cascade,
  raw_opportunity_keyword_id uuid not null references public.raw_opportunity_keywords(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (niche_cluster_id, raw_opportunity_keyword_id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  representative_raw_keyword_id uuid references public.raw_opportunity_keywords(id) on delete set null,
  niche_cluster_id uuid references public.niche_clusters(id) on delete set null,
  keyword text not null,
  normalized_exact_keyword text not null,
  state text not null check (state in (
    'Discovered',
    'Rule Filter',
    'AI Screening',
    'Ready for API Validation',
    'Waiting for API Budget',
    'API Validation Running',
    'Deep Research',
    'Strong',
    'Watch',
    'Reject',
    'Needs Review',
    'Waiting for AI Capacity',
    'Needs Attention'
  )),
  rule_passed boolean not null,
  rule_reasons jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  preliminary_score numeric(5, 2) check (
    preliminary_score is null or preliminary_score between 0 and 100
  ),
  preliminary_score_components jsonb,
  eligible_for_ai_normalization boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_run_id, normalized_exact_keyword)
);

create table public.decision_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  from_state text,
  to_state text not null,
  reasons jsonb not null default '[]'::jsonb,
  decided_by text not null default 'system',
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.score_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  score_type text not null,
  score numeric(5, 2) not null check (score between 0 and 100),
  components jsonb not null,
  source_data_timestamp timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_type text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  priority integer not null default 100,
  available_at timestamptz not null default now(),
  leased_until timestamptz,
  leased_by text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  idempotency_key text not null unique,
  checkpoint jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts >= 0),
  check (max_attempts > 0)
);

create index raw_opportunity_keywords_import_run_idx
  on public.raw_opportunity_keywords(import_run_id);
create index raw_opportunity_keywords_exact_keyword_idx
  on public.raw_opportunity_keywords(normalized_exact_keyword);
create index candidates_state_score_idx
  on public.candidates(state, preliminary_score desc);
create index candidates_import_run_idx
  on public.candidates(import_run_id);
create index decision_history_candidate_time_idx
  on public.decision_history(candidate_id, decided_at desc);
create index score_history_candidate_time_idx
  on public.score_history(candidate_id, created_at desc);
create index audit_events_entity_time_idx
  on public.audit_events(entity_type, entity_id, created_at desc);
create index jobs_claim_idx
  on public.jobs(priority, available_at, created_at)
  where status in ('queued', 'running');

create trigger import_runs_set_updated_at
before update on public.import_runs
for each row execute function public.set_updated_at();

create trigger niche_clusters_set_updated_at
before update on public.niche_clusters
for each row execute function public.set_updated_at();

create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

create or replace function public.claim_jobs(
  worker_id text,
  job_limit integer,
  lease_seconds integer
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id must not be empty';
  end if;
  if job_limit < 1 or job_limit > 100 then
    raise exception 'job_limit must be between 1 and 100';
  end if;
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;

  return query
  with eligible as (
    select j.id
    from public.jobs as j
    where j.attempts < j.max_attempts
      and (
        (j.status = 'queued' and j.available_at <= now())
        or
        (j.status = 'running' and j.leased_until < now())
      )
    order by j.priority asc, j.available_at asc, j.created_at asc
    for update skip locked
    limit job_limit
  )
  update public.jobs as j
  set status = 'running',
      leased_by = worker_id,
      leased_until = now() + make_interval(secs => lease_seconds),
      attempts = j.attempts + 1,
      updated_at = now()
  from eligible
  where j.id = eligible.id
  returning j.*;
end;
$$;

create or replace function public.heartbeat_job(
  job_id uuid,
  worker_id text,
  lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if lease_seconds < 1 or lease_seconds > 86400 then
    raise exception 'lease_seconds must be between 1 and 86400';
  end if;

  update public.jobs as j
  set leased_until = now() + make_interval(secs => lease_seconds),
      updated_at = now()
  where j.id = $1
    and j.status = 'running'
    and j.leased_by = $2;

  return found;
end;
$$;

create or replace function public.complete_job(
  job_id uuid,
  worker_id text,
  checkpoint jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs as j
  set status = 'completed',
      checkpoint = coalesce($3, '{}'::jsonb),
      leased_until = null,
      leased_by = null,
      last_error = null,
      updated_at = now()
  where j.id = $1
    and j.status = 'running'
    and j.leased_by = $2;

  return found;
end;
$$;

create or replace function public.fail_job(
  job_id uuid,
  worker_id text,
  error_text text,
  retry_at timestamptz,
  checkpoint jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.jobs as j
  set status = case
        when j.attempts >= j.max_attempts then 'failed'
        else 'queued'
      end,
      available_at = case
        when j.attempts >= j.max_attempts then j.available_at
        else coalesce($4, now())
      end,
      leased_until = null,
      leased_by = null,
      last_error = left(coalesce($3, 'Unknown worker error'), 8000),
      checkpoint = coalesce($5, j.checkpoint),
      updated_at = now()
  where j.id = $1
    and j.status = 'running'
    and j.leased_by = $2;

  return found;
end;
$$;

alter table public.import_runs enable row level security;
alter table public.raw_opportunity_keywords enable row level security;
alter table public.niche_clusters enable row level security;
alter table public.niche_cluster_keywords enable row level security;
alter table public.candidates enable row level security;
alter table public.decision_history enable row level security;
alter table public.score_history enable row level security;
alter table public.audit_events enable row level security;
alter table public.jobs enable row level security;

revoke all on public.import_runs from anon, authenticated;
revoke all on public.raw_opportunity_keywords from anon, authenticated;
revoke all on public.niche_clusters from anon, authenticated;
revoke all on public.niche_cluster_keywords from anon, authenticated;
revoke all on public.candidates from anon, authenticated;
revoke all on public.decision_history from anon, authenticated;
revoke all on public.score_history from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;
revoke all on public.jobs from anon, authenticated;

grant all on public.import_runs to service_role;
grant all on public.raw_opportunity_keywords to service_role;
grant all on public.niche_clusters to service_role;
grant all on public.niche_cluster_keywords to service_role;
grant all on public.candidates to service_role;
grant all on public.decision_history to service_role;
grant all on public.score_history to service_role;
grant all on public.audit_events to service_role;
grant all on public.jobs to service_role;

revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_job(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;
grant execute on function public.heartbeat_job(uuid, text, integer) to service_role;
grant execute on function public.complete_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_job(uuid, text, text, timestamptz, jsonb) to service_role;
