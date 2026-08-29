# Milestone 4 verification

This file records the production-automation acceptance contract and the evidence collected during local implementation. No Oracle, Vercel, Telegram, Jungle Scout, or paid AI production action was performed.

## Scheduled run

- Daily identity: `daily-research:<America/Chicago YYYY-MM-DD>`
- Timer: `ops/systemd/amazon-research-daily.timer` `OnCalendar=*-*-* 03:00:00` with `Persistent=true`
- Host timezone must be `America/Chicago` so local 03:00 is DST-aware
- Duplicate enqueue coverage: worker daily research integration test

## Research Now

- `POST /api/research-now` is authenticated, CSRF-protected, enqueue-only, HTTP 202
- UI: Korean `지금 리서치` / queued `대기열에 추가됨`
- E2E intercepts the API and does not call production

## Checkpoint / resume

- Plan publication is compare-and-swap (`publish_daily_research_plan`)
- Fanout/completion writes are monotonic (`advance_daily_research_checkpoint`)
- Child Market Probe keys are run-scoped; deferred and in-flight resume keys include purpose
- Stale workers cannot regress a completed checkpoint

## Telegram

- Fake transport only in tests (`packages/notifications`)
- Digest omits heartbeat/cache-hit
- Delivery failure is recorded on `notifications` and does not mutate research run source of truth

## Deployment

- Oracle systemd units and bootstrap script are committed
- `systemd-analyze verify` requires the Ubuntu ARM64 host and was not run in this session
- Vercel config points at `apps/web`
- Worker secrets are documented as worker-only names
