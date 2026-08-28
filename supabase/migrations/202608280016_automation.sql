create table public.app_settings (
  id boolean primary key default true check (id),
  locale text not null default 'ko' check (locale in ('ko', 'en')),
  timezone text not null default 'America/Chicago'
    check (timezone = 'America/Chicago'),
  daily_api_budget integer not null default 20 check (daily_api_budget >= 0),
  manual_api_reserve integer not null default 5 check (manual_api_reserve >= 0),
  manual_reserve_enabled boolean not null default true,
  new_percent integer not null default 60 check (new_percent between 0 and 100),
  watch_percent integer not null default 30 check (watch_percent between 0 and 100),
  strong_percent integer not null default 10 check (strong_percent between 0 and 100),
  new_freshness_hours integer not null default 168 check (new_freshness_hours > 0),
  watch_freshness_hours integer not null default 168 check (watch_freshness_hours > 0),
  strong_freshness_hours integer not null default 24 check (strong_freshness_hours > 0),
  notification_locale text check (notification_locale in ('ko', 'en')),
  telegram_enabled boolean not null default false,
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (new_percent + watch_percent + strong_percent = 100),
  check (not manual_reserve_enabled or manual_api_reserve <= daily_api_budget)
);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('scheduled', 'manual')),
  mode text not null default 'normal' check (mode in ('normal', 'override-reserve')),
  logical_run_date date not null,
  locale text not null default 'ko' check (locale in ('ko', 'en')),
  timezone text not null default 'America/Chicago'
    check (timezone = 'America/Chicago'),
  status text not null default 'queued'
    check (status in ('queued', 'planning', 'fanout', 'running', 'waiting', 'completed', 'failed', 'needs_attention')),
  idempotency_key text not null unique,
  selected_candidate_ids jsonb not null default '[]'::jsonb,
  checkpoint jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index research_runs_one_scheduled_date_idx
  on public.research_runs(logical_run_date)
  where source = 'scheduled';
create index research_runs_status_created_idx
  on public.research_runs(status, created_at desc);

create table public.scheduled_run_locks (
  run_date date primary key,
  research_run_id uuid not null unique references public.research_runs(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid references public.research_runs(id) on delete set null,
  candidate_id uuid references public.candidates(id) on delete set null,
  event_type text not null check (event_type in (
    'NEW_STRONG', 'WATCH_TO_STRONG', 'MAJOR_STATE_CHANGE', 'NEEDS_ATTENTION', 'DAILY_SUMMARY'
  )),
  locale text not null default 'ko' check (locale in ('ko', 'en')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'delivered', 'retryable', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  idempotency_key text not null unique,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_delivery_idx
  on public.notifications(status, created_at)
  where status in ('queued', 'retryable');

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

create trigger research_runs_set_updated_at
before update on public.research_runs
for each row execute function public.set_updated_at();

create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.research_runs enable row level security;
alter table public.scheduled_run_locks enable row level security;
alter table public.notifications enable row level security;

revoke all on public.app_settings from anon, authenticated;
revoke all on public.research_runs from anon, authenticated;
revoke all on public.scheduled_run_locks from anon, authenticated;
revoke all on public.notifications from anon, authenticated;

grant all on public.app_settings to service_role;
grant all on public.research_runs to service_role;
grant all on public.scheduled_run_locks to service_role;
grant all on public.notifications to service_role;
