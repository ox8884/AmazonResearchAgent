insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'opportunity-imports',
  'opportunity-imports',
  false,
  10485760,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create unique index import_runs_active_submission_hash_uniq
  on public.import_runs (submission_hash)
  where status <> 'failed';
