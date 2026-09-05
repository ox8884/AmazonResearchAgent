# Oracle production worker correction

Date: 2026-09-05 UTC / 2026-09-04 America/Chicago.

## Outcome and correction

- User requested Oracle 24/7 operation, independent of the Windows PC.
- Oracle already had an enabled/active worker on old release `ae1ee5e5209be861b67088033f15c2059324f44d`. The preceding rollout mistakenly added a Windows consumer without first checking Oracle.
- Stopped only the verified Windows launcher PID 25980 and its descendant tree. A final Windows process check returned no matching production-worker processes or surviving recorded PIDs.
- Oracle `/opt/amazon-research/current` and `DEPLOYED_HEAD` now identify `61f19e957563686376bcb883d1408ef4812b8e43`. Existing service/environment files, credentials, data, host timezone, unrelated services, and subscription-OAuth restrictions are unchanged.
- Cloudflare web deployment was not changed in this turn.

## Exact release and checks

- Source: committed Git archive only; user dirty/untracked files excluded. Secret-path tracked-file check returned `.env.example` only.
- Archive SHA-256 (local and Oracle match): `7f8097decba60510033f48d7b67848af20ffe4293621c442628393b16e3eff21`.
- Extracted content verified with `tar --compare`: no content differences. Its exit 1 was solely 1082 expected UID/GID metadata differences (archive root ownership versus service-user extraction), not a successful raw exit code.
- Oracle aarch64: Node v24.20.0, pnpm 11.24.0. `pnpm install --frozen-lockfile` passed, 465 reused, zero downloaded packages.
- `pnpm --filter @ara/worker... typecheck`: passed all 10 selected packages.
- `pnpm --filter @ara/worker exec vitest run src/main.test.ts src/jobs/market-probe.test.ts src/jobs/daily-research.test.ts`: 3 files, 28 tests passed on Oracle.

## Live runtime evidence

- Queue was idle before cutover: completed 32, failed 2, queued/running 0. No user work interrupted.
- Graceful old-service stop and atomic release symlink switch at UTC 04:10:25–04:10:26. New MainPID 718781; `/proc/718781/cwd` resolved to the new release.
- `systemctl show`: ActiveState=active, SubState=running, UnitFileState=enabled, Restart=always.
- With queue still idle, `systemctl kill --kill-whom=main --signal=SIGTERM amazon-research-worker.service` at UTC 04:10:52 tested process-loss recovery. systemd restarted at 04:10:57; new MainPID 719057, NRestarts=1, active/running. Expected pnpm SIGTERM log lines reflect this controlled test, not a startup fault.
- Production `pg_stat_statements` REST-call counters increased: claim 270087 -> 270106; terminalize 489 -> 508. This is observed production DB polling, not merely a live PID. No synthetic production job was inserted.
- After verification: completed 32 / failed 2 unchanged; API-usage rows since cutover 0. No new paid research or provider connection test was triggered.
- Existing `amazon-research-daily.timer` remains enabled/active, next observed trigger 2026-09-05 04:00 EDT = 03:00 America/Chicago. Existing host timezone America/New_York unchanged.
- `/etc/amazon-research/worker.env` remains root:amazon-research 0640. DB target and required credential presence were checked without printing values. The fixed normalization writer capability identity in the unit was preserved, not replaced with app HEAD.

## Preservation, rollback and limits

- Prior Oracle release remains intact. Rollback means checking/draining queue, stopping only this service, switching current back to the prior explicit release, correcting DEPLOYED_HEAD and restarting; do not reset DB or change keys.
- First cutover precondition attempt failed because the SSH user could not traverse the protected app directory. It stopped before any service mutation. Retried the same validated checks with existing sudo authority, without loosening permissions.
- Service automatic recovery was exercised. Shared-host reboot was NOT performed; boot-start is verified by systemd enabled state, not an observed full reboot.
- No new real research completion was tested during this deployment; live polling and automatic process recovery were verified without paid calls. Future provider/network failures remain possible.
- Existing unrelated OCI monitoring unit warnings from `systemd-analyze verify` were left untouched; project unit verification returned exit 0.
- `apps/web/next-env.d.ts` preserved SHA-256: `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`. Existing `프롬프트.md` and untracked user material preserved.
