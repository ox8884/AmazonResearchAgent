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

`local-behavior` executes the real worker `SystemdSubscriptionSandbox`, production IPC helpers, and the single shared GC decision owner against a disposable attempt root. The child emits closed evidence schema v2: adapter/attempt/profile/unit identity; 14 exact ordered state-bearing transcript tuples; request/result relative paths, atomic publication facts, size, digest, and expected mode; the exact GC matrix; and cleanup absence. The child validates that schema before setting `ok`; the parent CLI independently revalidates every key, tuple/order/uniqueness, causal state, identity/digest field, GC result, and cleanup fact. Callers choose only adapter and cannot supply outcomes, paths, commands, or acceptance booleans.

The checked-in endpoint authority remains `fixtureOnly:true` and uses explicit test-only numeric identities (`ara-codex`/`20001`, `ara-grok`/`20002`) that cannot enter the production export. Production schema version 3 binds each fixed username/UID pair into canonical serialization, digest, reviewer/release/profile, and freshness authority. The production binding map remains intentionally empty, so production parsing fails closed until independently reviewed hostname/prefix and numeric UID values are published. Runtime NSS may verify a published pair but never selects or updates authority.

Installed artifact verification requires integer `O_NOFOLLOW`, opens each fixed path once, compares pre-open path metadata to the held descriptor, hashes from that descriptor, re-fstats it, checks exact byte count and mutation metadata, then re-lstats the fixed path. It proves a stable verification snapshot, not immunity from a later privileged write. Installation is serialized by the fixed root-owned `0600` kernel lock `/run/lock/amazon-research-subscription-install.lock`, held from preflight through publication, verification, rollback, parent sync, and release; inode ledgers remain defense in depth. This cooperative boundary covers every repository-owned protected-target writer, not arbitrary privileged actors.

`tests/fixtures/nftables-noble-1.0.9-parser.json` records the pinned Ubuntu Noble amd64 `nftables/libnftables1 1.0.9-1build1` package SHA-256 values, exact isolated command, rendered-input SHA-256, and JSON-output SHA-256. The capture was produced in a disposable `unshare --user --map-root-user --net` namespace and proves parser compatibility only: numeric `skuid`, null accept, target reject object, metainfo, priority, and rule order. It neither loaded nor modified host rules and is not Oracle acceptance.

Oracle host verification remains pending separate approval and must derive acceptance from fixed installed paths, reviewed numeric identity mappings, and exact installed/active nft semantics. Local evidence can set only `localFixtureVerified:true`; `oracleHostVerified`, `liveProviderVerified`, and production activation remain false. Live provider/auth acceptance belongs to Tasks 15–17 and is forbidden here.
