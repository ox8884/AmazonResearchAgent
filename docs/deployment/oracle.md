# Oracle worker deployment

Target host: Ubuntu 24.04 ARM64/aarch64, 4 OCPU, 24 GB RAM.

The worker is the only long-running research process. It consumes the durable Supabase queue, Jungle Scout, AI providers, and Telegram. Do not run those jobs on Vercel.

## Host setup

1. Leave the shared host timezone unchanged (`America/New_York` on hermes-server). Daily 03:00 America/Chicago is expressed on the timer unit, not by changing the host clock.
2. Run only the remaining project-scoped `ops/oracle/bootstrap.sh` steps on the ARM64 host (service account, `/opt/amazon-research/current`, `/etc/amazon-research`, swap if missing). Do not reinstall Node or Corepack when they already exist.
3. Deploy the release tree to `/opt/amazon-research/current`.
4. Create `/etc/amazon-research/worker.env` with **variable names only**. Never commit values.

Worker environment variable names:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_ID`
- `APP_SECRET_ENCRYPTION_KEY_B64`
- `JUNGLE_SCOUT_KEY_NAME`
- `JUNGLE_SCOUT_API_KEY`
- `JUNGLE_SCOUT_BASE_URL`
- `JUNGLE_SCOUT_DAILY_LIMIT`
- `JUNGLE_SCOUT_RESERVED_LIMIT`
- `TELEGRAM_BOT_TOKEN`

## systemd

```bash
sudo cp ops/systemd/amazon-research-worker.service /etc/systemd/system/
sudo cp ops/systemd/amazon-research-daily.service /etc/systemd/system/
sudo cp ops/systemd/amazon-research-daily.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now amazon-research-worker.service
sudo systemctl enable --now amazon-research-daily.timer
```

The daily timer uses `OnCalendar=*-*-* 03:00:00 America/Chicago`. On a host that stays `America/New_York`, that is 04:00 local / 08:00 UTC in CDT and 04:00 local / 09:00 UTC in CST. Do not run `timedatectl set-timezone`.

Start command: `pnpm --filter @ara/worker start`

Daily enqueue: `pnpm --filter @ara/worker enqueue:daily`

Restart policy: `Restart=always`, `RestartSec=5`, `KillSignal=SIGTERM`, `TimeoutStopSec=90`.

AI concurrency remains 2–3; browser concurrency 1–2.

`systemd-analyze verify` for these units should be run on the Oracle host. This Windows implementation session does not mutate production.
