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
