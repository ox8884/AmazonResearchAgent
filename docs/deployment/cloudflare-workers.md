# Cloudflare Workers deployment

The Next.js web application runs on Cloudflare Workers through OpenNext. The
long-running queue worker remains a local process and starts with the web app
through the repository launcher.

## Local full stack

Prerequisites:

- Docker Desktop is running.
- `.env.local` contains the private application and provider values.

Double-click `start-amazon-research-agent.cmd`, or run:

```powershell
pnpm dev:local
```

The launcher starts local Supabase when necessary, imports `.env.local` into
the child processes without printing values, and serves the web app at
`http://127.0.0.1:3100/ko` while the worker consumes queued jobs.

## Production queue worker

The Cloudflare web application writes jobs to the linked remote Supabase
project. After registering providers in the deployed AI Settings page, run the
remote queue consumer on the Windows machine:

```powershell
pnpm worker:production:check
pnpm worker:production
```

The first command verifies the remote canonical writer capability without
claiming a job. The second starts the long-running worker. You can also
double-click `start-amazon-research-production-worker.cmd`.

## Cloudflare web deployment

The Worker needs these encrypted secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSWORD_SCRYPT`
- `APP_SESSION_SIGNING_KEY_B64`
- `APP_SECRET_ENCRYPTION_KEY_B64`

Set them with `wrangler secret put` from `apps/web`, then deploy:

```powershell
pnpm deploy:cloudflare
```

OpenNext's Windows build is not reliable, so the deployment script creates a
clean temporary build in Ubuntu WSL and uploads from that same environment.
It requires `CLOUDFLARE_API_TOKEN` in the launching PowerShell process and an
Ubuntu WSL distribution with Node.js and pnpm installed.

Do not upload worker-only Jungle Scout or provider API keys to Cloudflare.
Provider credentials entered in AI Settings are encrypted in Supabase by the
server-side application encryption key.
