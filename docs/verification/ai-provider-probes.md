# AI Provider Probe Record

## Scope

This record covers the local, non-paid probe gate from Plan 02 Task 10. The probe script does not mutate provider settings and does not authenticate or contact a real paid provider.

## Local commands

```text
node scripts/probe-ai-providers.mjs --provider fake-command
node scripts/probe-ai-providers.mjs --provider custom-http
```

Both commands passed on the Windows development host:

| Provider | Platform | Architecture | Node | Version | Structured JSON | Unattended | Timeout |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fake-command` | `win32` | `x64` | `v24.20.0` | `fake-ai-command 1.0.0` | PASS | PASS | PASS |
| `custom-http` | `win32` | `x64` | `v24.20.0` | `fake-http-model` | PASS | PASS | PASS |

`custom-http` uses only the script's local mock HTTP server. `fake-command` uses `tests/fixtures/fake-ai-command.mjs` through the command adapter path.

## Oracle ARM64 status

Oracle ARM64 verification was **not performed**. The local probe reported `oracleArm64: false` (`win32`/`x64`). No Oracle host was contacted, modified, installed on, or authenticated against.

Real subscription CLI profiles remain disabled until the same version, structured-output, timeout, and unattended checks pass on the authorized Oracle ARM64 worker.

## Subscription sandbox probe modes

Task 14 exposes only closed CLI operations:

```text
node scripts/probe-subscription-provider.mjs --mode local-behavior --adapter codex
node scripts/probe-subscription-provider.mjs --mode local-behavior --adapter grok
node scripts/probe-subscription-provider.mjs --mode render-endpoint-policy --authority ops/subscription-providers/endpoint-bindings.json --environment local-fixture
node --test scripts/probe-subscription-provider.test.mjs
```

`local-behavior` creates its own private attempt directory, writes and atomically renames its request/result files, derives lifecycle events from those operations, applies the fixed GC decision rule to concrete states, runs only the fixed Node syntax command plan, removes the fixture root, verifies absence, and emits bounded `executed-local-v2` JSON. Callers choose only adapter; they cannot supply events, GC outcomes, runner results, paths, commands, booleans, or acceptance artifacts. The former caller-authored function and JSON route always return `ok:false`.

The checked-in endpoint authority remains `fixtureOnly:true` with RFC documentation ranges. Production schema version 2 is release/profile/reviewer/freshness/hostname-to-prefix/artifact-manifest bound, but the approved production binding map is intentionally empty. Oracle parsing therefore fails closed until an independently reviewed release publishes exact hostname-to-prefix values. Local behavior can set only `localFixtureVerified:true`; it always leaves `oracleHostVerified:false` and `liveProviderVerified:false`.

Oracle host verification remains pending separate approval and must derive acceptance from fixed installed paths and installed nft policy/table state. Live provider/auth acceptance belongs to Tasks 15–17 and is forbidden here. Neither local fixtures nor host installation activate an adapter or consume a subscription.
