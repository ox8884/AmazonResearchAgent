# Oracle worker deployment

Target host: Ubuntu 24.04 ARM64/aarch64, 4 OCPU, 24 GB RAM.

The worker is the only long-running research process. It consumes the durable Supabase queue, Jungle Scout, AI providers, and Telegram. Do not run those jobs on Vercel.

## Host setup

1. Set the host timezone to `America/Chicago`.
2. Run `ops/oracle/bootstrap.sh` on the ARM64 host.
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
sudo timedatectl set-timezone America/Chicago
sudo cp ops/systemd/amazon-research-worker.service /etc/systemd/system/
sudo cp ops/systemd/amazon-research-daily.service /etc/systemd/system/
sudo cp ops/systemd/amazon-research-daily.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now amazon-research-worker.service
sudo systemctl enable --now amazon-research-daily.timer
```

Start command: `pnpm --filter @ara/worker start`

Daily enqueue: `pnpm --filter @ara/worker enqueue:daily`

Restart policy: `Restart=always`, `RestartSec=5`, `KillSignal=SIGTERM`, `TimeoutStopSec=90`.

AI concurrency remains 2–3; browser concurrency 1–2.

`systemd-analyze verify` for these units should be run on the Oracle host. This Windows implementation session does not mutate production.
