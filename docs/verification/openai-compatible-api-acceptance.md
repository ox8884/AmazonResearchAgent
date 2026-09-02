# OpenAI-compatible API acceptance track

## Decision

This track is the approved custom-API continuation while the original Codex and
Grok subscription OAuth gates remain deferred. It does not replace, pass, or
weaken subscription Tasks 16–18.

| Original work | Current status |
| --- | --- |
| Task 15 subscription terms gate | Complete with Codex and Grok fail-closed and unroutable. |
| Task 16 Codex Oracle acceptance | Deferred pending explicit provider authorization. |
| Task 17 Grok Oracle acceptance | Deferred pending explicit provider authorization. |
| Task 18 subscription natural recovery | Blocked by its original adapter-pass precondition. |

The custom-API sequence is deliberately separate:

1. **Task 16C — provider acceptance:** one saved OpenAI-compatible provider
   proves server-side secret handling, destination policy, explicit model
   execution, and provider-specific result ownership.
2. **Task 17C — eligible normalization:** a real candidate already in `AI
   Screening` is claimed by the typed normalization path and receives one
   provider-attributed attempt. It must not create a candidate merely for this
   test.
3. **Task 18C — natural recovery:** a naturally created Task 17C attempt is
   observed through finalization/restart recovery without duplicate paid work.

## Task 16C acceptance contract

### Scope

- Provider family: `openai_http` only.
- User-owned credential: a key entered into the password field and encrypted
  server-side. The browser receives only the key suffix.
- Current live configuration: one OpenRouter manual model with public HTTPS,
  `niche_normalization`, and the explicit `z-ai` routing policy.
- Actual request boundary: an explicitly requested connection test sends one
  bounded completion to the stored manual model. It may consume provider quota.

### Required invariants

1. A public provider URL is HTTPS-only, resolves only to a public destination,
   and is pinned per request before connection. Metadata, loopback, private,
   and blocked destinations are refused.
2. A manual model with discovery disabled bypasses broad catalog discovery and
   uses an explicit connection completion instead.
3. The connection result belongs only to the initiating provider row and does
   not expose a secret, response body, or a result from another provider.
4. An explicit `z-ai` PAYG provider can be selected only as the first
   normalization choice. It does not enable the generic PAYG fallback after a
   failure.
5. Codex and Grok `subscription_command` rows remain disabled and unroutable.

### Evidence

- A user-authorized direct test of the stored OpenRouter row completed with
  `available=true` and no error on 2026-09-01. The result is retained as
  runtime evidence only; this document contains neither the API key nor model
  response content.
- Focused local regression run on 2026-09-01:

  ```text
  pnpm --filter @ara/ai-router exec vitest run src/providers/openai-http.test.ts src/router.test.ts
  23 passed

  pnpm --filter @ara/worker exec vitest run src/jobs/test-ai-provider.test.ts src/providers/provider-url-policy.test.ts src/providers/provider-catalog.test.ts src/providers/normalization-execution-coordinator.test.ts
  22 passed

  pnpm --filter @ara/web exec vitest run app/api/ai-providers/route.test.ts app/api/ai-providers/test/route.test.ts
  36 passed
  ```

These checks cover URL policy, bounded HTTP parsing, manual-model execution,
provider-owned connection results, encrypted persisted catalog construction,
and the no-generic-fallback routing boundary.

## Task 16C verdict

**A — Task 16C Custom API provider acceptance complete.**

The final fresh independent rereview on 2026-09-01 found `CRITICAL 0` and
`IMPORTANT 0`. The typed initial Z.ai PAYG authority reaches the real persisted
target resolver, and it is unavailable after same-process or durable
pre-spawn-failure fallback. Generic PAYG fallback remains disabled.

This approval does not authorize subscription OAuth, browser credentials,
Oracle changes, deployment, any unconfigured provider, Task 17C provider
execution, or Task 18C.

## Next preconditions

- Task 17C requires a real, current `AI Screening` candidate and one matching
  queued normalization job. A stale job or a candidate already past screening is
  completed safely without a provider call and cannot count as Task 17C.
- Task 18C requires the Task 17C attempt/finalization record. It will verify
  recovery rather than manufacture jobs, candidates, or paid work.
