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

`local-behavior` executes the real worker `SystemdSubscriptionSandbox`, production IPC helpers, and the shared GC decision owner against a parent-created disposable invocation root. The child emits closed evidence schema v2, but its booleans and metadata are not authority. The parent reads request/result from its private handoff through stable no-follow descriptors where supported, recomputes sizes and SHA-256 values from bytes, validates exact keysets/identity/relationship/raw-output digest and observed modes, checks the exact 14-event causal transcript, independently executes the maintained GC owner, observes invocation cleanup, then removes and observes absence of its own session root.

The checked-in endpoint authority remains `fixtureOnly:true` and uses explicit test-only numeric identities (`ara-codex`/`20001`, `ara-grok`/`20002`) that cannot enter the production export. Production schema version 3 binds each fixed username/UID pair into canonical serialization, digest, reviewer/release/profile, and freshness authority. The production binding map remains intentionally empty, so production parsing fails closed until independently reviewed hostname/prefix and numeric UID values are published. Before Oracle truth, the runtime verifier obtains the reviewed username/UID only from canonical production authority and requires two identical, single-record NSS lookups with the exact username, nonzero bounded UID, reviewed UID equality, and nologin shell. NSS never selects or updates authority.

The installer invokes the repository-owned Node lock opener for the fixed `/run/lock/amazon-research-subscription-install.lock`. It uses `O_NOFOLLOW|O_CREAT|O_EXCL` for safe first creation, never truncates or chmods a pre-existing object, validates regular-file descriptor/path identity plus exact production root ownership and `0600`, passes that same descriptor to the installer, acquires nonblocking `flock` before preflight, and retains the descriptor through rollback, verification, directory sync, cleanup, and exit. Inode ledgers remain defense in depth. This cooperative boundary covers every repository-owned protected-target writer, not arbitrary privileged actors.

`tests/fixtures/nftables-noble-1.0.9-parser.json` records the pinned Ubuntu Noble amd64 `nftables/libnftables1 1.0.9-1build1` package SHA-256 values, exact isolated command, rendered-input SHA-256, and the SHA-256 of the original raw JSON command bytes. That raw-byte digest need not equal a reserialized parsed object. The capture proves parser compatibility only; local package/raw-byte reproduction remains an external provenance limitation. It neither loaded nor modified host rules and is not Oracle acceptance.

Oracle host verification remains pending separate approval and must derive acceptance from fixed installed paths, reviewed numeric identity mappings, and exact installed/active nft semantics. Local evidence can set only `localFixtureVerified:true`; `oracleHostVerified`, `liveProviderVerified`, and production activation remain false. Live provider/auth acceptance belongs to Tasks 15–17 and is forbidden here.
