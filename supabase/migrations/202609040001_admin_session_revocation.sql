create table public.admin_sessions (
  id text primary key check (char_length(id) between 32 and 128),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from public, anon, authenticated;
grant select, insert, delete on public.admin_sessions to service_role;

create index admin_sessions_expires_at_idx on public.admin_sessions(expires_at);
