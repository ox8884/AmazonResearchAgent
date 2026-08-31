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

Task 14 exposes two closed local operations in `scripts/probe-subscription-provider.mjs`:

```text
node scripts/probe-subscription-provider.mjs --mode render-endpoint-policy --authority ops/subscription-providers/endpoint-bindings.json --environment local-fixture
node --test scripts/probe-subscription-provider.test.mjs
```

The checked-in endpoint authority is explicitly `fixtureOnly:true` and contains only RFC 5737/RFC 3849 documentation ranges. The parser validates its closed schema, canonical address families/prefixes, nonempty adapter-specific provider/auth sets, and review digest before deterministic rendering. Oracle mode rejects that fixture; it requires a separately reviewed root-owned `0444`, regular, no-symlink authority at the fixed host path.

Local acceptance is derived from concrete repository files, their SHA-256 digests, the rendered nonempty policy, fixed command exit codes, ordered lifecycle operations evaluated by the probe state machine, and concrete GC inputs. Caller-provided booleans and the former all-true JSON fixture cannot establish `ok:true`. Output records `provenance:derived-local-v1`, `localFixtureVerified`, `oracleHostVerified`, and `liveProviderVerified` separately. Local synthetic evidence always leaves Oracle and live-provider verification false.

Oracle host verification is documented in [`../deployment/subscription-providers.md`](../deployment/subscription-providers.md) but remains pending explicit approval. Live provider/auth acceptance belongs to Tasks 15–17 and is forbidden in Task 14. Neither local fixtures nor host installation activate an adapter or consume a subscription.
