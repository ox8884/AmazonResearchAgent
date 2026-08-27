# AI Normalization and Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable, auditable AI normalization that converts surviving raw Opportunity Finder keywords into product-focused niche clusters and catalog phrase expansions without silently spending pay-as-you-go budget.

**Architecture:** A provider-agnostic router executes structured-output requests through either OpenAI-compatible HTTP providers or command-line providers running on the Oracle worker. Provider metadata lives in Supabase; encrypted secret material is stored server-side. Normalization jobs produce durable AI analyses, niche clusters, phrase expansions, and usage records. Provider unavailability defers work to `Waiting for AI Capacity`.

**Tech Stack:** TypeScript 6.0.3, Zod 4.4.3, Node.js 24.20.0, Supabase JS 2.112.2, Node `crypto` AES-256-GCM, Vitest 4.1.10.

**Spec:** `docs/superpowers/specs/2026-08-26-amazon-research-agent-design.md`

## Global Constraints

- Roles include bulk first-pass classification, niche normalization/clustering, deep market analysis, Strong cross-validation, review mining, supplier negotiation, Daily Digest.
- Routing order: capability -> configured role priority -> availability/rate limits -> cost policy.
- Modes: Saver, Balanced (default), Highest Quality.
- Pay-as-you-go automatic fallback is OFF by default.
- If subscribed providers are unavailable, set `Waiting for AI Capacity`; do not silently fall back to paid API.
- Strong candidates later require independent review by a different provider where possible.
- Korean is the default generated-summary language; English is selectable. Raw keywords and catalog/product titles remain unchanged.
- All AI calls must persist provider, model, role, input hash, output, usage, cost class, and timestamps.

---

## File Map

```text
packages/ai-router/src/provider.ts                 provider contracts
packages/ai-router/src/router.ts                   role/capability/cost selection
packages/ai-router/src/providers/openai-http.ts    OpenAI-compatible HTTP adapter
packages/ai-router/src/providers/command.ts        generic CLI/subscription adapter
packages/ai-router/src/structured.ts               Zod structured-output handling
packages/shared/src/ai.ts                          provider/model/role schemas
packages/db/src/provider-repository.ts             provider metadata access
packages/secret-store/src/index.ts                 AES-256-GCM encryption/decryption
apps/worker/src/jobs/normalize-opportunities.ts    normalization job
apps/web/app/[locale]/settings/ai/                 provider settings UI
supabase/migrations/202608260002_ai_router.sql     AI/provider tables
```

### Task 1: Add AI provider, model, and analysis schema

**Files:**
- Create: `packages/shared/src/ai.ts`
- Create: `packages/shared/src/ai.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `supabase/migrations/202608260002_ai_router.sql`

**Interfaces:**
- Produces enums/types: `AiRole`, `BillingType`, `RouterMode`, `ProviderKind`, `ProviderCapability`, `AiRequest`, `AiResult`.
- Produces tables: `ai_providers`, `ai_models`, `ai_analyses`, `ai_usage`, `provider_secrets`.

- [ ] **Step 1: Write failing schema tests**

```ts
it('rejects paid fallback unless explicitly allowed', () => {
  const request = AiRequestSchema.parse({
    role: 'niche_normalization',
    routerMode: 'Balanced',
    locale: 'ko',
    allowPaidFallback: false,
    payload: { keyword: 'batter squeeze bottle' }
  });
  expect(request.allowPaidFallback).toBe(false);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/shared test -- ai.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement schemas and migration**

Required roles:

```ts
export const AiRoleSchema = z.enum([
  'bulk_classification',
  'niche_normalization',
  'deep_market_analysis',
  'strong_cross_validation',
  'review_mining',
  'supplier_negotiation',
  'daily_digest'
]);
```

`ai_providers` stores name/kind/billing_type/enabled/priority/config JSON but never plaintext keys. `provider_secrets` stores ciphertext, IV, auth tag, created/rotated timestamps.

- [ ] **Step 4: Apply migration and run tests**

```bash
supabase db reset
pnpm --filter @ara/shared test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared supabase/migrations/202608260002_ai_router.sql
 git commit -m "feat: add ai provider and analysis schema"
```

### Task 2: Implement encrypted server-side secret storage

**Files:**
- Create: `packages/secret-store/package.json`
- Create: `packages/secret-store/src/index.ts`
- Create: `packages/secret-store/src/index.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string, key: Buffer): EncryptedSecret` and `decryptSecret(secret: EncryptedSecret, key: Buffer): string`.
- Encryption: AES-256-GCM, random 12-byte IV, 32-byte key read from `APP_SECRET_ENCRYPTION_KEY_B64`.

- [ ] **Step 1: Write failing round-trip/tamper tests**

```ts
it('round trips and rejects modified ciphertext', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptSecret('super-secret', key);
  expect(decryptSecret(encrypted, key)).toBe('super-secret');
  encrypted.ciphertext = encrypted.ciphertext.slice(0, -2) + 'aa';
  expect(() => decryptSecret(encrypted, key)).toThrow();
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/secret-store test
```
Expected: FAIL.

- [ ] **Step 3: Implement AES-256-GCM and redacted error paths**

Never include plaintext/ciphertext/key material in thrown error messages or logs. Expose only a secret `last4` display field computed from the original value before encryption.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/secret-store test
```
Expected: PASS including tamper rejection.

- [ ] **Step 5: Commit**

```bash
git add packages/secret-store
 git commit -m "feat: add encrypted provider secret store"
```

### Task 3: Define provider contract and structured-output guard

**Files:**
- Create: `packages/ai-router/src/provider.ts`
- Create: `packages/ai-router/src/structured.ts`
- Create: `packages/ai-router/src/provider.test.ts`

**Interfaces:**

```ts
export interface AiProvider {
  id: string;
  health(): Promise<ProviderHealth>;
  listModels(): Promise<AiModelDescriptor[]>;
  runStructured<T>(request: StructuredAiRequest<T>): Promise<AiProviderResult<T>>;
}
```

- [ ] **Step 1: Write failing structured-output retry test**

```ts
it('rejects invalid provider JSON instead of coercing it', async () => {
  const provider = fakeProviderReturning('{"classification":"maybe"}');
  await expect(runWithSchema(provider, ClassificationSchema, request)).rejects.toMatchObject({ code: 'INVALID_STRUCTURED_OUTPUT' });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/ai-router test -- provider.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement contract and strict Zod validation**

Allow at most one repair attempt for malformed JSON. The repair request must contain only the invalid output plus the target JSON schema, not secret/config data.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/ai-router test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-router
 git commit -m "feat: define structured ai provider contract"
```

### Task 4: Implement OpenAI-compatible HTTP provider

**Files:**
- Create: `packages/ai-router/src/providers/openai-http.ts`
- Create: `packages/ai-router/src/providers/openai-http.test.ts`

**Interfaces:**
- Supports configurable Base URL, API key, `/v1/models` discovery when available, manual model ID fallback, Chat Completions or Responses capability flags.

- [ ] **Step 1: Write failing mock-server tests**

```ts
it('discovers models and performs a structured request', async () => {
  const provider = new OpenAiHttpProvider(configPointingAtMockServer());
  const models = await provider.listModels();
  expect(models.map(m => m.id)).toContain('cheap-model');
  const result = await provider.runStructured(classificationRequest('leopard cups'));
  expect(result.output.classification).toBe('product_niche');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/ai-router test -- openai-http.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement provider with timeout and safe retries**

Defaults:
- connect/request timeout 60 seconds
- retry only HTTP 408/429/5xx, max 2 retries with jitter
- never retry 400/401/403
- do not log Authorization headers or raw secret-bearing config.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/ai-router test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-router/src/providers/openai-http.ts packages/ai-router/src/providers/openai-http.test.ts
 git commit -m "feat: add openai compatible ai provider"
```

### Task 5: Implement generic command/subscription provider

**Files:**
- Create: `packages/ai-router/src/providers/command.ts`
- Create: `packages/ai-router/src/providers/command.test.ts`
- Create: `tests/fixtures/fake-ai-command.mjs`

**Interfaces:**
- Config fields: executable, fixed args, prompt mode (`stdin` or final arg), output mode (`json` or text-to-JSON extraction), environment allowlist, timeout.
- Built-in subscription profiles remain disabled until their real Oracle ARM64 probe passes.

- [ ] **Step 1: Write failing fake-command test**

```ts
it('executes a command provider without shell interpolation', async () => {
  const provider = commandProviderForFixture();
  const result = await provider.runStructured(classificationRequest('pancake dispenser bottle'));
  expect(result.output.classification).toBe('product_niche');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/ai-router test -- command.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement with `spawn` and argument arrays**

Use `child_process.spawn(executable, args, { shell: false })`. Kill the child on timeout and cap stdout/stderr capture to 2 MB. Only explicitly allowed environment variables reach the child process.

- [ ] **Step 4: Run tests including injection fixture**

```bash
pnpm --filter @ara/ai-router test
```
Expected: PASS; text containing shell metacharacters is passed as data, not executed.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-router tests/fixtures/fake-ai-command.mjs
 git commit -m "feat: add safe command based ai provider"
```

### Task 6: Implement router selection and capacity deferral

**Files:**
- Create: `packages/ai-router/src/router.ts`
- Create: `packages/ai-router/src/router.test.ts`

**Interfaces:**
- Produces: `routeAiRequest(request, providerCatalog): RouteDecision`.
- Route order: capability -> configured role priority -> availability -> billing/cost policy.

- [ ] **Step 1: Write failing route policy tests**

```ts
it('does not select pay as you go when automatic paid fallback is off', () => {
  const decision = routeAiRequest(makeRequest({ allowPaidFallback: false }), catalog({ subscriptionUnavailable: true, paidAvailable: true }));
  expect(decision.kind).toBe('defer');
  expect(decision.reason).toBe('WAITING_FOR_AI_CAPACITY');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/ai-router test -- router.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement Saver/Balanced/Highest Quality policy**

Balanced defaults:
- bulk classification -> lowest-cost healthy capable model
- niche normalization -> preferred model with structured JSON
- Strong cross-validation -> different provider from primary when possible
- pay-as-you-go provider excluded unless request explicitly sets `allowPaidFallback=true`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ara/ai-router test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-router/src/router.ts packages/ai-router/src/router.test.ts
 git commit -m "feat: add cost and capacity aware ai routing"
```

### Task 7: Define keyword normalization and clustering structured outputs

**Files:**
- Create: `packages/research-engine/src/ai/normalization-schema.ts`
- Create: `packages/research-engine/src/ai/normalization-schema.test.ts`

**Interfaces:**

```ts
export const KeywordNormalizationSchema = z.object({
  classification: z.enum(['product_niche','brand_ip','broad_query','typo_variant','irrelevant','ambiguous']),
  canonicalNiche: z.string().min(1).nullable(),
  canonicalEnglish: z.string().min(1).nullable(),
  catalogPhrases: z.array(z.string().min(1)).max(8),
  aliases: z.array(z.string().min(1)).max(20),
  productFit: z.enum(['strong','possible','poor']),
  riskFlags: z.array(z.enum(['food_contact','electric','battery','fragile','liquid','heavy','ip','seasonal','certification'])),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(800)
});
```

- [ ] **Step 1: Write failing examples**

Test exact expected canonical group for:
- `pancake dispenser bottle`
- `batter squeeze bottle`
- `batter mixer and dispenser`

and reject `pikachu lunch box` as `brand_ip`.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/research-engine test -- normalization-schema.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement schema and prompt contract**

Prompt contract must instruct the model to preserve original phrase, output catalog phrases likely to appear in Amazon product titles, and never invent a brand relationship.

- [ ] **Step 4: Run schema tests**

```bash
pnpm --filter @ara/research-engine test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/research-engine/src/ai
 git commit -m "feat: define niche normalization output contract"
```

### Task 8: Implement normalization worker job and durable clustering

**Files:**
- Create: `apps/worker/src/jobs/normalize-opportunities.ts`
- Create: `apps/worker/src/jobs/normalize-opportunities.integration.test.ts`
- Modify: `apps/worker/src/handlers.ts`

**Interfaces:**
- Consumes eligible Milestone 1 candidates.
- Produces `niche_clusters`, `niche_cluster_keywords`, `ai_analyses`, `ai_usage`, updated candidate states.

- [ ] **Step 1: Write failing clustering integration test**

```ts
it('clusters equivalent batter dispenser phrases and stores one AI analysis per input hash', async () => {
  await seedKeywords(['pancake dispenser bottle','batter squeeze bottle','batter mixer and dispenser']);
  await runNormalizeJobWithFakeProvider();
  expect(await clusterCount()).toBe(1);
  expect(await clusterKeywordCount()).toBe(3);
  expect(await duplicateAiAnalysisCount()).toBe(0);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/worker test -- normalize-opportunities.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement normalization, exact input hashing, and state transitions**

Rules:
- classification `brand_ip`, `broad_query`, `irrelevant` -> `Reject` with AI reason.
- `ambiguous` or confidence < 0.70 -> `Needs Review`.
- product niche with confidence >= 0.70 -> create/update cluster and move to `Ready for API Validation`.
- provider capacity failure -> `Waiting for AI Capacity` and retry later.
- hash `(role + provider prompt version + normalized input)` to avoid repeated AI work on crash/retry.

- [ ] **Step 4: Run integration tests**

```bash
pnpm --filter @ara/worker test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/normalize-opportunities.ts apps/worker/src/jobs/normalize-opportunities.integration.test.ts apps/worker/src/handlers.ts
 git commit -m "feat: normalize and cluster opportunity keywords"
```

### Task 9: Build AI provider settings UI and connection tests

**Files:**
- Create: `apps/web/app/[locale]/settings/ai/page.tsx`
- Create: `apps/web/app/api/ai-providers/route.ts`
- Create: `apps/web/app/api/ai-providers/test/route.ts`
- Create: `apps/web/components/ai-provider-form.tsx`
- Test: `apps/web/app/ai-settings.e2e.spec.ts`

**Interfaces:**
- Supports provider name, billing type, kind, base URL/command profile, encrypted API key entry, model discovery, manual model ID, role assignments, enabled toggle.

- [ ] **Step 1: Write failing E2E test**

```ts
test('saves a custom provider without redisplaying the secret', async ({ page }) => {
  await page.goto('/ko/settings/ai');
  await page.getByLabel('Provider name').fill('My Provider');
  await page.getByLabel('Base URL').fill('http://127.0.0.1:4000/v1');
  await page.getByLabel('API Key').fill('secret-value');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('••••value')).toBeVisible();
  await expect(page.getByText('secret-value')).toHaveCount(0);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @ara/web test:e2e -- ai-settings.e2e.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement server-side encryption, test-connection, and model discovery**

Connection test returns only health/model metadata. Never return Authorization headers, command environment, or decrypted secret.

- [ ] **Step 4: Run web/E2E tests**

```bash
pnpm --filter @ara/web test:e2e
```
Expected: PASS in Korean and English.

- [ ] **Step 5: Commit**

```bash
git add apps/web
 git commit -m "feat: add secure ai provider settings"
```

### Task 10: Oracle ARM64 provider probe gate

**Files:**
- Create: `scripts/probe-ai-providers.mjs`
- Create: `docs/verification/ai-provider-probes.md`

**Interfaces:**
- Produces recorded capability matrix used to enable/disable real subscription CLI profiles.

- [ ] **Step 1: Implement probe script that never mutates provider state**

The script must:
- run configured executable `--version` or configured health args
- run one structured-output smoke prompt using the provider profile
- verify timeout behavior
- record architecture/OS/Node version
- redact tokens/session paths.

- [ ] **Step 2: Run against Custom OpenAI-compatible provider and fake command provider**

Run:
```bash
node scripts/probe-ai-providers.mjs --provider custom-http
node scripts/probe-ai-providers.mjs --provider fake-command
```
Expected: PASS.

- [ ] **Step 3: On Oracle ARM64, probe each installed subscription CLI profile before enabling it**

Run one profile at a time through the same script. A profile is enabled only when both version and structured-output checks pass unattended. If a CLI requires interactive login during each call or cannot produce machine-readable output reliably, keep that profile disabled and record the limitation rather than building a brittle workaround.

- [ ] **Step 4: Record results**

`docs/verification/ai-provider-probes.md` must list provider, executable version, ARM64 status, structured JSON status, unattended status, and enable/disable decision. Do not store authentication material.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-ai-providers.mjs docs/verification/ai-provider-probes.md
 git commit -m "test: verify ai provider execution on worker host"
```
