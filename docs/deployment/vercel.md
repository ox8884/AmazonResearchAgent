# Vercel web deployment

Vercel hosts `apps/web` only: UI, authenticated HTTP, and enqueue-only mutations.

Vercel must never:

- run the worker
- call Jungle Scout
- execute AI provider CLIs
- send Telegram
- spawn subprocesses for research

## Environment variable names

Browser-safe:

- `NEXT_PUBLIC_SITE_URL` (optional)

Server-only web:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `ADMIN_PASSWORD_SCRYPT`
- `APP_SESSION_SIGNING_KEY_B64`

Worker-only names that must **not** be configured on Vercel:

- `JUNGLE_SCOUT_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `APP_SECRET_ENCRYPTION_KEY_B64`

## Build

```bash
pnpm --filter @ara/web build
```

`vercel.json` sets the project to `apps/web`.
