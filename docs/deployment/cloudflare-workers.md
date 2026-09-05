# Cloudflare Workers deployment

The Next.js web application runs on Cloudflare Workers through OpenNext. The
production queue worker runs on the approved Oracle systemd host only. The
local development launcher described below starts a local worker with the web
app for development.

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
project. The production queue consumer runs on the approved Oracle systemd
host only. Windows launchers are local-development tooling and must not be
used as a remote queue consumer.

```sh
# From the approved Oracle host session
sudo systemctl status amazon-research-worker
```

Use the Oracle runbook for approved service checks and changes; do not
double-click `start-amazon-research-production-worker.cmd` for production.

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
The exported source must be the reviewed full SHA with Git blob line endings:
on Windows use `git -c core.autocrlf=false archive <full-reviewed-sha>`.
The default Windows archive may rewrite policy artifact bytes and is not a
canonical release export. Record the same full SHA in the Cloudflare release
annotation and Oracle deployment record.
It requires `CLOUDFLARE_API_TOKEN` in the launching PowerShell process and an
Ubuntu WSL distribution with Node.js and pnpm installed.

Do not upload worker-only Jungle Scout or provider API keys to Cloudflare.
Provider credentials entered in AI Settings are encrypted in Supabase by the
server-side application encryption key.
